// @ts-check

/**
 * @file Cloudflare Pages Functions adapter.
 *
 * The original `api/*.js` handlers are written for the Vercel/Express style
 * `(req, res)` signature. Cloudflare Pages Functions instead export an
 * `onRequest(context)` function that receives a Web-standard `Request` and must
 * return a Web-standard `Response`.
 *
 * `toCloudflare` wraps an existing `(req, res)` handler so it runs unchanged on
 * Cloudflare Pages. This keeps every `api/*.js` file byte-for-byte identical to
 * upstream and isolates all platform-specific glue in this one module.
 */

/**
 * Copy Cloudflare's per-request environment bindings onto `process.env`.
 *
 * The upstream fetchers/retryer read configuration from `process.env`
 * (e.g. `PAT_1`, `CACHE_SECONDS`). On Cloudflare, environment variables are
 * delivered on `context.env` instead, so we mirror them across on each request.
 *
 * As a convenience we also map a single `GITHUB_TOKEN` onto `PAT_1` when no
 * `PAT_1` is configured, because the retryer addresses tokens as `PAT_<n>` but
 * the self-host docs ask users to set `GITHUB_TOKEN`.
 *
 * @param {Record<string, unknown> | undefined} env Cloudflare environment bindings.
 * @returns {void}
 */
const bridgeEnv = (env) => {
  if (!env || typeof process === "undefined" || !process.env) {
    return;
  }
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      process.env[key] = value;
    }
  }
  if (!process.env.PAT_1 && typeof process.env.GITHUB_TOKEN === "string") {
    process.env.PAT_1 = process.env.GITHUB_TOKEN;
  }
};

/**
 * Build a minimal Express-like `res` object that records what the handler
 * writes, so it can be turned into a Web `Response`.
 *
 * Only the surface the handlers actually use is implemented: `setHeader`,
 * `send`, and a chainable `status`.
 *
 * @returns {{ res: any, read: () => { body: any, status: number, headers: Record<string, string> } }} The res object and a reader for what was written to it.
 */
const createResponseRecorder = () => {
  /** @type {Record<string, string>} */
  const headers = {};
  let body = null;
  let status = 200;

  const res = {
    /**
     * @param {string} key Header name.
     * @param {string} value Header value.
     * @returns {any} The res object (chainable).
     */
    setHeader(key, value) {
      headers[key] = value;
      return res;
    },
    /**
     * @param {number} code HTTP status code.
     * @returns {any} The res object (chainable).
     */
    status(code) {
      status = code;
      return res;
    },
    /**
     * @param {any} payload Response body.
     * @returns {any} The res object.
     */
    send(payload) {
      body = payload;
      return res;
    },
  };

  return { res, read: () => ({ body, status, headers }) };
};

/**
 * Adapt a Vercel/Express style `(req, res)` handler into a Cloudflare Pages
 * Functions `onRequest` handler.
 *
 * @param {(req: any, res: any) => unknown | Promise<unknown>} handler The original handler.
 * @returns {(context: { request: Request, env?: Record<string, unknown> }) => Promise<Response>} A Cloudflare onRequest handler.
 */
const toCloudflare = (handler) => {
  return async (context) => {
    bridgeEnv(context.env);

    const url = new URL(context.request.url);
    const req = { query: Object.fromEntries(url.searchParams) };

    const { res, read } = createResponseRecorder();

    try {
      await handler(req, res);
    } catch {
      return new Response("Something went wrong", { status: 500 });
    }

    const { body, status, headers } = read();
    return new Response(body, { status, headers });
  };
};

export { toCloudflare, bridgeEnv };
