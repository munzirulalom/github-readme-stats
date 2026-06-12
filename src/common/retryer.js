// @ts-check

import { CustomError } from "./error.js";
import { logger } from "./log.js";

// Script variables.

/**
 * Count the number of GitHub API tokens (PAT_1, PAT_2, ...) available.
 *
 * This is computed on every call rather than once at module load: on serverless
 * platforms such as Cloudflare Pages the environment is bridged onto
 * `process.env` per request, so the token may not exist yet when this module is
 * first imported.
 *
 * @returns {number} The retry budget (number of available tokens).
 */
const getRetryCount = () => {
  if (process.env.NODE_ENV === "test") {
    return 7;
  }
  return Object.keys(process.env).filter((key) => /PAT_\d*$/.exec(key)).length;
};

// Kept for backwards-compatible imports (e.g. tests).
const RETRIES = getRetryCount();

/**
 * @typedef {import("axios").AxiosResponse} AxiosResponse Axios response.
 * @typedef {(variables: any, token: string, retriesForTests?: number) => Promise<AxiosResponse>} FetcherFunction Fetcher function.
 */

/**
 * Try to execute the fetcher function until it succeeds or the max number of retries is reached.
 *
 * @param {FetcherFunction} fetcher The fetcher function.
 * @param {any} variables Object with arguments to pass to the fetcher function.
 * @param {number} retries How many times to retry.
 * @returns {Promise<any>} The response from the fetcher function.
 */
const retryer = async (fetcher, variables, retries = 0) => {
  const maxRetries = getRetryCount();
  if (!maxRetries) {
    throw new CustomError("No GitHub API tokens found", CustomError.NO_TOKENS);
  }

  if (retries > maxRetries) {
    throw new CustomError(
      "Downtime due to GitHub API rate limiting",
      CustomError.MAX_RETRY,
    );
  }

  try {
    // try to fetch with the first token since RETRIES is 0 index i'm adding +1
    let response = await fetcher(
      variables,
      // @ts-ignore
      process.env[`PAT_${retries + 1}`],
      // used in tests for faking rate limit
      retries,
    );

    // react on both type and message-based rate-limit signals.
    // https://github.com/anuraghazra/github-readme-stats/issues/4425
    const errors = response?.data?.errors;
    const errorType = errors?.[0]?.type;
    const errorMsg = errors?.[0]?.message || "";
    const isRateLimited =
      (errors && errorType === "RATE_LIMITED") || /rate limit/i.test(errorMsg);

    // if rate limit is hit increase the RETRIES and recursively call the retryer
    // with username, and current RETRIES
    if (isRateLimited) {
      logger.log(`PAT_${retries + 1} Failed`);
      retries++;
      // directly return from the function
      return retryer(fetcher, variables, retries);
    }

    // finally return the response
    return response;
  } catch (err) {
    /** @type {any} */
    const e = err;

    // network/unexpected error → let caller treat as failure
    if (!e?.response) {
      throw e;
    }

    // prettier-ignore
    // also checking for bad credentials if any tokens gets invalidated
    const isBadCredential =
      e?.response?.data?.message === "Bad credentials";
    const isAccountSuspended =
      e?.response?.data?.message === "Sorry. Your account was suspended.";

    if (isBadCredential || isAccountSuspended) {
      logger.log(`PAT_${retries + 1} Failed`);
      retries++;
      // directly return from the function
      return retryer(fetcher, variables, retries);
    }

    // HTTP error with a response → return it for caller-side handling
    return e.response;
  }
};

export { retryer, RETRIES };
export default retryer;
