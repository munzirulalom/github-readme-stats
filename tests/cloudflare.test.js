/**
 * @jest-environment node
 */
import { describe, expect, it, jest } from "@jest/globals";
import { bridgeEnv, toCloudflare } from "../src/common/cloudflare.js";

/**
 * Build a fake Cloudflare Pages Functions context.
 *
 * @param {string} url Request URL.
 * @param {Record<string, unknown>} [env] Environment bindings.
 * @returns {{ request: Request, env: Record<string, unknown> }} Fake context.
 */
const makeContext = (url, env = {}) => ({
  request: new Request(url),
  env,
});

describe("toCloudflare", () => {
  it("parses query params into req.query", async () => {
    const handler = jest.fn((req, res) => {
      res.setHeader("Content-Type", "image/svg+xml");
      res.send(`hello ${req.query.username} ${req.query.theme}`);
    });
    const onRequest = toCloudflare(handler);

    const response = await onRequest(
      makeContext("https://example.pages.dev/api?username=foo&theme=dark"),
    );

    expect(handler).toHaveBeenCalledTimes(1);
    const req = handler.mock.calls[0][0];
    expect(req.query).toEqual({ username: "foo", theme: "dark" });
    expect(await response.text()).toBe("hello foo dark");
  });

  it("passes through the body and Content-Type header with a 200 default", async () => {
    const onRequest = toCloudflare((_req, res) => {
      res.setHeader("Content-Type", "image/svg+xml");
      res.send("<svg></svg>");
    });

    const response = await onRequest(
      makeContext("https://example.pages.dev/api?username=foo"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(await response.text()).toBe("<svg></svg>");
  });

  it("forwards a status code set via res.status()", async () => {
    const onRequest = toCloudflare((_req, res) => {
      res.setHeader("Content-Type", "image/svg+xml");
      res.status(400).send("bad request");
    });

    const response = await onRequest(
      makeContext("https://example.pages.dev/api"),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("bad request");
  });

  it("returns a 500 when the handler throws", async () => {
    const onRequest = toCloudflare(() => {
      throw new Error("boom");
    });

    const response = await onRequest(
      makeContext("https://example.pages.dev/api"),
    );

    expect(response.status).toBe(500);
  });
});

describe("bridgeEnv", () => {
  it("copies string env bindings onto process.env", () => {
    delete process.env.CACHE_SECONDS_TEST_BRIDGE;
    bridgeEnv({ CACHE_SECONDS_TEST_BRIDGE: "1200", IGNORED_NON_STRING: 5 });
    expect(process.env.CACHE_SECONDS_TEST_BRIDGE).toBe("1200");
    expect(process.env.IGNORED_NON_STRING).toBeUndefined();
    delete process.env.CACHE_SECONDS_TEST_BRIDGE;
  });

  it("maps GITHUB_TOKEN onto PAT_1 when PAT_1 is unset", () => {
    const originalPat1 = process.env.PAT_1;
    delete process.env.PAT_1;
    bridgeEnv({ GITHUB_TOKEN: "ghp_example" });
    expect(process.env.PAT_1).toBe("ghp_example");
    delete process.env.GITHUB_TOKEN;
    if (originalPat1 === undefined) {
      delete process.env.PAT_1;
    } else {
      process.env.PAT_1 = originalPat1;
    }
  });

  it("does not overwrite an existing PAT_1 with GITHUB_TOKEN", () => {
    const originalPat1 = process.env.PAT_1;
    process.env.PAT_1 = "existing_pat";
    bridgeEnv({ GITHUB_TOKEN: "ghp_example" });
    expect(process.env.PAT_1).toBe("existing_pat");
    delete process.env.GITHUB_TOKEN;
    if (originalPat1 === undefined) {
      delete process.env.PAT_1;
    } else {
      process.env.PAT_1 = originalPat1;
    }
  });
});
