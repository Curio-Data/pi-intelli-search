# Gallery Images

This directory holds images referenced by the README and `package.json` -> `pi.image` for the [pi.dev/packages](https://pi.dev/packages) gallery.

## blog-banner.png: Launch Blog Post Banner

Vintage engraving-style banner with a central magnifying glass revealing a mechanical Pi symbol, used as the linked callout for the launch blog post in the README.

**Source:** Custom illustration (2026-08). Same artwork as the banner of [Launch blog post](https://blog.curiodata.pro/posts/22-pi-intelli-search/); PNG copy for README use (the packages site does not support `.avif`).

## 01.png: Pipeline Diagram

A five-stage pipeline diagram (Search -> Fetch -> Extract -> Collate -> Cache And Suggest) arranged in a clockwise cycle, rendered in a pen-and-ink botanical illustration style.

**Source:** Custom illustration (created for v0.3.2).

## 06.png: Comparison Infographic

Side-by-side comparison of the 7-stage `intelli-search` pipeline versus generic fetch/search extensions, rendered in a vintage engraving style. The top row shows the full purpose-built pipeline (Search → Dual Fetch → Quality Compare → Extract Per Page → Collate → Persistent Cache → Cache Suggest). The bottom row shows the generic approach (Search → Single Fetch → Raw Pages → No Cache). The seven labels are visual steps of the five-stage pipeline: fetch and cache operations are expanded for comparison. The artwork reflects the default configuration at its creation; search is configurable since v0.13.0.

**Source:** Custom illustration (created for v0.5.0). Replaced the previous 02.png from v0.3.2.

**Used as:** `pi.image` in `package.json`. Appears as the preview card on the `Pi` package gallery.

## 07B.png: Five-Stage Pipeline Infographic

Detailed `intelli_research` pipeline infographic: five sequentially linked numbered stages (Search, Fetch, Extract, Collate, Cache Suggest), connected by bold arrows with period vignettes. The artwork labels the search stage with the default model at its creation; search is configurable since v0.13.0 (plain chat models via the `searchWebSearch` server tool, or `perplexity/sonar-pro-search`), and the search stage additionally merges text links with harvested citation annotations. When this image is next regenerated, label the search stage "Configured Search Model" rather than any model name so future default changes do not touch artwork again.

**Source:** Custom illustration. Referenced from `README.md` (Pipeline section) and `docs/ARCHITECTURE.md`.
