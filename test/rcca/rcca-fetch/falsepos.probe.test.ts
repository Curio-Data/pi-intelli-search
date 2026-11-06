// RCCA regression F6c: pass-3 false positives on ordinary technical prose. Fails on mcp-0.21.0
// and earlier, where every dotted identifier below became a fetch candidate.
import { it } from "node:test";
import assert from "node:assert/strict";
import { extractSourceUrls } from "../../../src/core/util.js";
it("ordinary technical prose yields no filename/identifier 'hosts'", () => {
  const text = "Use Node.js or Next.js (e.g. in README.md); edit docker-compose.yml, .env, config.toml, nginx.conf, Program.cs, and the user.name key. i.e. done. See example.com and cloudflare.com.";
  const got = extractSourceUrls(text).map((u) => u.url);
  console.log("FALSEPOS:", got.join(" | "));
  assert.deepEqual(got, ["https://example.com", "https://cloudflare.com"]);
});
