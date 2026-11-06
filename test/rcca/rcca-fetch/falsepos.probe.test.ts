// RCCA probe F6c: breadth of pass-3 false positives on ordinary technical prose (diagnostic + pinned assertions).
import { it } from "node:test";
import assert from "node:assert/strict";
import { extractSourceUrls } from "../../../src/core/util.js";
it("ordinary technical prose yields filename/identifier 'hosts'", () => {
  const text = "Use Node.js or Next.js (e.g. in README.md); edit docker-compose.yml, .env, config.toml, nginx.conf, Program.cs, and the user.name key. i.e. done. See example.com and cloudflare.com.";
  const got = extractSourceUrls(text).map((u) => u.url);
  console.log("FALSEPOS:", got.join(" | "));
  for (const h of ["Node.js", "Next.js", "README.md", "docker-compose.yml", "config.toml", "nginx.conf", "Program.cs", "user.name"]) {
    assert.ok(got.includes("https://" + h), h);
  }
});
