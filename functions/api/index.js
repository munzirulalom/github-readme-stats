// Cloudflare Pages Function: /api (stats card).
// Wraps the upstream handler so it stays identical to the original repo.
import handler from "../../api/index.js";
import { toCloudflare } from "../../src/common/cloudflare.js";

export const onRequest = toCloudflare(handler);
