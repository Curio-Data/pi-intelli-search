// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Clock, ResearchExecutionSettings } from "../src/core/contracts.js";
import {
  createPageDeadline,
  medianMs,
  quorumCount,
  type PageDeadline,
  type PageDeadlineOptions,
  type PageDeadlineSnapshot,
} from "../src/core/page-deadline.js";

/** Deterministic monotonic clock; callbacks run only when the test delivers them. */
class ManualClock implements Clock {
  now = 0;
  scheduled = 0;
  private seq = 0;
  private timers: Array<{ at: number; seq: number; callback: () => void }> = [];

  monotonicMs(): number {
    return this.now;
  }
  utcIso(): string {
    return new Date(Date.UTC(2026, 9, 22) + this.now).toISOString();
  }
  schedule(delayMs: number, callback: () => void): () => void {
    this.scheduled++;
    const timer = { at: this.now + Math.max(0, delayMs), seq: ++this.seq, callback };
    this.timers.push(timer);
    return () => {
      this.timers = this.timers.filter((entry) => entry !== timer);
    };
  }
  sleep(): Promise<void> {
    throw new Error("page deadline must not sleep");
  }
  get pending(): number {
    return this.timers.length;
  }
  get dueTimes(): number[] {
    return this.timers.map((timer) => timer.at).sort((a, b) => a - b);
  }
  /** Move time without delivering callbacks, as a late timer queue would. */
  set(at: number): void {
    this.now = at;
  }
  /** Deliver callbacks due at or before now, in due order. */
  deliver(): void {
    for (;;) {
      const due = this.timers.filter((timer) => timer.at <= this.now).sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
      if (!due) return;
      this.timers = this.timers.filter((timer) => timer !== due);
      due.callback();
    }
  }
  advanceTo(at: number): void {
    for (;;) {
      const due = this.timers.filter((timer) => timer.at <= at).sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
      if (!due) break;
      this.timers = this.timers.filter((timer) => timer !== due);
      this.now = due.at;
      due.callback();
    }
    this.now = at;
  }
}

type Policy = ResearchExecutionSettings["deadline"];

function enabled(overrides: Partial<Extract<Policy, { enabled: true }>> = {}): Policy {
  return { enabled: true, quorum: 0.5, factor: 1, floorMs: 0, ceilingMs: 1000, minSources: 1, ...overrides };
}

function harness(policy: Policy, ids: readonly string[], extra: Partial<PageDeadlineOptions> = {}) {
  const clock = new ManualClock();
  const frozen: PageDeadlineSnapshot[] = [];
  const deadline: PageDeadline = createPageDeadline({
    clock,
    policy,
    candidateIds: ids,
    onFreeze: (snapshot) => frozen.push(snapshot),
    ...extra,
  });
  /** Terminal event at an exact time, without delivering timers first. */
  const at = (time: number, id: string, success: boolean) => {
    clock.set(time);
    return deadline.terminal(id, success);
  };
  return { clock, frozen, deadline, at };
}

const ids = (count: number) => Array.from({ length: count }, (_, i) => `S${i + 1}`);

describe("page deadline: lifecycle", () => {
  it("construction starts no timer and start rejects duplicates", () => {
    const { clock, deadline, frozen } = harness(enabled(), ids(2));
    assert.equal(clock.scheduled, 0);
    clock.set(5);
    deadline.start();
    assert.deepEqual(clock.dueTimes, [1005]);
    assert.throws(() => deadline.start(), /already started/);
    assert.equal(clock.scheduled, 1);
    assert.equal(frozen.length, 0);
    assert.equal(deadline.snapshot(), undefined);
  });

  it("rejects terminal events before start", () => {
    const { deadline } = harness(enabled(), ids(2));
    assert.throws(() => deadline.terminal("S1", true), /not started/);
  });

  it("N = 0 freezes as not-applicable at start with no page timer", () => {
    const { clock, deadline, frozen } = harness(enabled(), []);
    clock.set(7);
    deadline.start();
    assert.equal(clock.scheduled, 0);
    assert.deepEqual(frozen, [
      { terminalIds: [], successIds: [], reason: "not-applicable", minimumMet: true, startedAtMs: 7, frozenAtMs: 7 },
    ]);
  });

  it("dispose is idempotent, clears timers and never manufactures a freeze", () => {
    const { clock, deadline, frozen, at } = harness(enabled({ quorum: 0.25 }), ids(4));
    deadline.start();
    assert.equal(at(10, "S1", true), true);
    assert.equal(clock.pending, 2);
    deadline.dispose();
    deadline.dispose();
    assert.equal(clock.pending, 0);
    clock.advanceTo(5000);
    assert.equal(at(5000, "S2", true), false);
    assert.equal(deadline.terminal("S2", true), false, "repeat after dispose is not accepted");
    assert.equal(deadline.terminal("S1", false), false, "already-terminal page after dispose");
    assert.throws(() => deadline.terminal("S9", true), /unknown/);
    assert.throws(() => deadline.terminal("S3", 1 as unknown as boolean), /boolean/);
    assert.equal(deadline.snapshot(), undefined);
    assert.equal(frozen.length, 0);
    assert.throws(() => deadline.start(), /disposed/);
  });

  it("start after dispose rejects without scheduling", () => {
    const { clock, deadline } = harness(enabled(), ids(1));
    deadline.dispose();
    assert.throws(() => deadline.start(), /disposed/);
    assert.equal(clock.scheduled, 0);
  });

  it("dispose after freeze keeps the snapshot", () => {
    const { deadline, frozen, at } = harness(enabled(), ids(1));
    deadline.start();
    at(3, "S1", true);
    deadline.dispose();
    assert.equal(deadline.snapshot(), frozen[0]);
  });
});

describe("page deadline: disabled policy", () => {
  it("creates no timer and freezes at all-terminal with reason disabled", () => {
    const { clock, deadline, frozen, at } = harness({ enabled: false }, ids(3));
    deadline.start();
    assert.equal(clock.scheduled, 0);
    assert.equal(at(100, "S2", false), true);
    assert.equal(at(90_000, "S1", true), true);
    assert.equal(frozen.length, 0);
    assert.equal(at(900_000, "S3", true), true);
    assert.equal(clock.scheduled, 0);
    assert.deepEqual(frozen, [
      {
        terminalIds: ["S1", "S2", "S3"],
        successIds: ["S1", "S3"],
        reason: "disabled",
        minimumMet: true,
        startedAtMs: 0,
        frozenAtMs: 900_000,
      },
    ]);
  });

  it("all-failed disabled phase still freezes with empty evidence", () => {
    const { deadline, frozen, at } = harness({ enabled: false }, ids(1));
    deadline.start();
    at(4, "S1", false);
    assert.deepEqual(frozen[0].successIds, []);
    assert.equal(frozen[0].reason, "disabled");
  });
});

describe("page deadline: C08 enabled matrix", () => {
  it("N = 1 success ends immediately as all-terminal, before the floor", () => {
    const { clock, deadline, frozen, at } = harness(enabled({ floorMs: 500 }), ids(1));
    deadline.start();
    assert.equal(at(20, "S1", true), true);
    assert.equal(frozen.length, 1);
    assert.equal(frozen[0].reason, "all-terminal");
    assert.equal(frozen[0].frozenAtMs, 20);
    assert.equal(clock.pending, 0);
  });

  it("N = 2 reaches quorum on the first event and arms from that one latency", () => {
    const { clock, deadline, frozen, at } = harness(enabled({ factor: 2 }), ids(2));
    deadline.start();
    at(30, "S2", true);
    assert.deepEqual(clock.dueTimes, [90, 1000]);
    clock.advanceTo(90);
    assert.deepEqual(frozen, [
      {
        terminalIds: ["S2"],
        successIds: ["S2"],
        reason: "adaptive",
        minimumMet: true,
        startedAtMs: 0,
        frozenAtMs: 90,
        adaptiveAtMs: 90,
        ceilingAtMs: 1000,
      },
    ]);
    assert.equal(clock.pending, 0);
    assert.equal(at(95, "S1", true), false);
  });

  it("odd success count uses the middle latency", () => {
    const { clock, deadline, frozen, at } = harness(enabled({ quorum: 0.6, factor: 2 }), ids(5));
    deadline.start();
    at(10, "S1", true);
    at(60, "S3", true);
    assert.equal(frozen.length, 0);
    at(70, "S2", true);
    // Quorum 3 at t=70; latencies 10, 60, 70 -> median 60; 70 + 2 * 60.
    assert.deepEqual(clock.dueTimes, [190, 1000]);
    clock.advanceTo(190);
    assert.equal(frozen[0].adaptiveAtMs, 190);
  });

  it("even success count averages the central pair", () => {
    const { clock, deadline, at } = harness(enabled({ quorum: 0.5 }), ids(8));
    deadline.start();
    at(10, "S1", true);
    at(20, "S2", true);
    at(50, "S3", true);
    at(100, "S4", true);
    // Quorum 4 at t=100; median (20 + 50) / 2 = 35.
    assert.deepEqual(clock.dueTimes, [135, 1000]);
  });

  it("failures count toward quorum but not the median", () => {
    const { clock, deadline, frozen, at } = harness(enabled({ quorum: 0.5 }), ids(4));
    deadline.start();
    at(10, "S1", false);
    at(20, "S2", false);
    assert.deepEqual(clock.dueTimes, [1000], "quorum without success stays unarmed");
    at(40, "S3", true);
    assert.deepEqual(clock.dueTimes, [80, 1000]);
    clock.advanceTo(80);
    assert.deepEqual(frozen[0].terminalIds, ["S1", "S2", "S3"]);
    assert.deepEqual(frozen[0].successIds, ["S3"]);
  });

  it("the state machine uses the literal quorum (N = 100, quorum 0.07 needs 8 pages)", () => {
    const { clock, deadline, at } = harness(enabled({ quorum: 0.07 }), ids(100));
    deadline.start();
    for (let i = 1; i <= 7; i++) at(i * 10, `S${i}`, true);
    assert.deepEqual(clock.dueTimes, [1000], "seven terminal pages do not reach quorum");
    at(80, "S8", true);
    // Latencies 10..80 -> median 45; 80 + 45.
    assert.deepEqual(clock.dueTimes, [125, 1000]);
  });

  it("adaptive time is computed once and later pages do not move it", () => {
    const { clock, deadline, frozen, at } = harness(enabled({ quorum: 0.25 }), ids(4));
    deadline.start();
    at(100, "S1", true);
    assert.deepEqual(clock.dueTimes, [200, 1000]);
    at(110, "S2", true);
    at(190, "S3", true);
    assert.deepEqual(clock.dueTimes, [200, 1000]);
    clock.advanceTo(200);
    assert.equal(frozen[0].adaptiveAtMs, 200);
    assert.deepEqual(frozen[0].successIds, ["S1", "S2", "S3"]);
  });

  it("no quorum before the ceiling freezes at the ceiling", () => {
    const { clock, deadline, frozen, at } = harness(enabled({ quorum: 1, minSources: 2 }), ids(3));
    deadline.start();
    at(10, "S1", true);
    clock.advanceTo(1000);
    assert.equal(frozen[0].reason, "ceiling");
    assert.equal(frozen[0].minimumMet, false);
    assert.equal(frozen[0].adaptiveAtMs, undefined);
    assert.deepEqual(frozen[0].successIds, ["S1"]);
  });

  it("ceiling with zero successes records empty evidence", () => {
    const { clock, deadline, frozen, at } = harness(enabled(), ids(3));
    deadline.start();
    at(10, "S1", false);
    clock.advanceTo(1000);
    assert.deepEqual(frozen[0].successIds, []);
    assert.deepEqual(frozen[0].terminalIds, ["S1"]);
    assert.equal(frozen[0].minimumMet, false);
  });

  it("all failures end as all-terminal with empty evidence", () => {
    const { clock, deadline, frozen, at } = harness(enabled(), ids(2));
    deadline.start();
    at(10, "S1", false);
    at(15, "S2", false);
    assert.equal(frozen[0].reason, "all-terminal");
    assert.deepEqual(frozen[0].successIds, []);
    assert.equal(frozen[0].minimumMet, false);
    assert.equal(clock.pending, 0);
  });

  it("all-terminal ends the phase before the floor", () => {
    const { clock, deadline, frozen, at } = harness(enabled({ floorMs: 800 }), ids(3));
    deadline.start();
    at(10, "S1", true);
    at(20, "S2", true);
    at(30, "S3", true);
    assert.equal(frozen[0].reason, "all-terminal");
    assert.equal(frozen[0].adaptiveAtMs, 800);
    assert.equal(clock.pending, 0);
  });

  it("clamps adaptive time up to the floor", () => {
    const { clock, deadline, at } = harness(enabled({ floorMs: 300 }), ids(4));
    clock.set(1000);
    deadline.start();
    at(1010, "S1", true);
    at(1020, "S2", true);
    assert.deepEqual(clock.dueTimes, [1300, 2000]);
  });

  it("clamps adaptive time down to the ceiling and leaves the ceiling to decide", () => {
    const { clock, deadline, frozen, at } = harness(enabled({ factor: 10, ceilingMs: 400 }), ids(2));
    deadline.start();
    at(100, "S1", true);
    assert.deepEqual(clock.dueTimes, [400]);
    clock.advanceTo(400);
    assert.equal(frozen[0].reason, "ceiling");
    assert.equal(frozen[0].adaptiveAtMs, 400);
  });

  it("zero median at a zero floor freezes adaptively and includes the arming event", () => {
    const { clock, deadline, frozen, at } = harness(enabled(), ids(2));
    deadline.start();
    assert.equal(at(0, "S1", true), true);
    assert.equal(frozen[0].reason, "adaptive");
    assert.deepEqual(frozen[0].successIds, ["S1"]);
    assert.equal(clock.pending, 0);
  });

  it("holds below the minimum after adaptive time, then freezes on the minimum success", () => {
    const { clock, deadline, frozen, at } = harness(enabled({ quorum: 0.4, minSources: 3 }), ids(5));
    deadline.start();
    at(10, "S1", true);
    at(20, "S2", false);
    assert.deepEqual(clock.dueTimes, [30, 1000]);
    clock.advanceTo(30);
    assert.equal(frozen.length, 0, "no cutoff while the minimum is unmet");
    assert.deepEqual(clock.dueTimes, [1000]);
    assert.equal(at(40, "S3", false), true);
    assert.equal(at(50, "S4", true), true);
    assert.equal(frozen.length, 0);
    assert.equal(at(60, "S5", true), true);
    assert.equal(frozen[0].reason, "all-terminal", "the minimum event also finished every page");
  });

  it("post-adaptive success meeting the minimum freezes with reason minimum", () => {
    const { clock, deadline, frozen, at } = harness(enabled({ quorum: 0.4, minSources: 2 }), ids(5));
    deadline.start();
    at(10, "S1", true);
    at(20, "S2", false);
    clock.advanceTo(30);
    assert.equal(at(50, "S4", true), true);
    assert.deepEqual(frozen, [
      {
        terminalIds: ["S1", "S2", "S4"],
        successIds: ["S1", "S4"],
        reason: "minimum",
        minimumMet: true,
        startedAtMs: 0,
        frozenAtMs: 50,
        adaptiveAtMs: 30,
        ceilingAtMs: 1000,
      },
    ]);
    assert.equal(clock.pending, 0);
  });

  it("minimum is capped at N", () => {
    const { clock, deadline, frozen, at } = harness(enabled({ quorum: 0.5, minSources: 100 }), ids(2));
    deadline.start();
    at(10, "S1", true);
    clock.advanceTo(20);
    assert.equal(frozen.length, 0, "min(100, 2) = 2 not yet met");
    at(30, "S2", false);
    assert.equal(frozen[0].reason, "all-terminal");
    assert.equal(frozen[0].minimumMet, false);
  });

  it("ceiling while holding for the minimum records minimumMet false", () => {
    const { clock, deadline, frozen, at } = harness(enabled({ quorum: 0.4, minSources: 3 }), ids(5));
    deadline.start();
    at(10, "S1", true);
    at(20, "S2", true);
    clock.advanceTo(1000);
    assert.equal(frozen[0].reason, "ceiling");
    assert.equal(frozen[0].minimumMet, false);
    assert.deepEqual(frozen[0].successIds, ["S1", "S2"]);
  });
});

describe("page deadline: equal-time ordering", () => {
  // Adaptive due at 50 with the minimum held: a terminal event at 50 is excluded either way.
  for (const order of ["timer-first", "terminal-first"] as const) {
    it(`adaptive cutoff wins an equal-time terminal (${order})`, () => {
      const { clock, deadline, frozen, at } = harness(enabled({ quorum: 0.5 }), ids(4));
      deadline.start();
      at(20, "S1", true);
      at(30, "S2", true);
      assert.deepEqual(clock.dueTimes, [55, 1000]);
      clock.set(55);
      if (order === "timer-first") clock.deliver();
      assert.equal(deadline.terminal("S3", true), false);
      clock.deliver();
      assert.equal(frozen.length, 1);
      assert.equal(frozen[0].reason, "adaptive");
      assert.deepEqual(frozen[0].terminalIds, ["S1", "S2"]);
      assert.equal(clock.pending, 0);
    });

    it(`ceiling wins an equal-time success that would meet the minimum (${order})`, () => {
      const { clock, deadline, frozen, at } = harness(enabled({ quorum: 0.4, minSources: 2 }), ids(5));
      deadline.start();
      at(10, "S1", true);
      at(20, "S2", false);
      clock.advanceTo(30);
      clock.set(1000);
      if (order === "timer-first") clock.deliver();
      assert.equal(deadline.terminal("S3", true), false);
      clock.deliver();
      assert.equal(frozen.length, 1);
      assert.equal(frozen[0].reason, "ceiling");
      assert.deepEqual(frozen[0].successIds, ["S1"]);
      assert.equal(frozen[0].minimumMet, false);
    });

    it(`held-minimum success at the adaptive instant is included (${order})`, () => {
      const { clock, deadline, frozen, at } = harness(enabled({ quorum: 0.4, minSources: 2 }), ids(5));
      deadline.start();
      at(10, "S1", true);
      at(20, "S2", false);
      clock.set(30);
      if (order === "timer-first") clock.deliver();
      assert.equal(deadline.terminal("S3", true), true);
      clock.deliver();
      assert.equal(frozen.length, 1);
      assert.equal(frozen[0].reason, "minimum");
      assert.deepEqual(frozen[0].successIds, ["S1", "S3"]);
    });
  }

  it("a success strictly before the ceiling that meets the minimum is included", () => {
    const { clock, deadline, frozen, at } = harness(enabled({ quorum: 0.4, minSources: 2 }), ids(5));
    deadline.start();
    at(10, "S1", true);
    at(20, "S2", false);
    clock.advanceTo(30);
    assert.equal(at(999.5, "S3", true), true);
    assert.equal(frozen[0].reason, "minimum");
    assert.deepEqual(frozen[0].successIds, ["S1", "S3"]);
    assert.equal(clock.pending, 0);
  });

  it("an undelivered ceiling still excludes a later terminal event", () => {
    const { clock, deadline, frozen, at } = harness(enabled(), ids(3));
    deadline.start();
    assert.equal(at(1500, "S1", true), false);
    assert.equal(deadline.terminal("S1", true), false, "the excluded event is not a duplicate error");
    assert.equal(frozen.length, 1);
    assert.equal(frozen[0].reason, "ceiling");
    assert.equal(frozen[0].frozenAtMs, 1500);
    assert.deepEqual(frozen[0].terminalIds, []);
    assert.equal(clock.pending, 0);
  });
});

describe("page deadline: events, snapshots and validation", () => {
  it("rejects unknown, duplicate and invalid terminal events", () => {
    const { deadline, frozen, at } = harness(enabled({ quorum: 1 }), ids(3));
    deadline.start();
    assert.throws(() => deadline.terminal("S9", true), /unknown/);
    assert.throws(() => deadline.terminal(undefined as unknown as string, true), /unknown/);
    assert.throws(() => deadline.terminal("S1", "yes" as unknown as boolean), /boolean/);
    assert.equal(at(5, "S1", false), true);
    assert.throws(() => deadline.terminal("S1", true), /duplicate/);
    at(6, "S2", true);
    at(7, "S3", true);
    assert.equal(frozen.length, 1);
    assert.deepEqual(frozen[0].terminalIds, ["S1", "S2", "S3"]);
    assert.deepEqual(frozen[0].successIds, ["S2", "S3"], "duplicate success did not overwrite the failure");
  });

  it("valid events after freeze return false, including duplicates; invalid ones still throw", () => {
    const { clock, deadline, frozen, at } = harness(enabled(), ids(4));
    deadline.start();
    at(10, "S1", true);
    at(20, "S2", true);
    clock.advanceTo(40);
    assert.equal(frozen.length, 1);
    assert.equal(at(50, "S3", true), false);
    assert.equal(deadline.terminal("S3", true), false, "repeat of a late page");
    assert.equal(deadline.terminal("S1", true), false, "repeat of a page recorded before freeze");
    assert.equal(at(60, "S4", false), false);
    assert.throws(() => deadline.terminal("S9", true), /unknown/);
    assert.throws(() => deadline.terminal("S4", "no" as unknown as boolean), /boolean/);
    assert.equal(frozen.length, 1);
    assert.deepEqual(deadline.snapshot()!.terminalIds, ["S1", "S2"]);
  });

  it("snapshots are immutable and in candidate order, not completion order", () => {
    const { deadline, frozen, at } = harness({ enabled: false }, ["c", "a", "b"]);
    deadline.start();
    at(1, "b", true);
    at(2, "a", false);
    at(3, "c", true);
    const snapshot = deadline.snapshot()!;
    assert.equal(snapshot, frozen[0]);
    assert.deepEqual(snapshot.terminalIds, ["c", "a", "b"]);
    assert.deepEqual(snapshot.successIds, ["c", "b"]);
    assert.ok(Object.isFrozen(snapshot));
    assert.ok(Object.isFrozen(snapshot.terminalIds));
    assert.ok(Object.isFrozen(snapshot.successIds));
    assert.throws(() => (snapshot.successIds as string[]).push("a"), TypeError);
    assert.throws(() => {
      (snapshot as { reason: string }).reason = "ceiling";
    }, TypeError);
  });

  it("does not observe later mutation of the caller's candidate array", () => {
    const candidates = ["S1", "S2"];
    const { deadline, frozen, at } = harness({ enabled: false }, candidates);
    candidates.push("S3");
    candidates[0] = "X";
    deadline.start();
    at(1, "S1", true);
    at(2, "S2", true);
    assert.deepEqual(frozen[0].terminalIds, ["S1", "S2"]);
  });

  it("invokes onFreeze once and reentrant calls observe the frozen phase", () => {
    const clock = new ManualClock();
    const seen: Array<boolean | string> = [];
    let deadline!: PageDeadline;
    deadline = createPageDeadline({
      clock,
      policy: enabled({ quorum: 0.5 }),
      candidateIds: ids(4),
      onFreeze: (snapshot) => {
        seen.push(snapshot.reason, deadline.snapshot() === snapshot, deadline.terminal("S4", true));
        deadline.dispose();
      },
    });
    deadline.start();
    clock.set(10);
    deadline.terminal("S1", true);
    clock.set(20);
    deadline.terminal("S2", true);
    clock.advanceTo(5000);
    assert.deepEqual(seen, ["adaptive", true, false]);
    assert.equal(clock.pending, 0);
  });

  it("no timer remains after any freeze reason", () => {
    for (const [policy, events, advance, reason] of [
      [enabled(), [[1, "S1", true], [2, "S2", true], [3, "S3", false]], 0, "all-terminal"],
      [enabled({ quorum: 0.3 }), [[1, "S1", true]], 100, "adaptive"],
      [enabled({ quorum: 1 }), [[1, "S1", true]], 1000, "ceiling"],
      [enabled({ quorum: 0.3, minSources: 2 }), [[1, "S1", true]], 50, "minimum"],
    ] as const) {
      const { clock, deadline, frozen, at } = harness(policy, ids(3));
      deadline.start();
      for (const [time, id, success] of events) at(time, id, success);
      clock.advanceTo(advance);
      if (reason === "minimum") at(60, "S2", true);
      assert.equal(frozen.length, 1, reason);
      assert.equal(frozen[0].reason, reason);
      assert.equal(clock.pending, 0, reason);
      clock.advanceTo(100_000);
      assert.equal(frozen.length, 1, reason);
    }
  });

  it("rejects invalid options at construction", () => {
    const valid = (): PageDeadlineOptions => ({
      clock: new ManualClock(),
      policy: enabled(),
      candidateIds: ids(2),
      onFreeze: () => {},
    });
    const bad: Array<[Partial<Record<keyof PageDeadlineOptions, unknown>>, RegExp]> = [
      [{ policy: { enabled: true } }, /quorum/],
      [{ policy: { ...enabled(), quorum: 0 } }, /quorum/],
      [{ policy: { ...enabled(), quorum: 1.01 } }, /quorum/],
      [{ policy: { ...enabled(), factor: Number.NaN } }, /factor/],
      [{ policy: { ...enabled(), floorMs: 600, ceilingMs: 500 } }, /floorMs/],
      [{ policy: { ...enabled(), ceilingMs: 0 } }, /ceilingMs/],
      [{ policy: { ...enabled(), minSources: 1.5 } }, /minSources/],
      [{ policy: { enabled: false, quorum: 1 } }, /unknown key/],
      [{ policy: undefined }, /object/],
      [{ candidateIds: ["S1", "S1"] }, /duplicate/],
      [{ candidateIds: [""] }, /nonempty/],
      [{ candidateIds: "S1" }, /array/],
      [{ onFreeze: undefined }, /onFreeze/],
      [{ clock: {} }, /clock/],
    ];
    for (const [patch, pattern] of bad) {
      assert.throws(() => createPageDeadline({ ...valid(), ...patch } as PageDeadlineOptions), pattern);
    }
  });
});

describe("page deadline: helpers", () => {
  it("quorum is the literal Math.ceil(N * quorum) on the binary product", () => {
    assert.equal(quorumCount(0, 0.5), 0);
    // Binary products are not snapped: 100 * 0.07 === 7.000000000000001.
    assert.equal(quorumCount(100, 0.07), 8);
    assert.equal(quorumCount(100, 0.14), 15);
    assert.equal(quorumCount(100, 0.57), 57);
    assert.equal(quorumCount(10, 0.3), 3);
    assert.equal(quorumCount(10, 0.1 + 0.2), 4, "a representable quorum just above 3/10 needs 4 pages");
    assert.equal(quorumCount(3, 0.5), 2);
    assert.equal(quorumCount(5, 0.01), 1);
    assert.equal(quorumCount(7, 1), 7);
    assert.equal(quorumCount(3, 1 / 3), 1);
  });

  it("median is ordinary and averages the central pair", () => {
    assert.equal(medianMs([7]), 7);
    assert.equal(medianMs([30, 10]), 20);
    assert.equal(medianMs([5, 1, 3]), 3);
    assert.equal(medianMs([1, 2, 9, 100]), 5.5);
    assert.throws(() => medianMs([]), RangeError);
  });
});
