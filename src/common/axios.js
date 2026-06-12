// @ts-check

import axios from "axios";

// The Cloudflare Workers/Pages runtime does not implement Node's http/https
// stack, so axios cannot use its default Node adapter there. Switching to the
// Web `fetch` adapter makes every axios call run on the platform's native
// fetch implementation while keeping axios's response shape unchanged, so the
// rest of the codebase (retryer, fetchers, cards) needs no changes.
//
// Tests use axios-mock-adapter, which installs its own adapter on the same
// axios singleton. We therefore leave the adapter untouched under test so the
// mocks keep intercepting requests.
if (process.env.NODE_ENV !== "test") {
  axios.defaults.adapter = "fetch";
}

export default axios;
