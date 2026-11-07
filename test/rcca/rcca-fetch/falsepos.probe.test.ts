// RCCA regression F6c: pass-3 false positives on ordinary technical prose. Fails on mcp-0.21.0
// and earlier, where every dotted identifier below became a fetch candidate.
import { it } from "node:test";
import assert from "node:assert/strict";
import { extractSourceUrls } from "../../../src/core/util.js";
it("ordinary technical prose keeps only delegated references and labels file-like ones", () => {
  const text = "Use Node.js or Next.js (e.g. in README.md); edit docker-compose.yml, .env, config.toml, nginx.conf, Program.cs, and the user.name key. i.e. done. See example.com and cloudflare.com.";
  const got = extractSourceUrls(text);
  console.log("FALSEPOS:", got.map((u) => u.url).join(" | "));
  assert.deepEqual(got.map((u) => u.url), [
    "https://readme.md",
    "https://user.name",
    "https://example.com",
    "https://cloudflare.com",
  ]);
  assert.ok(got.every((u) => u.inferred));
});
