// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync, mkdtempSync, openSync, closeSync, fsyncSync, linkSync, unlinkSync, rmdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "./common-inputs.js";
export { canonicalJson } from "./common-inputs.js";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve, relative, isAbsolute } from "node:path";
import type { Journal, JournalEvent, RunRecord, AnyPhase, Phase, RunManifest } from "./contracts.js";

export const digestText = (text: string) => createHash("sha256").update(text).digest("hex");
export const digestObject = (object: unknown) => digestText(canonicalJson(object));
export async function digestFile(path: string) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}
export function assertIdentifier(id: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}$/.test(id)) throw new Error("Invalid evidence identity");
}
export function writeNewJson(path: string, value: unknown): void {
  const scratch = fileURLToPath(new URL("../../.tmp/", import.meta.url));
  mkdirSync(scratch, { recursive: true });
  const own = mkdtempSync(join(scratch, "handoff-atomic-"));
  const temporary = join(own, "record.json");
  try {
    writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600, flush: true });
    // Atomic no-replace publication. Both paths must remain on the encrypted repository filesystem.
    linkSync(temporary, path);
    const dir = openSync(resolve(path, ".."), "r");
    try { fsyncSync(dir); } finally { closeSync(dir); }
  } finally {
    try { unlinkSync(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    rmdirSync(own);
  }
}
export function createRunDirectory(root: string, id: string): { directory: string; workspace: string; agentDir: string } {
  assertIdentifier(id);
  mkdirSync(root, { recursive: true });
  const directory = resolve(root, id);
  mkdirSync(directory); // refusal to reuse is intentional, including interrupted observations
  const workspace = join(directory, "workspace"), agentDir = join(directory, "agent");
  mkdirSync(workspace); mkdirSync(agentDir);
  return { directory, workspace, agentDir };
}
export class DurableJournal implements Journal {
  readonly events: JournalEvent[] = [];
  private readonly path: string;
  constructor(directory: string, private readonly runId: string) {
    this.path = join(directory, "events.jsonl");
    writeFileSync(this.path, "", { flag: "wx", mode: 0o600 });
  }
  record(event: JournalEvent) {
    const entry = structuredClone({ ...event, runId: this.runId, at: event.at ?? new Date().toISOString() });
    appendFileSync(this.path, JSON.stringify(entry) + "\n", { encoding: "utf8", flush: true });
    this.events.push(entry);
  }
}
export async function sourceIdentity(root: string): Promise<{ digest: string; files: Record<string, string>; adapterDependencies: Record<string, { path: string; version: string }> }> {
  const files: Record<string, string> = {};
  const adapterDependencies: Record<string, { path: string; version: string }> = {};
  async function collect(directory: string) {
    for (const entry of (await readdir(join(root, directory), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Source identity contains symlink: ${path}`);
      if (entry.isDirectory()) await collect(path);
      else if (/\.(ts|mts|js|mjs|json)$/.test(entry.name)) files[path] = await digestFile(join(root, path));
    }
  }
  await collect("src"); await collect("scripts/research-handoff");
  for (const name of (await readdir(join(root, "test"))).filter(name => /^handoff-.*\.test\.ts$/.test(name)).sort()) {
    files[join("test", name)] = await digestFile(join(root, "test", name));
  }
  for (const path of [
    "package.json", "package-lock.json", "tsconfig.json", "scripts/run-tests.mjs",
    "test/helpers/handoff-fixtures.ts", "test/tsconfig.research-handoff.json",
    ...["PROTOCOL.md", "EXECUTION-PLAN.md", "REPRODUCTION.md", "BRIEF.md", "HANDOVER.md", "FEASIBILITY.md"]
      .map(name => `docs/experiments/research-handoff/${name}`),
  ]) {
    files[path] = await digestFile(join(root, path));
  }
  // Each pilot contract joins the identity once it exists; historical trees without it are unaffected.
  for (const name of ["PILOT-PROTOCOL.md", "PILOT-CONTINUATION.md", "REPEAT-PROTOCOL.md"]) {
    const pilotProtocol = `docs/experiments/research-handoff/${name}`;
    try { files[pilotProtocol] = await digestFile(join(root, pilotProtocol)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  for (const name of ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"]) {
    const path = join("node_modules", name, "package.json");
    const manifest = JSON.parse(await readFile(join(root, path), "utf8")) as { version: string };
    adapterDependencies[name] = { path: join(root, "node_modules", name), version: manifest.version };
    files[path] = await digestFile(join(root, path));
  }
  return { digest: digestObject(files), files, adapterDependencies };
}
/** Run inventory paths are relative to the inventory directory, never arbitrary file paths. */
export async function loadInventory(path: string, phase: Phase = "measured"): Promise<RunRecord[]> {
  const { dirname } = await import("node:path");
  const root = dirname(resolve(path));
  const rows = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!Array.isArray(rows) || !rows.every(row => typeof row === "string")) throw new Error("Expected record-path inventory");
  const seen = new Set<string>();
  const records: RunRecord[] = [];
  for (const row of rows as string[]) {
    const full = resolve(root, row), rel = relative(root, full);
    try {
      if (isAbsolute(row) || rel.startsWith("..") || seen.has(full)) throw new Error("Invalid or repeated inventory path");
      seen.add(full);
      const { realpath } = await import("node:fs/promises");
      const physicalRoot = await realpath(root), physical = await realpath(full);
      if (relative(physicalRoot, physical).startsWith("..")) throw new Error("Inventory symlink escapes evidence root");
      const record = JSON.parse(await readFile(full, "utf8")) as RunRecord;
      if (record?.manifest?.schemaVersion !== 1 || typeof record.manifest.runId !== "string") throw new Error("Invalid run record");
      records.push(record);
    } catch (error) {
      records.push(unavailableRecord(`unavailable-${records.length + 1}`, phase, `${row}: ${String(error)}`));
    }
  }
  return records;
}

/** An unreadable record is not an observation of zero requests or zero spending. */
export function unavailableRecord(id: string, phase: AnyPhase, error: string, manifest?: RunManifest): RunRecord {
  return {
    manifest: manifest ? { ...manifest, status: "failed" } : {
      schemaVersion: 1, runId: id, phase, arm: "baseline", status: "failed",
      host: { path: "unknown", version: "unknown", dependencies: {} },
      mainModel: { provider: "unknown", model: "unknown" }, protocolSha256: "unknown", codeSha256: "unknown",
      corpusSha256: "unknown", settingsSha256: "unknown", promptSha256: "unknown",
    },
    prompt: "", systemPrompt: "", catalogue: null, requests: [], toolCalls: [], adapterEvents: [],
    finalAnswer: "", finalMessages: [], inputIntegrity: { matched: false, complete: false, problems: ["Input observation unavailable"] },
    evidenceAccess: { readable: false, reportPaths: [], problems: ["Not checked"] },
    conformance: { conforms: false, problems: ["Unknown route"] },
    observerCoverage: { verified: false, problems: [error] }, analysisError: error, error,
  };
}
