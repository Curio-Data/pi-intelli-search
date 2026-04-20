// test/helpers.ts — Shared test utilities
import { describe, it } from "node:test";

/** Convenience wrapper: run a batch of [input, expected] cases. */
export function tableTest<T, U>(
  fn: (input: T) => U,
  cases: Array<{ name: string; input: T; expected: U }>,
) {
  for (const { name, input, expected } of cases) {
    it(name, () => {
      const result = fn(input);
      if (typeof result === "object" && result !== null) {
        assert.deepStrictEqual(result, expected);
      } else {
        assert.strictEqual(result, expected);
      }
    });
  }
}

export { describe, it };
export * as assert from "node:assert/strict";
