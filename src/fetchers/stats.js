// @ts-check

import axios from "../common/axios.js";
import * as dotenv from "dotenv";
import githubUsernameRegex from "github-username-regex";
import { calculateRank } from "../calculateRank.js";
import { retryer } from "../common/retryer.js";
import { logger } from "../common/log.js";
import { excludeRepositories } from "../common/envs.js";
import { CustomError, MissingParamError } from "../common/error.js";
import { wrapTextMultiline } from "../common/fmt.js";
import { request } from "../common/http.js";
import { filterOrgs } from "../common/orgs.js";

dotenv.config();

// GraphQL queries.
const GRAPHQL_REPOS_FIELD = `
  repositories(first: 100, ownerAffiliations: OWNER, orderBy: {direction: DESC, field: STARGAZERS}, after: $after) {
    totalCount
    nodes {
      name
      stargazers {
        totalCount
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
`;

const GRAPHQL_REPOS_QUERY = `
  query userInfo($login: String!, $after: String) {
    user(login: $login) {
      ${GRAPHQL_REPOS_FIELD}
    }
  }
`;

const GRAPHQL_STATS_QUERY = `
  query userInfo($login: String!, $after: String, $includeMergedPullRequests: Boolean!, $includeDiscussions: Boolean!, $includeDiscussionsAnswers: Boolean!, $startTime: DateTime = null) {
    user(login: $login) {
      name
      login
      commits: contributionsCollection (from: $startTime) {
        totalCommitContributions,
      }
      reviews: contributionsCollection {
        totalPullRequestReviewContributions
      }
      repositoriesContributedTo(first: 1, contributionTypes: [COMMIT, ISSUE, PULL_REQUEST, REPOSITORY]) {
        totalCount
      }
      pullRequests(first: 1) {
        totalCount
      }
      mergedPullRequests: pullRequests(states: MERGED) @include(if: $includeMergedPullRequests) {
        totalCount
      }
      openIssues: issues(states: OPEN) {
        totalCount
      }
      closedIssues: issues(states: CLOSED) {
        totalCount
      }
      followers {
        totalCount
      }
      repositoryDiscussions @include(if: $includeDiscussions) {
        totalCount
      }
      repositoryDiscussionComments(onlyAnswers: true) @include(if: $includeDiscussionsAnswers) {
        totalCount
      }
      ${GRAPHQL_REPOS_FIELD}
    }
  }
`;

// Query that lists the organizations a user belongs to, with the node IDs
// needed to scope a contributionsCollection to a single organization.
const GRAPHQL_ORGS_QUERY = `
  query userOrgs($login: String!) {
    user(login: $login) {
      organizations(first: 100) {
        nodes {
          login
          id
        }
      }
    }
  }
`;

/**
 * Build a GraphQL query that fetches the commit contributions a user made to
 * each of the given organizations, one aliased field per org.
 *
 * @param {Array<{login: string, id: string}>} orgs Organizations to query.
 * @returns {string} GraphQL query string.
 */
const buildOrgCommitsQuery = (orgs) => {
  const varDecls = orgs.map((_, i) => `$id${i}: ID!`).join(", ");
  const fields = orgs
    .map(
      (_, i) =>
        `org${i}: contributionsCollection(organizationID: $id${i}, from: $startTime) { totalCommitContributions }`,
    )
    .join("\n      ");
  return `
  query orgCommits($login: String!, $startTime: DateTime, ${varDecls}) {
    user(login: $login) {
      ${fields}
    }
  }
`;
};

/**
 * Retryer-compatible fetcher for the user's organization list.
 *
 * @param {object} variables Fetcher variables.
 * @param {string} token GitHub token.
 * @returns {Promise<import('axios').AxiosResponse>} Axios response.
 */
const orgsFetcher = (variables, token) => {
  return request(
    { query: GRAPHQL_ORGS_QUERY, variables: { login: variables.login } },
    { Authorization: `bearer ${token}` },
  );
};

/**
 * Retryer-compatible fetcher for per-organization commit contributions. The
 * dynamic query and its variables are carried on `variables`.
 *
 * @param {object} variables Fetcher variables.
 * @param {string} token GitHub token.
 * @returns {Promise<import('axios').AxiosResponse>} Axios response.
 */
const orgCommitsFetcher = (variables, token) => {
  return request(
    { query: variables.query, variables: variables.queryVars },
    { Authorization: `bearer ${token}` },
  );
};

/**
 * Adjust the total commit count to only reflect the requested organizations.
 *
 * `include_orgs` returns the summed commit contributions to just those orgs.
 * `exclude_orgs` returns the all-org total minus the excluded orgs' commits.
 * Only the commit count is affected. On any error the original total is
 * returned unchanged so stats never break because of the optional filter.
 *
 * @param {object} args Arguments.
 * @param {string} args.username GitHub username.
 * @param {string[]} args.includeOrgs Orgs to include (whitelist).
 * @param {string[]} args.excludeOrgs Orgs to exclude (blacklist).
 * @param {string|undefined} args.startTime Time to start the count of commits.
 * @param {number} args.totalCommits All-org total commit count.
 * @returns {Promise<number>} The org-filtered commit count.
 */
const filterCommitsByOrg = async ({
  username,
  includeOrgs,
  excludeOrgs,
  startTime,
  totalCommits,
}) => {
  const orgsRes = await retryer(orgsFetcher, { login: username });
  if (orgsRes.data.errors || !orgsRes.data.data?.user?.organizations) {
    return totalCommits;
  }

  const orgNodes = orgsRes.data.data.user.organizations.nodes;
  const allLogins = orgNodes.map((node) => node.login);
  // Throws if both lists are provided; callers guard against that earlier.
  const keptLogins = filterOrgs(allLogins, includeOrgs, excludeOrgs);

  const isInclude = Array.isArray(includeOrgs) && includeOrgs.length > 0;
  // For include we sum the kept orgs; for exclude we sum the dropped orgs so we
  // can subtract them from the all-org total.
  const orgsToQuery = isInclude
    ? orgNodes.filter((node) => keptLogins.includes(node.login))
    : orgNodes.filter((node) => !keptLogins.includes(node.login));

  if (orgsToQuery.length === 0) {
    return isInclude ? 0 : totalCommits;
  }

  const queryVars = { login: username, startTime };
  orgsToQuery.forEach((node, i) => {
    queryVars[`id${i}`] = node.id;
  });

  const res = await retryer(orgCommitsFetcher, {
    query: buildOrgCommitsQuery(orgsToQuery),
    queryVars,
  });
  if (res.data.errors || !res.data.data?.user) {
    return totalCommits;
  }

  const user = res.data.data.user;
  const orgCommits = orgsToQuery.reduce((sum, _node, i) => {
    return sum + (user[`org${i}`]?.totalCommitContributions || 0);
  }, 0);

  return isInclude ? orgCommits : Math.max(totalCommits - orgCommits, 0);
};

/**
 * Stats fetcher object.
 *
 * @param {object & { after: string | null }} variables Fetcher variables.
 * @param {string} token GitHub token.
 * @returns {Promise<import('axios').AxiosResponse>} Axios response.
 */
const fetcher = (variables, token) => {
  const query = variables.after ? GRAPHQL_REPOS_QUERY : GRAPHQL_STATS_QUERY;
  return request(
    {
      query,
      variables,
    },
    {
      Authorization: `bearer ${token}`,
    },
  );
};

/**
 * Fetch stats information for a given username.
 *
 * @param {object} variables Fetcher variables.
 * @param {string} variables.username GitHub username.
 * @param {boolean} variables.includeMergedPullRequests Include merged pull requests.
 * @param {boolean} variables.includeDiscussions Include discussions.
 * @param {boolean} variables.includeDiscussionsAnswers Include discussions answers.
 * @param {string|undefined} variables.startTime Time to start the count of total commits.
 * @returns {Promise<import('axios').AxiosResponse>} Axios response.
 *
 * @description This function supports multi-page fetching if the 'FETCH_MULTI_PAGE_STARS' environment variable is set to true.
 */
const statsFetcher = async ({
  username,
  includeMergedPullRequests,
  includeDiscussions,
  includeDiscussionsAnswers,
  startTime,
}) => {
  let stats;
  let hasNextPage = true;
  let endCursor = null;
  while (hasNextPage) {
    const variables = {
      login: username,
      first: 100,
      after: endCursor,
      includeMergedPullRequests,
      includeDiscussions,
      includeDiscussionsAnswers,
      startTime,
    };
    let res = await retryer(fetcher, variables);
    if (res.data.errors) {
      return res;
    }

    // Store stats data.
    const repoNodes = res.data.data.user.repositories.nodes;
    if (stats) {
      stats.data.data.user.repositories.nodes.push(...repoNodes);
    } else {
      stats = res;
    }

    // Disable multi page fetching on public Vercel instance due to rate limits.
    const repoNodesWithStars = repoNodes.filter(
      (node) => node.stargazers.totalCount !== 0,
    );
    hasNextPage =
      process.env.FETCH_MULTI_PAGE_STARS === "true" &&
      repoNodes.length === repoNodesWithStars.length &&
      res.data.data.user.repositories.pageInfo.hasNextPage;
    endCursor = res.data.data.user.repositories.pageInfo.endCursor;
  }

  return stats;
};

/**
 * Fetch total commits using the REST API.
 *
 * @param {object} variables Fetcher variables.
 * @param {string} token GitHub token.
 * @returns {Promise<import('axios').AxiosResponse>} Axios response.
 *
 * @see https://developer.github.com/v3/search/#search-commits
 */
const fetchTotalCommits = (variables, token) => {
  return axios({
    method: "get",
    url: `https://api.github.com/search/commits?q=author:${variables.login}`,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/vnd.github.cloak-preview",
      Authorization: `token ${token}`,
    },
  });
};

/**
 * Fetch all the commits for all the repositories of a given username.
 *
 * @param {string} username GitHub username.
 * @returns {Promise<number>} Total commits.
 *
 * @description Done like this because the GitHub API does not provide a way to fetch all the commits. See
 * #92#issuecomment-661026467 and #211 for more information.
 */
const totalCommitsFetcher = async (username) => {
  if (!githubUsernameRegex.test(username)) {
    logger.log("Invalid username provided.");
    throw new Error("Invalid username provided.");
  }

  let res;
  try {
    res = await retryer(fetchTotalCommits, { login: username });
  } catch (err) {
    logger.log(err);
    throw new Error(err);
  }

  const totalCount = res.data.total_count;
  if (!totalCount || isNaN(totalCount)) {
    throw new CustomError(
      "Could not fetch total commits.",
      CustomError.GITHUB_REST_API_ERROR,
    );
  }
  return totalCount;
};

/**
 * Fetch stats for a given username.
 *
 * @param {string} username GitHub username.
 * @param {boolean} include_all_commits Include all commits.
 * @param {string[]} exclude_repo Repositories to exclude.
 * @param {boolean} include_merged_pull_requests Include merged pull requests.
 * @param {boolean} include_discussions Include discussions.
 * @param {boolean} include_discussions_answers Include discussions answers.
 * @param {number|undefined} commits_year Year to count total commits
 * @param {string[]} include_orgs Only count commits to these organizations.
 * @param {string[]} exclude_orgs Count commits to all organizations except these.
 * @returns {Promise<import("./types").StatsData>} Stats data.
 */
const fetchStats = async (
  username,
  include_all_commits = false,
  exclude_repo = [],
  include_merged_pull_requests = false,
  include_discussions = false,
  include_discussions_answers = false,
  commits_year,
  include_orgs = [],
  exclude_orgs = [],
) => {
  if (!username) {
    throw new MissingParamError(["username"]);
  }

  const stats = {
    name: "",
    totalPRs: 0,
    totalPRsMerged: 0,
    mergedPRsPercentage: 0,
    totalReviews: 0,
    totalCommits: 0,
    totalIssues: 0,
    totalStars: 0,
    totalDiscussionsStarted: 0,
    totalDiscussionsAnswered: 0,
    contributedTo: 0,
    rank: { level: "C", percentile: 100 },
  };

  let res = await statsFetcher({
    username,
    includeMergedPullRequests: include_merged_pull_requests,
    includeDiscussions: include_discussions,
    includeDiscussionsAnswers: include_discussions_answers,
    startTime: commits_year ? `${commits_year}-01-01T00:00:00Z` : undefined,
  });

  // Catch GraphQL errors.
  if (res.data.errors) {
    logger.error(res.data.errors);
    if (res.data.errors[0].type === "NOT_FOUND") {
      throw new CustomError(
        res.data.errors[0].message || "Could not fetch user.",
        CustomError.USER_NOT_FOUND,
      );
    }
    if (res.data.errors[0].message) {
      throw new CustomError(
        wrapTextMultiline(res.data.errors[0].message, 90, 1)[0],
        res.statusText,
      );
    }
    throw new CustomError(
      "Something went wrong while trying to retrieve the stats data using the GraphQL API.",
      CustomError.GRAPHQL_ERROR,
    );
  }

  const user = res.data.data.user;

  stats.name = user.name || user.login;

  // if include_all_commits, fetch all commits using the REST API.
  if (include_all_commits) {
    stats.totalCommits = await totalCommitsFetcher(username);
  } else {
    stats.totalCommits = user.commits.totalCommitContributions;
  }

  // Optionally scope the commit count to specific organizations. This relies on
  // the GraphQL contributionsCollection, so it is skipped when commits come from
  // the REST all-commits path above.
  const orgFilterActive =
    (Array.isArray(include_orgs) && include_orgs.length > 0) ||
    (Array.isArray(exclude_orgs) && exclude_orgs.length > 0);
  if (orgFilterActive && !include_all_commits) {
    stats.totalCommits = await filterCommitsByOrg({
      username,
      includeOrgs: include_orgs,
      excludeOrgs: exclude_orgs,
      startTime: commits_year ? `${commits_year}-01-01T00:00:00Z` : undefined,
      totalCommits: stats.totalCommits,
    });
  }

  stats.totalPRs = user.pullRequests.totalCount;
  if (include_merged_pull_requests) {
    stats.totalPRsMerged = user.mergedPullRequests.totalCount;
    stats.mergedPRsPercentage =
      (user.mergedPullRequests.totalCount / user.pullRequests.totalCount) *
        100 || 0;
  }
  stats.totalReviews = user.reviews.totalPullRequestReviewContributions;
  stats.totalIssues = user.openIssues.totalCount + user.closedIssues.totalCount;
  if (include_discussions) {
    stats.totalDiscussionsStarted = user.repositoryDiscussions.totalCount;
  }
  if (include_discussions_answers) {
    stats.totalDiscussionsAnswered =
      user.repositoryDiscussionComments.totalCount;
  }
  stats.contributedTo = user.repositoriesContributedTo.totalCount;

  // Retrieve stars while filtering out repositories to be hidden.
  const allExcludedRepos = [...exclude_repo, ...excludeRepositories];
  let repoToHide = new Set(allExcludedRepos);

  stats.totalStars = user.repositories.nodes
    .filter((data) => {
      return !repoToHide.has(data.name);
    })
    .reduce((prev, curr) => {
      return prev + curr.stargazers.totalCount;
    }, 0);

  stats.rank = calculateRank({
    all_commits: include_all_commits,
    commits: stats.totalCommits,
    prs: stats.totalPRs,
    reviews: stats.totalReviews,
    issues: stats.totalIssues,
    repos: user.repositories.totalCount,
    stars: stats.totalStars,
    followers: user.followers.totalCount,
  });

  return stats;
};

export { fetchStats };
export default fetchStats;
