// test/smoke.ts — Structural validation: does the extension load and register tools?
// Run with: npm run test:smoke
//
// This simulates what pi does when loading the extension: import the default
// export, call it with a mock ExtensionAPI, and verify tools are registered.

const recordedTools: string[] = [];
const recordedEvents: string[] = [];

const mockPi = {
  registerTool(tool: any) {
    recordedTools.push(tool.name);
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
  const expectedTools = ["web_search", "web_extract", "web_collate", "web_research"];
  for (const tool of expectedTools) {
    const found = recordedTools.includes(tool);
    console.log(`   ${found ? "✓" : "✗"} ${tool}`);
    assert(found, `Expected tool '${tool}' to be registered`);
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
  // Re-import to capture actual tool objects
  const tools: any[] = [];
  const capturingPi = {
    registerTool(tool: any) { tools.push(tool); },
    on() {},
  };
  mod.default(capturingPi);

  for (const tool of tools) {
    const hasName = typeof tool.name === "string" && tool.name.length > 0;
    const hasLabel = typeof tool.label === "string" && tool.label.length > 0;
    const hasDesc = typeof tool.description === "string" && tool.description.length > 0;
    const hasParams = tool.parameters !== undefined;
    const hasExecute = typeof tool.execute === "function";
    const hasSnippet = typeof tool.promptSnippet === "string";

    const name = tool.name;
    console.log(`   ${name}:`);
    console.log(`     name: ${hasName ? "✓" : "✗"}`);
    console.log(`     label: ${hasLabel ? "✓" : "✗"}`);
    console.log(`     description: ${hasDesc ? "✓" : "✗"}`);
    console.log(`     parameters: ${hasParams ? "✓" : "✗"}`);
    console.log(`     execute: ${hasExecute ? "✓" : "✗"}`);
    console.log(`     promptSnippet: ${hasSnippet ? "✓" : "✗"}`);

    assert(hasName, `${name}: missing name`);
    assert(hasLabel, `${name}: missing label`);
    assert(hasDesc, `${name}: missing description`);
    assert(hasParams, `${name}: missing parameters`);
    assert(hasExecute, `${name}: missing execute`);
  }

  console.log("\n=== All smoke tests passed ===");
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`\n❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});
