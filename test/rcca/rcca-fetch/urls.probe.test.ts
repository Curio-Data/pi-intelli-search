// RCCA probe F6a: Sonar-style prose -> extractSourceUrls -> mergeCitations -> slice(maxUrls).
// Deterministic, no network. Mirrors research.ts runSearchStage lines (extractSourceUrls + mergeCitations + slice).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractSourceUrls } from "../../../src/core/util.js";
import { mergeCitations } from "../../../src/core/annotations.js";

const PROSE = `Forgejo reads settings from app.ini; see the docs at [Forgejo docs](https://forgejo.org/docs/latest/admin/config-cheat-sheet/).
Set REQUIRE_SIGNIN_VIEW in app.ini and block crawlers via robots.txt. Failed logins appear in gitea.log.
Run manage.py migrate for Zulip. Set service.DISABLE_REGISTRATION = true. Clone with git clone https://git.example.com/user/repo.git
and the container listens on http://gitea:3000 . Upload photo.jpg or report.pdf. Email admin@example.com.
Real: codeberg.org/forgejo/discussions/issues/320, and github.com/go-gitea/gitea.`;

const ANNOT = [
  { url: "https://docs.gitea.com/administration/fail2ban-setup", title: "fail2ban" },
  { url: "https://forgejo.org/docs/latest/admin/config-cheat-sheet/", title: "dup" },
  { url: "https://developers.cloudflare.com/tunnel/", title: "tunnel" },
];

describe("F6a bogus URLs from prose", () => {
  const text = extractSourceUrls(PROSE);
  it("records every candidate (diagnostic)", () => {
    console.log("TEXT CANDIDATES:\n" + text.map((u, i) => `${i}\t${u.url}`).join("\n"));
    const merged = mergeCitations(text, { citations: ANNOT } as never);
    console.log("MERGED (annotations after text):\n" + merged.map((u, i) => `${i}\t${u.url}`).join("\n"));
    for (const n of [5, 6, 8]) {
      console.log(`maxUrls=${n}: ` + merged.slice(0, n).map((u) => u.url).join(" | "));
    }
  });
  const hosts = ["app.ini", "robots.txt", "gitea.log", "manage.py", "service.DISABLE", "photo.jpg", "report.pdf", "git.example.com"];
  for (const h of hosts) {
    it(`text pass turns '${h}' into a candidate`, () => {
      assert.ok(text.some((u) => new URL(u.url).hostname.toLowerCase() === h.split("/")[0].toLowerCase()), h);
    });
  }
  it("http://gitea:3000 is captured by the absolute pass", () => {
    assert.ok(text.some((u) => u.url === "http://gitea:3000"));
  });
  it("email domain is not captured", () => {
    assert.ok(!text.some((u) => u.url.includes("example.com") && !u.url.includes("git.")));
  });
  it("annotations alone contain none of the bogus hosts (annotationsHarvested hypothesis)", () => {
    const merged = mergeCitations([], { citations: ANNOT } as never);
    assert.equal(merged.length, 3);
  });
  it("bogus candidates precede annotation URLs and consume maxUrls slots", () => {
    const merged = mergeCitations(text, { citations: ANNOT } as never);
    const firstAnnot = merged.findIndex((u) => u.url === ANNOT[0].url);
    assert.ok(firstAnnot > 3, `annotation index ${firstAnnot}`);
    const top5 = merged.slice(0, 5).map((u) => u.url);
    assert.ok(!top5.includes(ANNOT[0].url), "first unique annotation pushed out of maxUrls=5");
  });
});
