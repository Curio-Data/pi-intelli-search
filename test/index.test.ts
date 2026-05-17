// test/index.test.ts — Unit tests for extension entry point
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("extension module structure", () => {
  it("exports a default function", async () => {
    const mod = await import("../src/index.js");
    assert.strictEqual(typeof mod.default, "function");
  });
});

describe("extension registration", () => {
  it("registers all 4 tools", async () => {
    const recordedTools: string[] = [];

    const mockPi = {
      registerTool(tool: any) {
        recordedTools.push(tool.name);
      },
      on() {},
    };

    const mod = await import("../src/index.js");
    mod.default(mockPi);

    assert.deepStrictEqual(recordedTools.sort(), [
      "intelli_collate",
      "intelli_extract",
      "intelli_research",
      "intelli_search",
    ]);
  });

  it("subscribes to session_start for model registration and settings invalidation", async () => {
    const recordedEvents: string[] = [];

    const mockPi = {
      registerTool() {},
      on(event: string) {
        recordedEvents.push(event);
      },
    };

    const mod = await import("../src/index.js");
    mod.default(mockPi);

    assert.ok(recordedEvents.includes("session_start"), "should subscribe to session_start");
    const sessionStartCount = recordedEvents.filter((e) => e === "session_start").length;
    assert.ok(sessionStartCount >= 1, "should have at least one session_start handler");
  });

  it("subscribes to after_provider_response for rate-limit monitoring", async () => {
    const recordedEvents: string[] = [];

    const mockPi = {
      registerTool() {},
      on(event: string) {
        recordedEvents.push(event);
      },
    };

    const mod = await import("../src/index.js");
    mod.default(mockPi);

    assert.ok(
      recordedEvents.includes("after_provider_response"),
      "should subscribe to after_provider_response",
    );
  });

  it("subscribes to tool_execution_start/end for working indicator", async () => {
    const recordedEvents: string[] = [];

    const mockPi = {
      registerTool() {},
      on(event: string) {
        recordedEvents.push(event);
      },
    };

    const mod = await import("../src/index.js");
    mod.default(mockPi);

    assert.ok(
      recordedEvents.includes("tool_execution_start"),
      "should subscribe to tool_execution_start",
    );
    assert.ok(
      recordedEvents.includes("tool_execution_end"),
      "should subscribe to tool_execution_end",
    );
  });
});

describe("after_provider_response handler", () => {
  it("shows rate-limit status on 429 and clears on success", async () => {
    const statuses: Map<string, string | undefined> = new Map();
    let handler: Function | undefined;

    const mockPi = {
      registerTool() {},
      on(event: string, h: Function) {
        if (event === "after_provider_response") handler = h;
      },
    };

    const mod = await import("../src/index.js");
    mod.default(mockPi);

    assert.ok(handler, "handler should be registered");

    const mockCtx = {
      ui: {
        setStatus(key: string, text: string | undefined) {
          if (text === undefined) statuses.delete(key);
          else statuses.set(key, text);
        },
      },
    };

    // 429 should set rate-limit status
    handler!({ status: 429, headers: { "retry-after": "5" } }, mockCtx);
    assert.ok(statuses.has("pi-intelli-search:ratelimit"), "should set rate-limit status");
    assert.ok(
      statuses.get("pi-intelli-search:ratelimit")!.includes("5"),
      "should include retry-after value",
    );

    // 200 should clear rate-limit status
    handler!({ status: 200, headers: {} }, mockCtx);
    assert.ok(!statuses.has("pi-intelli-search:ratelimit"), "should clear rate-limit status on success");
  });

  it("debounces 429 notifications (only one per 30s)", async () => {
    const setStatusCalls: Array<[string, string | undefined]> = [];
    let handler: Function | undefined;

    const mockPi = {
      registerTool() {},
      on(event: string, h: Function) {
        if (event === "after_provider_response") handler = h;
      },
    };

    const mod = await import("../src/index.js");
    mod.default(mockPi);

    const mockCtx = {
      ui: {
        setStatus(key: string, text: string | undefined) {
          setStatusCalls.push([key, text]);
        },
      },
    };

    // Two rapid 429s — only first should set status
    handler!({ status: 429, headers: {} }, mockCtx);
    handler!({ status: 429, headers: {} }, mockCtx);

    const setCalls = setStatusCalls.filter(
      ([key, text]) => key === "pi-intelli-search:ratelimit" && text !== undefined,
    );
    assert.strictEqual(setCalls.length, 1, "should debounce rapid 429s");
  });
});

describe("auth pre-flight check", () => {
  // Use temp directories with PI_CODING_AGENT_DIR for deterministic
  // filesystem control. Each test creates an isolated agent dir,
  // writes specific auth.json contents, and asserts exact behavior.

  function tempAgentDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "pi-intelli-test-"));
    // Write empty models.json so ensureCustomModels doesn't fail
    writeFileSync(join(dir, "models.json"), "{}");
    return dir;
  }

  function writeAuthJson(agentDir: string, content: Record<string, unknown>): void {
    writeFileSync(join(agentDir, "auth.json"), JSON.stringify(content));
  }

  it("returns true when no auth.json exists and no env var is set", async () => {
    const savedKey = process.env.OPENROUTER_API_KEY;
    const savedDir = process.env.PI_CODING_AGENT_DIR;
    delete process.env.OPENROUTER_API_KEY;

    try {
      process.env.PI_CODING_AGENT_DIR = tempAgentDir();
      // No auth.json written — auth should be missing
      const { isOpenRouterAuthMissing } = await import("../src/index.js");
      const result = await isOpenRouterAuthMissing();
      assert.strictEqual(result, true, "should report auth missing with no auth.json");
    } finally {
      if (savedKey !== undefined) process.env.OPENROUTER_API_KEY = savedKey;
      else delete process.env.OPENROUTER_API_KEY;
      if (savedDir !== undefined) process.env.PI_CODING_AGENT_DIR = savedDir;
      else delete process.env.PI_CODING_AGENT_DIR;
    }
  });

  it("returns false when auth.json has an openrouter key", async () => {
    const savedKey = process.env.OPENROUTER_API_KEY;
    const savedDir = process.env.PI_CODING_AGENT_DIR;
    delete process.env.OPENROUTER_API_KEY;

    try {
      const dir = tempAgentDir();
      writeAuthJson(dir, { openrouter: { type: "api_key", key: "sk-or-v1-test" } });
      process.env.PI_CODING_AGENT_DIR = dir;

      const { isOpenRouterAuthMissing } = await import("../src/index.js");
      const result = await isOpenRouterAuthMissing();
      assert.strictEqual(result, false, "should find auth via auth.json openrouter key");
    } finally {
      if (savedKey !== undefined) process.env.OPENROUTER_API_KEY = savedKey;
      else delete process.env.OPENROUTER_API_KEY;
      if (savedDir !== undefined) process.env.PI_CODING_AGENT_DIR = savedDir;
      else delete process.env.PI_CODING_AGENT_DIR;
    }
  });

  it("returns true when auth.json exists but has no openrouter key", async () => {
    const savedKey = process.env.OPENROUTER_API_KEY;
    const savedDir = process.env.PI_CODING_AGENT_DIR;
    delete process.env.OPENROUTER_API_KEY;

    try {
      const dir = tempAgentDir();
      writeAuthJson(dir, { anthropic: { type: "api_key", key: "sk-ant-test" } });
      process.env.PI_CODING_AGENT_DIR = dir;

      const { isOpenRouterAuthMissing } = await import("../src/index.js");
      const result = await isOpenRouterAuthMissing();
      assert.strictEqual(result, true, "should report auth missing when openrouter key absent");
    } finally {
      if (savedKey !== undefined) process.env.OPENROUTER_API_KEY = savedKey;
      else delete process.env.OPENROUTER_API_KEY;
      if (savedDir !== undefined) process.env.PI_CODING_AGENT_DIR = savedDir;
      else delete process.env.PI_CODING_AGENT_DIR;
    }
  });

  it("returns false when OPENROUTER_API_KEY env var is set (fast path)", async () => {
    const savedKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "sk-or-v1-from-env";

    try {
      const { isOpenRouterAuthMissing } = await import("../src/index.js");
      const result = await isOpenRouterAuthMissing();
      assert.strictEqual(result, false, "env var should short-circuit to auth present");
    } finally {
      if (savedKey !== undefined) process.env.OPENROUTER_API_KEY = savedKey;
      else delete process.env.OPENROUTER_API_KEY;
    }
  });

  it("session_start fires warning notification when auth is missing", async () => {
    const savedKey = process.env.OPENROUTER_API_KEY;
    const savedDir = process.env.PI_CODING_AGENT_DIR;
    delete process.env.OPENROUTER_API_KEY;

    const notifications: Array<{ msg: string; type: string }> = [];
    let sessionStartHandler: Function | undefined;

    const mockPi = {
      registerTool() {},
      on(event: string, h: Function) {
        if (event === "session_start") sessionStartHandler = h;
      },
    };

    const mockCtx = {
      ui: {
        notify(msg: string, type: string) {
          notifications.push({ msg, type });
        },
        setStatus() {},
      },
      modelRegistry: {
        refresh() {},
      },
    };

    try {
      process.env.PI_CODING_AGENT_DIR = tempAgentDir();
      // No auth.json written — OpenRouter auth is missing

      const mod = await import("../src/index.js");
      mod.default(mockPi);

      assert.ok(sessionStartHandler, "session_start handler should be registered");
      await sessionStartHandler!({}, mockCtx);

      const authWarnings = notifications.filter(
        (n) => n.type === "warning" && n.msg.includes("No OpenRouter API key"),
      );
      assert.strictEqual(authWarnings.length, 1, "should fire one auth warning notification");
    } finally {
      if (savedKey !== undefined) process.env.OPENROUTER_API_KEY = savedKey;
      else delete process.env.OPENROUTER_API_KEY;
      if (savedDir !== undefined) process.env.PI_CODING_AGENT_DIR = savedDir;
      else delete process.env.PI_CODING_AGENT_DIR;
    }
  });

  it("session_start does NOT fire auth warning when key is present", async () => {
    const savedKey = process.env.OPENROUTER_API_KEY;
    const savedDir = process.env.PI_CODING_AGENT_DIR;
    delete process.env.OPENROUTER_API_KEY;

    const notifications: Array<{ msg: string; type: string }> = [];
    let sessionStartHandler: Function | undefined;

    const mockPi = {
      registerTool() {},
      on(event: string, h: Function) {
        if (event === "session_start") sessionStartHandler = h;
      },
    };

    const mockCtx = {
      ui: {
        notify(msg: string, type: string) {
          notifications.push({ msg, type });
        },
        setStatus() {},
      },
      modelRegistry: {
        refresh() {},
      },
    };

    try {
      const dir = tempAgentDir();
      writeAuthJson(dir, { openrouter: { type: "api_key", key: "sk-or-v1-test" } });
      process.env.PI_CODING_AGENT_DIR = dir;

      const mod = await import("../src/index.js");
      mod.default(mockPi);

      assert.ok(sessionStartHandler, "session_start handler should be registered");
      await sessionStartHandler!({}, mockCtx);

      const authWarnings = notifications.filter(
        (n) => n.type === "warning" && n.msg.includes("No OpenRouter API key"),
      );
      assert.strictEqual(authWarnings.length, 0, "should NOT fire auth warning when key present");
    } finally {
      if (savedKey !== undefined) process.env.OPENROUTER_API_KEY = savedKey;
      else delete process.env.OPENROUTER_API_KEY;
      if (savedDir !== undefined) process.env.PI_CODING_AGENT_DIR = savedDir;
      else delete process.env.PI_CODING_AGENT_DIR;
    }
  });

  it("session_start fires deprecation notice when flat keys exist and version changed", async () => {
    // Scenario: upgrading user with flat intelli* keys in settings
    const savedKey = process.env.OPENROUTER_API_KEY;
    const savedDir = process.env.PI_CODING_AGENT_DIR;
    const savedCwd = process.cwd();
    delete process.env.OPENROUTER_API_KEY;

    const notifications: Array<{ msg: string; type: string }> = [];
    let sessionStartHandler: Function | undefined;

    const mockPi = {
      registerTool() {},
      on(event: string, h: Function) {
        if (event === "session_start") sessionStartHandler = h;
      },
    };

    const mockCtx = {
      ui: {
        notify(msg: string, type: string) {
          notifications.push({ msg, type });
        },
        setStatus() {},
      },
      modelRegistry: {
        refresh() {},
      },
    };

    try {
      // Agent dir has auth so the auth warning doesn't fire.
      // Write a previous version marker so the handler detects an upgrade.
      const agentDir = tempAgentDir();
      writeAuthJson(agentDir, { openrouter: { type: "api_key", key: "sk-or-v1-test" } });
      // Simulate a prior 0.6.0 install by writing the version file
      writeFileSync(
        join(agentDir, ".pi-intelli-search-version.json"),
        JSON.stringify({ version: "0.6.0" }),
      );
      process.env.PI_CODING_AGENT_DIR = agentDir;

      // CWD has flat intelli* keys in project settings
      const cwd = mkdtempSync(join(tmpdir(), "pi-intelli-deprecation-"));
      const piDir = join(cwd, ".pi");
      mkdirSync(piDir, { recursive: true });
      writeFileSync(
        join(piDir, "settings.json"),
        JSON.stringify({ intelliMaxUrls: 12 }),
      );

      process.chdir(cwd);

      const mod = await import("../src/index.js");
      mod.default(mockPi);

      assert.ok(sessionStartHandler, "session_start handler should be registered");
      await sessionStartHandler!({}, mockCtx);

      const deprecationNotices = notifications.filter(
        (n) => n.type === "warning" && n.msg.includes("Flat 'intelli*' settings keys are deprecated"),
      );
      assert.strictEqual(deprecationNotices.length, 1, "should fire deprecation notice on upgrade with flat keys");
    } finally {
      process.chdir(savedCwd);
      if (savedKey !== undefined) process.env.OPENROUTER_API_KEY = savedKey;
      else delete process.env.OPENROUTER_API_KEY;
      if (savedDir !== undefined) process.env.PI_CODING_AGENT_DIR = savedDir;
      else delete process.env.PI_CODING_AGENT_DIR;
    }
  });

  it("session_start does NOT fire deprecation notice on fresh install", async () => {
    // Scenario: first-time user, no .pi-intelli-search-version.json in agent dir
    const savedKey = process.env.OPENROUTER_API_KEY;
    const savedDir = process.env.PI_CODING_AGENT_DIR;
    const savedCwd = process.cwd();
    delete process.env.OPENROUTER_API_KEY;

    const notifications: Array<{ msg: string; type: string }> = [];
    let sessionStartHandler: Function | undefined;

    const mockPi = {
      registerTool() {},
      on(event: string, h: Function) {
        if (event === "session_start") sessionStartHandler = h;
      },
    };

    const mockCtx = {
      ui: {
        notify(msg: string, type: string) {
          notifications.push({ msg, type });
        },
        setStatus() {},
      },
      modelRegistry: {
        refresh() {},
      },
    };

    try {
      const agentDir = tempAgentDir();
      writeAuthJson(agentDir, { openrouter: { type: "api_key", key: "sk-or-v1-test" } });
      process.env.PI_CODING_AGENT_DIR = agentDir;

      // Fresh agent dir — no .pi-intelli-search-version.json, .pi/settings.json
      const cwd = mkdtempSync(join(tmpdir(), "pi-intelli-fresh-"));
      process.chdir(cwd);

      const mod = await import("../src/index.js");
      mod.default(mockPi);

      assert.ok(sessionStartHandler, "session_start handler should be registered");
      await sessionStartHandler!({}, mockCtx);

      const deprecationNotices = notifications.filter(
        (n) => n.type === "warning" && n.msg.includes("Flat 'intelli*' settings keys are deprecated"),
      );
      assert.strictEqual(deprecationNotices.length, 0, "no deprecation notice on fresh install");
    } finally {
      process.chdir(savedCwd);
      if (savedKey !== undefined) process.env.OPENROUTER_API_KEY = savedKey;
      else delete process.env.OPENROUTER_API_KEY;
      if (savedDir !== undefined) process.env.PI_CODING_AGENT_DIR = savedDir;
      else delete process.env.PI_CODING_AGENT_DIR;
    }
  });

  it("session_start fires migration notification when defaults changed", async () => {
    // Simulate upgrade from 0.7.0 with old default model configs.
    // The handler should detect the version change and notify about
    // the model migration.
    const savedKey = process.env.OPENROUTER_API_KEY;
    const savedDir = process.env.PI_CODING_AGENT_DIR;
    const savedCwd = process.cwd();
    delete process.env.OPENROUTER_API_KEY;

    const notifications: Array<{ msg: string; type: string }> = [];
    let sessionStartHandler: Function | undefined;

    const mockPi = {
      registerTool() {},
      on(event: string, h: Function) {
        if (event === "session_start") sessionStartHandler = h;
      },
    };

    const mockCtx = {
      ui: {
        notify(msg: string, type: string) {
          notifications.push({ msg, type });
        },
        setStatus() {},
      },
      modelRegistry: {
        refresh() {},
      },
    };

    try {
      // Clear any stale migration state from previous tests
      const { clearMigrationContext } = await import("../src/settings.js");
      clearMigrationContext();

      // Agent dir: auth present, version marker claims 0.7.0
      const agentDir = tempAgentDir();
      writeAuthJson(agentDir, { openrouter: { type: "api_key", key: "sk-or-v1-test" } });
      writeFileSync(
        join(agentDir, ".pi-intelli-search-version.json"),
        JSON.stringify({ version: "0.7.0" }),
      );
      // settings.json with old 0.7.0 default models (minimax direct)
      writeFileSync(
        join(agentDir, "settings.json"),
        JSON.stringify({
          intelliExtractModel: { provider: "minimax", model: "MiniMax-M2.7" },
          intelliCollateModel: { provider: "minimax", model: "MiniMax-M2.7" },
          intelliSearchModel: { provider: "openrouter", model: "perplexity/sonar" },
        }),
      );
      process.env.PI_CODING_AGENT_DIR = agentDir;

      // CWD with no project-local settings
      const cwd = mkdtempSync(join(tmpdir(), "pi-intelli-migration-"));
      process.chdir(cwd);

      const mod = await import("../src/index.js");
      mod.default(mockPi);

      assert.ok(sessionStartHandler, "session_start handler should be registered");
      await sessionStartHandler!({}, mockCtx);

      const migrationNotices = notifications.filter(
        (n) => n.type === "warning" && n.msg.includes("Default models updated"),
      );
      assert.strictEqual(migrationNotices.length, 1, "should fire migration notification");
      assert.ok(
        migrationNotices[0].msg.includes("extract: minimax/MiniMax-M2.7 → openrouter/minimax/minimax-m2.7"),
        "should list extract migration",
      );
      assert.ok(
        migrationNotices[0].msg.includes("collate: minimax/MiniMax-M2.7 → openrouter/minimax/minimax-m2.7"),
        "should list collate migration",
      );

      // Verify the pipeline actually runs on migrated settings (C1 regression guard).
      const { loadSettings } = await import("../src/settings.js");
      const post = await loadSettings(cwd);
      assert.strictEqual(post.extractModel.provider, "openrouter", "extract model should be migrated");
      assert.strictEqual(post.collateModel.provider, "openrouter", "collate model should be migrated");
      assert.strictEqual(post.extractModel.model, "minimax/minimax-m2.7");
      assert.strictEqual(post.collateModel.model, "minimax/minimax-m2.7");
    } finally {
      process.chdir(savedCwd);
      if (savedKey !== undefined) process.env.OPENROUTER_API_KEY = savedKey;
      else delete process.env.OPENROUTER_API_KEY;
      if (savedDir !== undefined) process.env.PI_CODING_AGENT_DIR = savedDir;
      else delete process.env.PI_CODING_AGENT_DIR;
    }
  });

  it("session_start does NOT fire migration when user customized models", async () => {
    // Simulate upgrade from 0.7.0, but user customized extract model.
    // The handler should NOT migrate customized models.
    const savedKey = process.env.OPENROUTER_API_KEY;
    const savedDir = process.env.PI_CODING_AGENT_DIR;
    const savedCwd = process.cwd();
    delete process.env.OPENROUTER_API_KEY;

    const notifications: Array<{ msg: string; type: string }> = [];
    let sessionStartHandler: Function | undefined;

    const mockPi = {
      registerTool() {},
      on(event: string, h: Function) {
        if (event === "session_start") sessionStartHandler = h;
      },
    };

    const mockCtx = {
      ui: {
        notify(msg: string, type: string) {
          notifications.push({ msg, type });
        },
        setStatus() {},
      },
      modelRegistry: {
        refresh() {},
      },
    };

    try {
      // Clear any stale migration state from previous tests
      const { clearMigrationContext } = await import("../src/settings.js");
      clearMigrationContext();

      // Agent dir: auth present, version marker claims 0.7.0
      const agentDir = tempAgentDir();
      writeAuthJson(agentDir, { openrouter: { type: "api_key", key: "sk-or-v1-test" } });
      writeFileSync(
        join(agentDir, ".pi-intelli-search-version.json"),
        JSON.stringify({ version: "0.7.0" }),
      );
      // settings.json with CUSTOMIZED extract model (not the old default)
      writeFileSync(
        join(agentDir, "settings.json"),
        JSON.stringify({
          intelliExtractModel: { provider: "openai", model: "gpt-4o-mini" },
          intelliCollateModel: { provider: "minimax", model: "MiniMax-M2.7" },
          intelliSearchModel: { provider: "openrouter", model: "perplexity/sonar" },
        }),
      );
      process.env.PI_CODING_AGENT_DIR = agentDir;

      const cwd = mkdtempSync(join(tmpdir(), "pi-intelli-custom-"));
      process.chdir(cwd);

      const mod = await import("../src/index.js");
      mod.default(mockPi);

      await sessionStartHandler!({}, mockCtx);

      const migrationNotices = notifications.filter(
        (n) => n.type === "warning" && n.msg.includes("Default models updated"),
      );
      // Should still migrate collate (matched old default) but NOT extract
      assert.strictEqual(migrationNotices.length, 1, "should fire for collate only");
      const notice = migrationNotices[0].msg;
      assert.ok(
        !notice.includes("extract:"),
        "should NOT mention extract (user customized)",
      );
      assert.ok(
        notice.includes("collate: minimax/MiniMax-M2.7 → openrouter/minimax/minimax-m2.7"),
        "should list collate migration",
      );
    } finally {
      process.chdir(savedCwd);
      if (savedKey !== undefined) process.env.OPENROUTER_API_KEY = savedKey;
      else delete process.env.OPENROUTER_API_KEY;
      if (savedDir !== undefined) process.env.PI_CODING_AGENT_DIR = savedDir;
      else delete process.env.PI_CODING_AGENT_DIR;
    }
  });
});
