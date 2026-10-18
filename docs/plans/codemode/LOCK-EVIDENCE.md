# Lock Primitive Selection

Specification revision: `P0-2`. This records the coordinator's C25 selection after the first independent review blocked the earlier directory-lock/manual-recovery proposal. That proposal is superseded, not accepted. Full run-store correctness remains a P2/R1 gate.

## Selected Source

The unauthenticated public registry returned `fs-native-extensions` `1.5.1`, repository [holepunchto/fs-native-extensions](https://github.com/holepunchto/fs-native-extensions), on 2026-10-18. Its downloaded tarball matched the registry integrity value:

```text
sha512-abjiHKkYdcH5M9ikBEJb0MKb/fEpPtZx/yfLHzTptvUAoiFayX0tIe0BTLBU4SAoRyjZLzA0dP1Rn2p0+QRyVg==
```

Inspected distributed source, not only package metadata:

- `index.js`: nonblocking `tryLock()` returns false on the normalised contention error; `unlock()` releases the descriptor lock.
- `src/linux.c`: `F_OFD_SETLK` on the supplied open file description, not process-wide traditional record locks.
- `src/apple.c`: whole-file `flock` calls.
- `src/win32.c`: `LockFileEx` / `UnlockFileEx` on the supplied handle.
- `src/shared.c`: normalises the supported contention statuses. Thread-backed waiting exists but is not selected.
- `binding.c` and the package licence/dependencies: the package is Apache-2.0 and uses `require-addon` / `which-runtime` transitively.

Package extraction and a pinned install occurred only in an encrypted worktree `.tmp/` prefix with lifecycle scripts disabled. The root shared `node_modules` symlink and both production manifests/lockfile were untouched. An audit of that isolated probe installation exited zero. This is not the production tarball gate.

## Observed Local Probe

On the current Linux x86-64 / Node.js 24 / encrypted local btrfs environment, the probe observed:

1. Separate descriptors in the same process conflict on the same lockfile.
2. Closing a third unrelated descriptor does not release the owner's lock.
3. Independent cooperating processes serialise a critical section and sequence append without overlap.
4. Killing the holder with `SIGKILL` permits a waiting descriptor to acquire without deleting or renaming the lockfile.
5. The lockfile's device/inode identity is unchanged across those acquisitions.

Raw source/tarball/integrity/install/audit evidence and the executable probe/result are retained under `.tmp/codemode-p0-evidence/` in this worktree and covered by the private checkpoint manifest. These are primitive sanity observations, not crash durability or actual engine acceptance. The older mkdir/quarantine probe is retained as superseded evidence, not a recommended recovery procedure.

## Remaining Gates

P2 must test cancellation, descriptor lifecycle/reentry, independent-process allocation/index transactions, journal crash boundaries and the no-inode-replacement invariant. P2 also freezes versioned on-disk schemas before reader/writer integration. P4/P6 must exercise actual adapter shutdown and the prespecified cancellation target. Both runtime manifests, standalone dependency/asset/legal inventory, embedded-source security checks, native-floor and fresh production tarball installs must include this selected dependency before R1. Other operating systems/filesystems remain unverified until their own gates pass; source branches and prebuild files do not prove runtime compatibility.

If the binding is unsupported, use the explicit non-persisted-answer diagnostic rather than a directory/PID/age fallback or an extension-load failure. No manual cleanup of a normal crashed holder is required. Journal corruption is a different recovery problem and must never silently reset or quarantine away the existing namespace.
