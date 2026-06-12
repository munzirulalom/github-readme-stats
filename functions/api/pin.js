// Cloudflare Pages Function: /api/pin (repo pin card).
// Wraps the upstream handler so it stays identical to the original repo.
import handler from "../../api/pin.js";
import { toCloudflare } from "../../src/common/cloudflare.js";

export const onRequest = toCloudflare(handler);
