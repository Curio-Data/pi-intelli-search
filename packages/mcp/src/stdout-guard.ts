// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { Writable } from "node:stream";

let protocol: Writable | undefined;

/**
 * Diverts every later process.stdout.write (including console output and
 * dependency writes) to standard error. Protocol frames bypass the patch
 * because the transport owns the returned stream, which writes through the
 * original stdout binding captured here. Install before loading any module
 * whose import-time output could corrupt framing.
 */
export function installStdoutGuard(): Writable {
  if (protocol) return protocol;
  const original = process.stdout.write.bind(process.stdout);
  const divert: (...args: unknown[]) => boolean = process.stderr.write.bind(
    process.stderr,
  ) as (...args: unknown[]) => boolean;
  protocol = new Writable({
    write(chunk, encoding, callback) {
      original(chunk, encoding, callback);
    },
  });
  // A host closing our standard output raises EPIPE on the real stream. Sink
  // it here: the wrapper's callback error still reaches the transport's own
  // error handler through `protocol`, taking the SDK's graceful close path
  // instead of crashing with an unhandled 'error' event.
  process.stdout.on("error", () => {});
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) =>
    divert(chunk, ...rest)) as typeof process.stdout.write;
  return protocol;
}
