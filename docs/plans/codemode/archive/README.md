# Historical M4 Source Overlay

`m4-source-overlay.patch` preserves the staged and unstaged source changes found in the standalone M4 checkpoint snapshot before worktree cleanup. It is a compact source-preservation record, not part of the Codemode study's measured execution and not a proposal to resume the stopped helper or security work.

Apply the patch to base commit `614dee46c4fd16d307503d5708f15fbdea7fe1f9`. The original snapshot had 25 modified paths, comprising 3,578 insertions and 32 deletions across staged and unstaged changes. The patch combines both states against that base; it does not preserve their separate index and working-tree staging. The original snapshot contained no untracked files requiring a separate archive.

The patch was checked with `git apply --check` against a clean archive of the base commit. Its former installed dependencies, private host builds, caches and generated evidence are not retained. Historical source and outcome claims remain in the development and cleanup records.
