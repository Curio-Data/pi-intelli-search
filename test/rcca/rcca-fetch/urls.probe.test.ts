// RCCA regression F6a: Sonar-style prose -> extractSourceUrls -> mergeCitations -> slice(maxUrls).
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
  // F6 corrected: filenames and identifiers are no longer candidates.
  const hosts = ["app.ini", "robots.txt", "gitea.log", "manage.py", "service.DISABLE", "photo.jpg", "report.pdf"];
  for (const h of hosts) {
    it(`text pass rejects '${h}'`, () => {
      assert.ok(!text.some((u) => new URL(u.url).hostname.toLowerCase() === h.toLowerCase()), h);
    });
  }
  it("real protocol-less references survive", () => {
    for (const h of ["codeberg.org", "github.com"]) assert.ok(text.some((u) => new URL(u.url).hostname === h), h);
  });
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
  it("annotation URLs precede protocol-less guesses in the maxUrls slice", () => {
    const merged = mergeCitations(text, { citations: ANNOT } as never);
    const firstAnnot = merged.findIndex((u) => u.url === ANNOT[0].url);
    const firstGuess = merged.findIndex((u) => u.url.startsWith("https://codeberg.org"));
    assert.ok(firstAnnot < firstGuess, `annotation ${firstAnnot}, guess ${firstGuess}`);
    const top5 = merged.slice(0, 5).map((u) => u.url);
    assert.ok(top5.includes(ANNOT[0].url), "first unique annotation kept within maxUrls=5");
  });
});
