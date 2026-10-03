// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { it } from "node:test";
import { withMuzzledConsole } from "../src/core/util.js";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

for (const reject of [false, true]) {
  it(`restores console methods after interleaved scopes (${reject ? "rejection" : "success"})`, async () => {
    const error = console.error;
    const warn = console.warn;
    const a = gate();
    const b = gate();
    const first = withMuzzledConsole(
      async () => {
        await a.promise;
        console.error("A");
        console.warn("A");
        if (reject) throw new Error("scope A failed");
      },
      { error: ["A"], warn: ["A"] },
    );
    const firstOutcome = first.then(
      (value) => value,
      (error: unknown) => error,
    );
    const second = withMuzzledConsole(
      async () => {
        await b.promise;
        console.error("B");
        console.warn("B");
      },
      { error: ["B"], warn: ["B"] },
    );
    try {
      a.release();
      const firstResult = await firstOutcome;
      if (reject) assert.match(String(firstResult), /scope A failed/);
      else assert.deepEqual(firstResult, { value: undefined, muzzled: true, warned: true });
      b.release();
      assert.deepEqual(await second, { value: undefined, muzzled: true, warned: true });
      assert.equal(console.error, error);
      assert.equal(console.warn, warn);
    } finally {
      a.release();
      b.release();
      await Promise.allSettled([first, second]);
      console.error = error;
      console.warn = warn;
    }
  });
}

it("isolates identical tags between concurrent scopes and passes unrelated async logs through", async () => {
  const originalError = console.error;
  const originalWarn = console.warn;
  const seen: unknown[][] = [];
  console.error = (...args) => {
    seen.push(args);
  };
  console.warn = (...args) => {
    seen.push(args);
  };
  const end = gate();
  try {
    const first = withMuzzledConsole(
      async () => {
        await end.promise;
        console.error("shared");
        console.warn("shared");
      },
      { error: ["shared"], warn: ["shared"] },
    );
    const second = withMuzzledConsole(
      async () => {
        await end.promise;
      },
      { error: ["shared"], warn: ["shared"] },
    );
    console.error("shared", "outside both scopes");
    console.warn("shared", "outside both scopes");
    end.release();
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a.muzzled, true);
    assert.equal(a.warned, true);
    assert.equal(b.muzzled, false);
    assert.equal(b.warned, false);
    assert.deepEqual(seen, [
      ["shared", "outside both scopes"],
      ["shared", "outside both scopes"],
    ]);
  } finally {
    end.release();
    console.error = originalError;
    console.warn = originalWarn;
  }
});

it("preserves nested suppression without capturing a detached task after its scope ends", async () => {
  const original = console.error;
  const seen: unknown[][] = [];
  console.error = (...args) => {
    seen.push(args);
  };
  const late = gate();
  let detached: Promise<void> | undefined;
  try {
    const outer = await withMuzzledConsole(
      async () => {
        detached = late.promise.then(() => {
          console.error("outer", "detached");
        });
        const inner = await withMuzzledConsole(
          async () => {
            console.error("outer");
          },
          { error: ["inner"] },
        );
        assert.equal(inner.muzzled, false);
      },
      { error: ["outer"] },
    );
    assert.equal(outer.muzzled, true);
    await withMuzzledConsole(
      async () => {
        late.release();
        await detached;
      },
      { error: ["outer"] },
    );
    assert.deepEqual(seen, [["outer", "detached"]]);
  } finally {
    late.release();
    await detached;
    console.error = original;
  }
});
