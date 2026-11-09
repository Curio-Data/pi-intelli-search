// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

export const LOOP_MODEL = "openrouter/google/gemini-3.8-flash";

function seconds(value, fallback, name, minimum = 1) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < minimum)
    throw new Error(`${name} must be an integer of at least ${minimum} seconds`);
  return Number(value);
}

/** Budget the actual helper policy, including timeout's hard-kill grace.
 * The setup allowance is a policy margin, not a measured upper bound.
 */
export function createManifest(options = {}) {
  const attemptOverride = seconds(options.attemptSeconds, undefined, "E2E_TIMEOUT_SECONDS");
  const retrySeconds = seconds(options.retrySeconds, 30, "E2E_RETRY_SLEEP_SECONDS", 0);
  const killSeconds = seconds(options.killSeconds, 15, "E2E_KILL_AFTER_SECONDS");
  const scriptSeconds = seconds(options.scriptSeconds, undefined, "E2E_SCRIPT_TIMEOUT_SECONDS");
  const units = [];
  const add = (id, script, env = {}, kind = "provider", dependencies = []) => {
    const attemptSeconds = kind === "provider" ? attemptOverride ??
      (/^(01|11|15)_/.test(id) ? 600 : /^(03|08)_/.test(id) ? 300 : 360) : 0;
    const setupSeconds = kind === "host-install" ? 1200 : 180;
    const attempts = kind === "provider" ? 3 : 0;
    const minimumSeconds = attempts * (attemptSeconds + killSeconds) + Math.max(0, attempts - 1) * retrySeconds + setupSeconds;
    const timeoutMs = (scriptSeconds ?? minimumSeconds) * 1000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < minimumSeconds * 1000)
      throw new Error(`E2E_SCRIPT_TIMEOUT_SECONDS is below ${id}'s minimum budget of ${minimumSeconds}s`);
    units.push({ id, script, env, kind, dependencies, timeoutMs,
      budget: { attempts, attemptSeconds, retrySeconds, killSeconds, setupSeconds, minimumSeconds } });
  };
  add("01_main", "01_main.sh");
  for (const arm of ["cap", "default"])
    add(`02_${arm}`, "02_cap.sh", { E2E_CAP_CASE: arm });
  add("03_model_override", "03_model_override.sh");
  add("04_migration", "04_migration.sh");
  for (const [number, name] of [["05", "collation"], ["06", "extract"]]) {
    for (const arm of ["default", "tight"])
      add(`${number}_${arm}`, `${number}_${name}_limits.sh`, { E2E_LIMIT_ARM: arm });
    add(`${number}_compare`, `${number}_${name}_limits.sh`, { E2E_LIMIT_ARM: "compare" },
      "comparison", [`${number}_default`, `${number}_tight`]);
  }
  add("07_llms_full", "07_llms_full.sh");
  add("08_websearch_tool", "08_websearch_tool.sh");
  add("09_sonar_pro_search", "09_sonar_pro_search.sh");
  for (const recipe of ["r1", "r4", "r5", "r6", "r7", "r8", "r9", "r10"])
    add(`10_${recipe}`, "10_config_recipes.sh", { E2E_RECIPE: recipe });
  add("11_mcp_stdio", "11_mcp_stdio.sh");
  add("12_plugin_bundles", "12_plugin_bundles.sh", {}, "host-install");
  add("15_pi_floor", "15_pi_floor.sh");
  return { schemaVersion: 1, loopModel: LOOP_MODEL, expectedUnits: units.length,
    providerUnits: units.filter((unit) => unit.kind === "provider").length,
    excludedScenarios: ["13_claude_code_plugin.sh", "14_codex_plugin.sh"], units };
}

export function validateManifest(manifest) {
  const ids = new Set();
  for (const unit of manifest.units) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(unit.id) || ids.has(unit.id))
      throw new Error(`Invalid or duplicate unit ID: ${unit.id}`);
    if (!Number.isSafeInteger(unit.timeoutMs) || unit.timeoutMs <= 0)
      throw new Error(`Invalid timeout for ${unit.id}`);
    ids.add(unit.id);
  }
  const visited = new Set();
  const visit = (id, stack = new Set()) => {
    if (stack.has(id)) throw new Error(`Dependency cycle: ${id}`);
    if (visited.has(id)) return;
    const unit = manifest.units.find((candidate) => candidate.id === id);
    if (!unit) throw new Error(`Unknown dependency: ${id}`);
    for (const dep of unit.dependencies) visit(dep, new Set([...stack, id]));
    visited.add(id);
  };
  for (const id of ids) visit(id);
  if (manifest.expectedUnits !== ids.size) throw new Error("Expected unit count mismatch");
}
