// @ts-check

/**
 * Filter a list of organization logins using optional include/exclude lists.
 *
 * Matching is case-insensitive (GitHub org logins are case-insensitive), but the
 * returned values keep the original casing from `allOrgs` and preserve its order.
 * `undefined`, `null`, and `[]` are all treated as "not provided".
 *
 * @param {string[]} allOrgs The user's full list of organization logins.
 * @param {string[] | undefined | null} includeOrgs Orgs to whitelist (optional).
 * @param {string[] | undefined | null} excludeOrgs Orgs to blacklist (optional).
 * @returns {string[]} The filtered list of org logins.
 * @throws {Error} If both `includeOrgs` and `excludeOrgs` are provided and non-empty.
 */
const filterOrgs = (allOrgs, includeOrgs, excludeOrgs) => {
  const hasInclude = Array.isArray(includeOrgs) && includeOrgs.length > 0;
  const hasExclude = Array.isArray(excludeOrgs) && excludeOrgs.length > 0;

  if (hasInclude && hasExclude) {
    throw new Error(
      "`include_orgs` and `exclude_orgs` cannot be used together.",
    );
  }

  if (hasInclude) {
    const includeSet = new Set(includeOrgs.map((org) => org.toLowerCase()));
    return allOrgs.filter((org) => includeSet.has(org.toLowerCase()));
  }

  if (hasExclude) {
    const excludeSet = new Set(excludeOrgs.map((org) => org.toLowerCase()));
    return allOrgs.filter((org) => !excludeSet.has(org.toLowerCase()));
  }

  return [...allOrgs];
};

export { filterOrgs };
