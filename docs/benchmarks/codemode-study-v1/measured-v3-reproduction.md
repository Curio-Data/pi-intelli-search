# Measured-v3 Reproduction Record

Revision: `measured-v3-reproduction-1`.

## Outcome

The committed `measured-v3` bundle reproduced successfully outside any repository checkout under Node v22.23.3 and v24.19.0. Each runtime produced byte-identical analysis and effects and verified 39 files with 19 derived artefacts. No model call, credential read or study-network request occurred. Network access was limited to public npm registry provisioning.

Each dedicated parent held only the unpacked bundle, copied pin manifests and an isolated home directory before provisioning. Dependencies and all output directories remained outside the immutable bundle. The loader resolved from the dedicated parent's `node_modules`; `.bin/tsx` and `.bin/esbuild` were present, and `readelf` identified esbuild as an executable file on both runs.

## Procedure

For each runtime, the bundle was copied to a dedicated parent and `npm ci --no-audit --no-fund` installed the pinned loader from the public registry with a cold cache. The following commands ran from inside the bundle:

```bash
node --import tsx source/study-analysis.ts dataset.json ../analysis-check
node --import tsx source/study-publication.ts verify . ../verify-check
diff -u derived/analysis.json ../analysis-check/analysis.json
diff -u derived/effects.csv ../analysis-check/effects.csv
```

All commands exited zero. The Node 24 npm 11.17.0 run printed an `allow-scripts` warning for esbuild's declared `postinstall` hook. The hook ran successfully in both runs and produced the native binary. No `--ignore-scripts` flag was used.

## Identity

- Bundle: `measured-v3/`
- Exporter commit: `3546343265110d21610f0656bc202720ed9e97c3`
- Exporter state: no tracked modifications at build; untracked files are not considered
- Dataset SHA-256: `1c5d1ce1193bca80f27625d80defa02b8ace79e02890e64cf3127266c39f1901`
- `MANIFEST.json` SHA-256: `583f0aaa5266e5ff3783fec400565b4062cd01bcd5fb35ebfd761f676439c48d`
- Loader: `tsx@4.23.15`
- Registry: `https://registry.npmjs.org`
- Host platform: Linux

The private npm lifecycle logs were retained in the study's durable evidence at verification time and were subsequently disposed under the owner's worktree-retirement approval. They were not required to run the offline commands. The committed bundle and this public record are the shareable reproduction evidence.

## Superseded Editions

Measured content is identical across v1, v2 and v3. V1 named an exporter commit whose code could not build the answers input and omitted lifecycle metadata. Untracked intermediate v2 carried `dirty: true`. V3 is the current edition: it retains lifecycle metadata, uses a clean exporter state and includes the owner decision and rebinding records.
