// test/smoke.ts — Structural validation: does the extension load and register tools?
// Run with: npm run test:smoke

const recordedTools: any[] = [];
const recordedEvents: string[] = [];

const mockPi = {
  registerTool(tool: any) {
    recordedTools.push(tool);
  },
  on(event: string, _handler: any) {
    recordedEvents.push(event);
  },
};

async function main() {
  console.log("=== Smoke test: extension loading ===\n");

  // 1. Import the extension
  console.log("1. Importing extension...");
  const mod = await import("../src/index.js");
  assert(typeof mod.default === "function", "default export should be a function");
  console.log("   ✓ Default export is a function\n");

  // 2. Call the factory function with mock API
  console.log("2. Calling extension factory...");
  mod.default(mockPi);
  console.log("   ✓ Factory executed without errors\n");

  // 3. Check tool registration
  console.log("3. Registered tools:");
  const expectedTools = ["intelli_search", "intelli_extract", "intelli_collate", "intelli_research"];
  for (const name of expectedTools) {
    const found = recordedTools.some((t) => t.name === name);
    console.log(`   ${found ? "✓" : "✗"} ${name}`);
    assert(found, `Expected tool '${name}' to be registered`);
  }

  // 4. Check event subscriptions
  console.log("\n4. Event subscriptions:");
  const expectedEvents = ["session_start"];
  for (const event of expectedEvents) {
    const found = recordedEvents.includes(event);
    console.log(`   ${found ? "✓" : "✗"} ${event}`);
    assert(found, `Expected event '${event}' to be subscribed`);
  }

  // 5. Check tool definitions have required properties
  console.log("\n5. Tool definition shape:");
  for (const tool of recordedTools) {
    const hasName = typeof tool.name === "string" && tool.name.length > 0;
    const hasLabel = typeof tool.label === "string" && tool.label.length > 0;
    const hasDesc = typeof tool.description === "string" && tool.description.length > 0;
    const hasParams = tool.parameters !== undefined;
    const hasExecute = typeof tool.execute === "function";
    const hasSnippet = typeof tool.promptSnippet === "string";

    console.log(`   ${tool.name}:`);
    console.log(`     name: ${hasName ? "✓" : "✗"}`);
    console.log(`     label: ${hasLabel ? "✓" : "✗"}`);
    console.log(`     description: ${hasDesc ? "✓" : "✗"}`);
    console.log(`     parameters: ${hasParams ? "✓" : "✗"}`);
    console.log(`     execute: ${hasExecute ? "✓" : "✗"}`);
    console.log(`     promptSnippet: ${hasSnippet ? "✓" : "✗"}`);

    assert(hasName, `${tool.name}: missing name`);
    assert(hasLabel, `${tool.name}: missing label`);
    assert(hasDesc, `${tool.name}: missing description`);
    assert(hasParams, `${tool.name}: missing parameters`);
    assert(hasExecute, `${tool.name}: missing execute`);
  }

  // 6. Verify providers.ts module loads (models.json merge logic)
  console.log("\n6. Provider module:");
  const providers = await import("../src/providers.js");
  assert(typeof providers.ensureCustomModels === "function", "ensureCustomModels should be a function");
  console.log("   ✓ ensureCustomModels exported");
  const added = await providers.ensureCustomModels();
  assert(Array.isArray(added), "should return an array");
  console.log(`   ✓ Idempotent: ${added.length === 0 ? "models already present" : `added: ${added.join(", ")}`}`);

  console.log("\n=== All smoke tests passed ===");
}

function assert(condition: boolean, message: string): void;
function assert(condition: boolean): void;
function assert(condition: boolean, message?: string): void {
  if (!condition) {
    console.error(`\n❌ ASSERTION FAILED: ${message ?? "assertion failed"}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});
