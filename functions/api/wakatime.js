// Cloudflare Pages Function: /api/wakatime (wakatime card).
// Wraps the upstream handler so it stays identical to the original repo.
import handler from "../../api/wakatime.js";
import { toCloudflare } from "../../src/common/cloudflare.js";

export const onRequest = toCloudflare(handler);
