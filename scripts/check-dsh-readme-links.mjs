#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// scripts/check-dsh-readme-links.mjs
//
// Resolves every link in the generated DeepSeek Harness (dsh) bundle README
// without a network call, and prints a receipt to keep as release evidence.
//
// Modes:
//   (default)            Candidate check before tagging. Reads the committed
//   [--file PATH]        bytes of plugins/dsh/README.md (or PATH) from the
//                        working tree, so run it after npm run
//                        generate:plugins. Release-ref targets resolve in
//                        the working tree, which becomes the tag.
//   --ref mcp-vX.Y.Z     Tag check after tagging. Reads the README and every
//                        release-ref target from local Git objects at that
//                        ref, and requires the ref to match the version in
//                        packages/mcp/package.json at the ref.
//   --main-ref REF       Git ref for evidence and history targets (default
//                        origin/main). These links follow main, so their
//                        anchors must already exist there; the check reads
//                        local Git objects and never fetches.
//
// Rules: every link is absolute; links into this repository use the
// generator's ref policy (mcp-v<version> for operational files, main for
// every other target); each target file exists at its ref; each Markdown anchor
// exists in that file (the root README is read as its GitHub view); and
// self-anchors resolve in the checked README itself.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DSH_SELF_PATH,
  anchorsOf,
  expectedDshRef,
  isGenerated,
  isSameRepoUrl,
  parseRepoUrl,
  releaseRef,
  selectLines,
} from "./generate-package-readmes.mjs";
import { allLinkTargets, isExternal } from "./lib/markdown-links.mjs";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

/** Reader over the working tree under root. */
export function worktreeReader(root = REPO_ROOT) {
  return {
    label: "working tree",
    exists: (path) => existsSync(join(root, path)),
    read: (path) => (existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : null),
  };
}

/** Reader over local Git objects at ref; never contacts a remote. */
export function gitReader(ref, root = REPO_ROOT) {
  const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  let commit;
  try {
    commit = git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).trim();
  } catch {
    throw new Error(`Git ref ${ref} does not resolve to a commit in this clone`);
  }
  const exists = (path) => {
    try {
      git(["cat-file", "-e", `${commit}:${path}`]);
      return true;
    } catch {
      return false;
    }
  };
  return {
    label: `${ref} (${commit})`,
    commit,
    exists,
    read: (path) => (exists(path) ? git(["show", `${commit}:${path}`]) : null),
  };
}

function markdownAnchors(path, text) {
  if (path === "README.md" && !isGenerated(text)) return anchorsOf(selectLines(text, "root").join("\n"));
  return anchorsOf(text);
}

/**
 * Check one dsh README text. release and main are readers for the release
 * tag and for main. Returns { problems, checked }; an empty problems list
 * means every link resolved.
 */
export function checkDshReadmeLinks({ text, version, release, main }) {
  const problems = [];
  if (!isGenerated(text)) problems.push("README does not carry the generated-file header");
  if (text.includes("{{")) problems.push("unreplaced {{ token");
  if (text.includes("}}")) problems.push("unreplaced }} token");
  const selfAnchors = anchorsOf(text);
  const cache = new Map();
  const anchorsAt = (reader, path) => {
    const key = `${reader.label}\0${path}`;
    if (!cache.has(key)) {
      const content = reader.read(path);
      cache.set(key, content === null ? null : markdownAnchors(path, content));
    }
    return cache.get(key);
  };
  const targets = allLinkTargets(text);
  for (const url of targets) {
    if (!isExternal(url)) {
      problems.push(url.startsWith("#") ? `same-page anchor ${url} is not absolute` : `relative link ${url}`);
      continue;
    }
    const target = parseRepoUrl(url);
    if (!target) {
      if (isSameRepoUrl(url)) problems.push(`unsupported repository URL ${url}`);
      continue;
    }
    const ref = expectedDshRef(target.path, version);
    if (target.ref !== ref) {
      problems.push(`${url}: ${target.path} must use ref ${ref}, not ${target.ref}`);
      continue;
    }
    if (target.kind === "blob" && target.path === DSH_SELF_PATH) {
      if (target.anchor && !selfAnchors.has(target.anchor)) problems.push(`${url}: missing self anchor #${target.anchor}`);
      continue;
    }
    const reader = ref === "main" ? main : release;
    if (!reader.exists(target.path)) {
      problems.push(`${url}: missing ${target.path} at ${reader.label}`);
      continue;
    }
    if (target.kind === "blob" && target.anchor && /\.md$/i.test(target.path)) {
      const anchors = anchorsAt(reader, target.path);
      if (!anchors?.has(target.anchor)) problems.push(`${url}: missing anchor #${target.anchor} in ${target.path} at ${reader.label}`);
    }
  }
  return { problems: [...new Set(problems)], checked: targets.length };
}

function parseArgs(argv) {
  const opts = { file: DSH_SELF_PATH, ref: undefined, mainRef: "origin/main" };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!["--file", "--ref", "--main-ref"].includes(flag) || value === undefined || value.startsWith("--")) {
      throw new Error("Usage: node scripts/check-dsh-readme-links.mjs [--file PATH] [--ref mcp-vX.Y.Z] [--main-ref REF]");
    }
    if (flag === "--file") opts.file = value;
    if (flag === "--ref") opts.ref = value;
    if (flag === "--main-ref") opts.mainRef = value;
    i++;
  }
  return opts;
}

/** Run a check from the command line options; returns the receipt lines and problems. */
export function runCheck(opts, root = REPO_ROOT) {
  const main = gitReader(opts.mainRef, root);
  let release;
  let text;
  let version;
  if (opts.ref) {
    release = gitReader(opts.ref, root);
    const manifest = release.read("packages/mcp/package.json");
    if (manifest === null) throw new Error(`packages/mcp/package.json is missing at ${release.label}`);
    version = JSON.parse(manifest).version;
    if (opts.ref !== releaseRef(version)) {
      throw new Error(`ref ${opts.ref} does not match packages/mcp/package.json version ${version} (${releaseRef(version)})`);
    }
    text = release.read(opts.file);
    if (text === null) throw new Error(`${opts.file} is missing at ${release.label}`);
  } else {
    release = worktreeReader(root);
    version = JSON.parse(readFileSync(join(root, "packages/mcp/package.json"), "utf8")).version;
    if (!existsSync(join(root, opts.file))) throw new Error(`${opts.file} is missing; run npm run generate:plugins first`);
    text = readFileSync(join(root, opts.file), "utf8");
  }
  const { problems, checked } = checkDshReadmeLinks({ text, version, release, main });
  const receipt = [
    `mode: ${opts.ref ? "tag" : "candidate"}`,
    `readme: ${opts.file}`,
    `sha256: ${createHash("sha256").update(text).digest("hex")}`,
    `bytes: ${Buffer.byteLength(text)}`,
    `mcp version: ${version} (release ref ${releaseRef(version)})`,
    `release targets: ${release.label}`,
    `evidence targets: ${main.label}`,
    `links checked: ${checked}`,
    `result: ${problems.length ? `FAIL (${problems.length} problems)` : "PASS"}`,
  ];
  return { receipt, problems };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { receipt, problems } = runCheck(parseArgs(process.argv.slice(2)));
    for (const line of receipt) console.log(line);
    for (const problem of problems) console.error(`problem: ${problem}`);
    if (problems.length) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
