// test/settings.test.ts — Unit tests for settings loading
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveModelConfig, loadSettings, invalidateSettingsCache } from "../src/settings.js";
import type { ResearchSettings } from "../src/types.js";

const baseSettings: ResearchSettings = {
  searchModel: { provider: "openrouter", model: "perplexity/sonar" },
  extractModel: { provider: "openrouter", model: "minimax/minimax-m2.7" },
  collateModel: { provider: "openrouter", model: "minimax/minimax-m2.7" },
  defaultUrls: 8,
  maxUrls: 16,
  cacheDir: ".search",
  extractMaxChars: 150_000,
  fetchTimeoutMs: 20_000,
  fetchConcurrency: 4,
  extractionConcurrency: 4,
  extractionMaxTokens: 3000,
  collationMaxTokens: 4000,
  browserFingerprint: "chrome_145",
};

describe("resolveModelConfig", () => {
  it("returns search model for 'search' role", () => {
    const result = resolveModelConfig(baseSettings, "search");
    assert.deepStrictEqual(result, { provider: "openrouter", model: "perplexity/sonar" });
  });

  it("returns extract model for 'extract' role", () => {
    const result = resolveModelConfig(baseSettings, "extract");
    assert.deepStrictEqual(result, { provider: "openrouter", model: "minimax/minimax-m2.7" });
  });

  it("returns collate model for 'collate' role", () => {
    const result = resolveModelConfig(baseSettings, "collate");
    assert.deepStrictEqual(result, { provider: "openrouter", model: "minimax/minimax-m2.7" });
  });

  it("returns different models when configured differently", () => {
    const custom: ResearchSettings = {
      ...baseSettings,
      searchModel: { provider: "openrouter", model: "perplexity/sonar-pro" },
      extractModel: { provider: "openai", model: "gpt-4o-mini" },
    };
    assert.deepStrictEqual(resolveModelConfig(custom, "search"), {
      provider: "openrouter",
      model: "perplexity/sonar-pro",
    });
    assert.deepStrictEqual(resolveModelConfig(custom, "extract"), {
      provider: "openai",
      model: "gpt-4o-mini",
    });
    // Collate unchanged (still uses baseSettings default)
    assert.deepStrictEqual(resolveModelConfig(custom, "collate"), {
      provider: "openrouter",
      model: "minimax/minimax-m2.7",
    });
  });
});

describe("loadSettings defaults", () => {
  it("returns all default settings when no overrides exist", async () => {
    // Invalidate cache to force fresh load
    invalidateSettingsCache();
    const settings = await loadSettings("/nonexistent");

    assert.strictEqual(settings.defaultUrls, 8);
    assert.strictEqual(settings.maxUrls, 16);
    assert.strictEqual(settings.cacheDir, ".search");
    assert.strictEqual(settings.extractMaxChars, 150_000);
    assert.strictEqual(settings.fetchTimeoutMs, 20_000);
    assert.strictEqual(settings.fetchConcurrency, 4);
    assert.strictEqual(settings.extractionConcurrency, 4);
    assert.strictEqual(settings.extractionMaxTokens, 3000);
    assert.strictEqual(settings.collationMaxTokens, 4000);
    assert.strictEqual(settings.browserFingerprint, "chrome_145");
    assert.strictEqual(settings.disableLlmsFullDiscovery, false);
    assert.strictEqual(settings.disableTelemetry, false);
    assert.strictEqual(settings.llmTimeoutMs, 90_000);
    assert.strictEqual(settings.llmRetryAttempts, 3);
    assert.strictEqual(settings.retryBaseDelayMs, 1500);
    assert.strictEqual(settings.retryMaxDelayMs, 20_000);
    assert.strictEqual(settings.searchRetryAttempts, 2);
    assert.strictEqual(settings.minRequestIntervalMs, 0);
  });
});

describe("settings caching", () => {
  it("returns cached settings on second call", async () => {
    invalidateSettingsCache();
    const first = await loadSettings("/nonexistent");
    const second = await loadSettings("/nonexistent");
    assert.strictEqual(first, second, "Should return the same object reference");
  });

  it("invalidateSettingsCache forces fresh load", async () => {
    invalidateSettingsCache();
    const first = await loadSettings("/nonexistent");
    invalidateSettingsCache();
    const second = await loadSettings("/nonexistent");
    assert.notStrictEqual(first, second, "Should return a new object after invalidation");
  });
});

describe("loadSettings nested namespace", () => {
  // Tests that loadSettings reads from PI_CODING_AGENT_DIR and
  // correctly parses both nested pi-intelli-search and flat intelli* keys.

  function tempAgentDir(): string {
    return mkdtempSync(join(tmpdir(), "pi-intelli-settings-agent-"));
  }

  function writeAgentSettings(agentDir: string, content: Record<string, unknown>): void {
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, "settings.json"), JSON.stringify(content));
  }

  it("reads extract model from nested pi-intelli-search namespace", async () => {
    const dir = tempAgentDir();
    const savedDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = dir;

    try {
      writeAgentSettings(dir, {
        "pi-intelli-search": {
          extractModel: { provider: "openai", model: "gpt-4" },
        },
      });

      invalidateSettingsCache();
      const settings = await loadSettings("/nonexistent");
      assert.deepStrictEqual(settings.extractModel, {
        provider: "openai",
        model: "gpt-4",
      });
    } finally {
      if (savedDir !== undefined) process.env.PI_CODING_AGENT_DIR = savedDir;
      else delete process.env.PI_CODING_AGENT_DIR;
    }
  });

  it("nested namespace takes precedence over flat keys", async () => {
    const dir = tempAgentDir();
    const savedDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = dir;

    try {
      writeAgentSettings(dir, {
        "pi-intelli-search": {
          maxUrls: 12,
        },
        intelliMaxUrls: 4,
      });

      invalidateSettingsCache();
      const settings = await loadSettings("/nonexistent");
      assert.strictEqual(settings.maxUrls, 12, "nested maxUrls (cap) should win over flat key");
      assert.strictEqual(settings.defaultUrls, 8, "defaultUrls should remain at default when not overridden");
    } finally {
      if (savedDir !== undefined) process.env.PI_CODING_AGENT_DIR = savedDir;
      else delete process.env.PI_CODING_AGENT_DIR;
    }
  });

  it("falls back to flat intelli* keys when no namespace present", async () => {
    const dir = tempAgentDir();
    const savedDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = dir;

    try {
      writeAgentSettings(dir, {
        intelliCacheDir: "my-cache",
      });

      invalidateSettingsCache();
      const settings = await loadSettings("/nonexistent");
      assert.strictEqual(settings.cacheDir, "my-cache", "flat key should work as fallback");
    } finally {
      if (savedDir !== undefined) process.env.PI_CODING_AGENT_DIR = savedDir;
      else delete process.env.PI_CODING_AGENT_DIR;
    }
  });

  it("reads all model configs from nested namespace", async () => {
    const dir = tempAgentDir();
    const savedDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = dir;

    try {
      writeAgentSettings(dir, {
        "pi-intelli-search": {
          searchModel: { provider: "openrouter", model: "perplexity/sonar-pro" },
          extractModel: { provider: "openai", model: "gpt-4o-mini" },
          collateModel: { provider: "openai", model: "gpt-4o-mini" },
        },
      });

      invalidateSettingsCache();
      const settings = await loadSettings("/nonexistent");
      assert.deepStrictEqual(settings.searchModel, {
        provider: "openrouter",
        model: "perplexity/sonar-pro",
      });
      assert.deepStrictEqual(settings.extractModel, {
        provider: "openai",
        model: "gpt-4o-mini",
      });
      assert.deepStrictEqual(settings.collateModel, {
        provider: "openai",
        model: "gpt-4o-mini",
      });
    } finally {
      if (savedDir !== undefined) process.env.PI_CODING_AGENT_DIR = savedDir;
      else delete process.env.PI_CODING_AGENT_DIR;
    }
  });

  it("reads disableTelemetry from nested namespace", async () => {
    const dir = tempAgentDir();
    const savedDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = dir;

    try {
      writeAgentSettings(dir, {
        "pi-intelli-search": {
          disableTelemetry: true,
        },
      });

      invalidateSettingsCache();
      const settings = await loadSettings("/nonexistent");
      assert.strictEqual(settings.disableTelemetry, true);
    } finally {
      if (savedDir !== undefined) process.env.PI_CODING_AGENT_DIR = savedDir;
      else delete process.env.PI_CODING_AGENT_DIR;
    }
  });

  it("reads disableTelemetry from flat intelli* fallback key", async () => {
    const dir = tempAgentDir();
    const savedDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = dir;

    try {
      writeAgentSettings(dir, {
        intelliDisableTelemetry: true,
      });

      invalidateSettingsCache();
      const settings = await loadSettings("/nonexistent");
      assert.strictEqual(settings.disableTelemetry, true);
    } finally {
      if (savedDir !== undefined) process.env.PI_CODING_AGENT_DIR = savedDir;
      else delete process.env.PI_CODING_AGENT_DIR;
    }
  });

  it("reads numeric settings from nested namespace", async () => {
    const dir = tempAgentDir();
    const savedDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = dir;

    try {
      writeAgentSettings(dir, {
        "pi-intelli-search": {
          defaultUrls: 3,
          maxUrls: 12,
          fetchTimeoutMs: 30000,
          fetchConcurrency: 2,
          extractionConcurrency: 2,
          extractionMaxTokens: 8000,
          collationMaxTokens: 16000,
        },
      });

      invalidateSettingsCache();
      const settings = await loadSettings("/nonexistent");
      assert.strictEqual(settings.defaultUrls, 3);
      assert.strictEqual(settings.maxUrls, 12);
      assert.strictEqual(settings.fetchTimeoutMs, 30000);
      assert.strictEqual(settings.fetchConcurrency, 2);
      assert.strictEqual(settings.extractionConcurrency, 2);
      assert.strictEqual(settings.extractionMaxTokens, 8000);
      assert.strictEqual(settings.collationMaxTokens, 16000);
    } finally {
      if (savedDir !== undefined) process.env.PI_CODING_AGENT_DIR = savedDir;
      else delete process.env.PI_CODING_AGENT_DIR;
    }
  });

  it("old maxUrls maps to cap, defaultUrls stays at default", async () => {
    // Users upgrading from pre-0.8.0 had maxUrls in settings (meant as default).
    // In 0.8.0+ the same key means cap, and defaultUrls is the new fallback.
    const dir = tempAgentDir();
    const savedDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = dir;

    try {
      writeAgentSettings(dir, {
        "pi-intelli-search": {
          maxUrls: 6,
        },
      });

      invalidateSettingsCache();
      const settings = await loadSettings("/nonexistent");
      assert.strictEqual(settings.maxUrls, 6, "old maxUrls → cap");
      assert.strictEqual(settings.defaultUrls, 8, "defaultUrls stays at new default");
    } finally {
      if (savedDir !== undefined) process.env.PI_CODING_AGENT_DIR = savedDir;
      else delete process.env.PI_CODING_AGENT_DIR;
    }
  });

  it("defaultUrls and maxUrls work independently in new format", async () => {
    const dir = tempAgentDir();
    const savedDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = dir;

    try {
      writeAgentSettings(dir, {
        "pi-intelli-search": {
          defaultUrls: 4,
          maxUrls: 10,
        },
      });

      invalidateSettingsCache();
      const settings = await loadSettings("/nonexistent");
      assert.strictEqual(settings.defaultUrls, 4, "defaultUrls explicitly set");
      assert.strictEqual(settings.maxUrls, 10, "maxUrls (cap) explicitly set");
    } finally {
      if (savedDir !== undefined) process.env.PI_CODING_AGENT_DIR = savedDir;
      else delete process.env.PI_CODING_AGENT_DIR;
    }
  });
});

describe("hasFlatKeys", () => {
  function tempCwd(): string {
    return mkdtempSync(join(tmpdir(), "pi-intelli-settings-"));
  }

  function writeSettings(cwd: string, content: Record<string, unknown>): void {
    const piDir = join(cwd, ".pi");
    mkdirSync(piDir, { recursive: true });
    writeFileSync(join(piDir, "settings.json"), JSON.stringify(content));
  }

  it("returns true when settings.json has intelli-prefixed keys", async () => {
    const cwd = tempCwd();
    writeSettings(cwd, { intelliExtractModel: { provider: "openrouter", model: "test" } });
    const { hasFlatKeys } = await import("../src/settings.js");
    const result = await hasFlatKeys(cwd);
    assert.strictEqual(result, true, "should detect flat intelli* keys");
  });

  it("returns true when settings.json has intelliSearchModel", async () => {
    const cwd = tempCwd();
    writeSettings(cwd, { intelliSearchModel: { provider: "openrouter", model: "test" } });
    const { hasFlatKeys } = await import("../src/settings.js");
    const result = await hasFlatKeys(cwd);
    assert.strictEqual(result, true, "should detect intelliSearchModel");
  });

  it("returns false when settings.json uses nested pi-intelli-search namespace only", async () => {
    const cwd = tempCwd();
    writeSettings(cwd, {
      "pi-intelli-search": { extractModel: { provider: "openrouter", model: "test" } },
    });
    const { hasFlatKeys } = await import("../src/settings.js");
    const result = await hasFlatKeys(cwd);
    assert.strictEqual(result, false, "nested namespace should not trigger flat key detection");
  });

  it("returns true when both nested namespace and flat keys are present", async () => {
    const cwd = tempCwd();
    writeSettings(cwd, {
      "pi-intelli-search": { extractModel: { provider: "openrouter", model: "test" } },
      intelliMaxUrls: 12,
    });
    const { hasFlatKeys } = await import("../src/settings.js");
    const result = await hasFlatKeys(cwd);
    assert.strictEqual(result, true, "flat keys present alongside namespace should be detected");
  });

  it("returns false when no settings.json exists", async () => {
    const cwd = tempCwd();
    // No .pi/settings.json written
    const { hasFlatKeys } = await import("../src/settings.js");
    const result = await hasFlatKeys(cwd);
    assert.strictEqual(result, false, "no settings file means no flat keys");
  });

  it("returns false when settings.json has no intelli keys", async () => {
    const cwd = tempCwd();
    writeSettings(cwd, { theme: "dark", model: "gpt-4" });
    const { hasFlatKeys } = await import("../src/settings.js");
    const result = await hasFlatKeys(cwd);
    assert.strictEqual(result, false, "non-intelli keys should not trigger detection");
  });
});

describe("migrateDefaults", () => {
  it("migrates extract model when it matches old default", async () => {
    const { migrateDefaults } = await import("../src/settings.js");

    // User settings match 0.7.0 defaults (minimax direct)
    const userSettings: ResearchSettings = {
      ...baseSettings,
      extractModel: { provider: "minimax", model: "MiniMax-M2.7" },
      collateModel: { provider: "minimax", model: "MiniMax-M2.7" },
    };

    const { changes, settings } = migrateDefaults("0.7.0", "0.8.0", userSettings);

    assert.ok(changes.length > 0, "should have migration changes");
    assert.deepStrictEqual(settings.extractModel, {
      provider: "openrouter",
      model: "minimax/minimax-m2.7",
    }, "extract should migrate to 0.8.0 default");
    assert.deepStrictEqual(settings.collateModel, {
      provider: "openrouter",
      model: "minimax/minimax-m2.7",
    }, "collate should migrate to 0.8.0 default");
  });

  it("does NOT migrate when user customized a model", async () => {
    const { migrateDefaults } = await import("../src/settings.js");

    // User explicitly set extract model to something else
    const userSettings: ResearchSettings = {
      ...baseSettings,
      extractModel: { provider: "openai", model: "gpt-4o-mini" },
      collateModel: { provider: "minimax", model: "MiniMax-M2.7" },
    };

    const { changes, settings } = migrateDefaults("0.7.0", "0.8.0", userSettings);

    // Extract should NOT change (user customized)
    assert.deepStrictEqual(settings.extractModel, {
      provider: "openai",
      model: "gpt-4o-mini",
    }, "customized extract should not be migrated");
    // Collate matched old default — should migrate
    assert.deepStrictEqual(settings.collateModel, {
      provider: "openrouter",
      model: "minimax/minimax-m2.7",
    }, "default-matching collate should migrate");

    const extractChange = changes.find((c) => c.includes("extract"));
    assert.strictEqual(extractChange, undefined, "no extract change when customized");
  });

  it("returns no changes when no defaults changed between versions", async () => {
    const { migrateDefaults } = await import("../src/settings.js");

    // Both versions have same defaults (hypothetical)
    const userSettings: ResearchSettings = { ...baseSettings };

    const { changes } = migrateDefaults("0.8.0", "0.8.0", userSettings);
    assert.deepStrictEqual(changes, [], "same version should have no changes");
  });

  it("returns no changes when previous version has no history entry", async () => {
    const { migrateDefaults } = await import("../src/settings.js");

    const userSettings: ResearchSettings = { ...baseSettings };
    const { changes } = migrateDefaults("0.1.0", "0.8.0", userSettings);
    assert.deepStrictEqual(changes, [], "unknown old version should have no changes");
  });

  it("does NOT migrate search model by default (it has not changed)", async () => {
    const { migrateDefaults } = await import("../src/settings.js");

    // User settings have search matching base (Sonar)
    const userSettings: ResearchSettings = { ...baseSettings };

    const { changes } = migrateDefaults("0.7.0", "0.8.0", userSettings);
    const searchChange = changes.find((c) => c.includes("search"));
    assert.strictEqual(searchChange, undefined, "search model should not be migrated");
  });
});
