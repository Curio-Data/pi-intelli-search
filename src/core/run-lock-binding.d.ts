// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// The subset of fs-native-extensions 1.5.1 that C25 permits. The package ships
// no declarations; blocking/thread-backed waits are deliberately not declared.
declare module "fs-native-extensions" {
  export function tryLock(fd: number): boolean;
  export function unlock(fd: number): void;
}
