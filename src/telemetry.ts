// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Compatibility facade for native consumers. Core never discovers a manifest.
import { TelemetryBuilder as CoreTelemetryBuilder } from "./core/telemetry.js";
import { getNativeIdentity } from "./native-identity.js";
export { SCHEMA_VERSION, writeTelemetry } from "./core/telemetry.js";
export type { TelemetryMeta, TelemetryOutcome } from "./core/telemetry.js";
export {
  getExtensionVersion,
  readVersionFromPackageJson,
  _resetVersionCacheForTests,
} from "./native-identity.js";
export type TelemetryBuilder = CoreTelemetryBuilder;
export const TelemetryBuilder = {
  async create(query: string): Promise<CoreTelemetryBuilder> {
    return CoreTelemetryBuilder.create(query, await getNativeIdentity());
  },
};
