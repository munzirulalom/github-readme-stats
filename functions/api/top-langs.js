// Cloudflare Pages Function: /api/top-langs (top languages card).
// Wraps the upstream handler so it stays identical to the original repo.
import handler from "../../api/top-langs.js";
import { toCloudflare } from "../../src/common/cloudflare.js";

export const onRequest = toCloudflare(handler);
