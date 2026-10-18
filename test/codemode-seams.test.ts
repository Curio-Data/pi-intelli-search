// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));

// The accepted specification is read-only. Verify actual shipped type declarations
// against it without making src depend on docs or promising unimplemented values.
describe("P0-2 type-only implementation seams (T02)", () => {
  it("are mutually assignable with every frozen core/native declaration", () => {
    const configFile = ts.readConfigFile(`${root}test/tsconfig.codemode-seams.json`, ts.sys.readFile);
    assert.equal(configFile.error, undefined);
    const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, `${root}test`);
    assert.deepEqual(config.errors, []);
    const program = ts.createProgram(config.fileNames, config.options);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (path) => path,
      getCurrentDirectory: () => root,
      getNewLine: () => "\n",
    }));
    const checker = program.getTypeChecker();
    function exportsOf(relativePath: string): Map<string, ts.Symbol> {
      const file = program.getSourceFile(`${root}${relativePath}`);
      assert.ok(file, relativePath);
      const module = checker.getSymbolAtLocation(file);
      assert.ok(module, relativePath);
      return new Map(checker.getExportsOfModule(module).map((symbol) => [symbol.name, symbol]));
    }
    function declared(symbol: ts.Symbol): ts.Type {
      return checker.getDeclaredTypeOfSymbol(
        symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol,
      );
    }
    function value(symbol: ts.Symbol): ts.Type {
      const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
      assert.ok(declaration, symbol.name);
      return checker.getTypeOfSymbolAtLocation(symbol, declaration);
    }
    function equivalent(actual: ts.Type, expected: ts.Type, label: string): void {
      assert.notEqual(actual.flags & ts.TypeFlags.Any, ts.TypeFlags.Any, `${label}: actual any`);
      assert.notEqual(expected.flags & ts.TypeFlags.Any, ts.TypeFlags.Any, `${label}: expected any`);
      assert.ok(checker.isTypeAssignableTo(actual, expected), `${label}: implementation -> specification`);
      assert.ok(checker.isTypeAssignableTo(expected, actual), `${label}: specification -> implementation`);
    }
    function surface(type: ts.Type, includeReadonly = true): unknown {
      return type.getProperties().map((property) => ({
        name: property.name,
        optional: Boolean(property.flags & ts.SymbolFlags.Optional),
        ...(includeReadonly ? { readonly: (property.declarations ?? []).some((declaration) =>
          ts.canHaveModifiers(declaration) && ts.getModifiers(declaration)?.some((modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword),
        ) } : {}),
      })).sort((a, b) => a.name.localeCompare(b.name));
    }
    const spec = exportsOf("docs/plans/codemode/API.ts");
    const core = exportsOf("src/core/contracts.ts");
    // Benchmark-only declarations start at ModelFixtureRequest and belong to P3,
    // not the core runtime. Everything preceding that boundary is checked here.
    let checked = 0;
    for (const [name, expected] of spec) {
      if (name === "ModelFixtureRequest") break;
      if (!(expected.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Class))) continue;
      const actual = core.get(name);
      assert.ok(actual, `missing core type ${name}`);
      equivalent(declared(actual), declared(expected), name);
      // Preserve the existing mutable ModelConfig export for legacy callers.
      // New identity/policy fields wrap it in Readonly; their consumer guards
      // check that the coordinated model cannot be mutated.
      assert.deepEqual(surface(declared(actual), name !== "ModelConfig"), surface(declared(expected), name !== "ModelConfig"), `${name}: property names/modifiers`);
      checked++;
    }
    assert.ok(checked >= 55, `only ${checked} core declarations checked`);
    for (const [name, type] of [
      ["createExecutionCoordinator", "ExecutionCoordinatorFactory"],
      ["createAttemptLedger", "AttemptLedgerFactory"],
      ["createRunStore", "RunStoreFactory"],
      ["runModelWithPolicy", "ModelPolicy"],
      ["operationOutputSchemas", "OperationOutputSchemas"],
      ["compactOutputSchema", "CompactOutputSchema"],
    ]) {
      equivalent(declared(core.get(type)!), value(spec.get(name)!), name);
    }
    const operations = declared(core.get("EngineOperations")!);
    for (const name of ["search", "extract", "collate", "research", "fetchPage"]) {
      equivalent(value(operations.getProperty(name)!), value(spec.get(name)!), name);
    }
    const nativeSpec = exportsOf("docs/plans/codemode/NATIVE-API.ts");
    const native = exportsOf("src/native-injection.ts");
    for (const name of ["NativeRegistryFacade", "RegistryStreamSimple", "NativeTestInjection"]) {
      equivalent(declared(native.get(name)!), declared(nativeSpec.get(name)!), name);
    }
    equivalent(declared(native.get("NativeExtensionFactory")!), value(nativeSpec.get("createNativeExtension")!), "native factory");
  });
});
