# Gallery Images

This directory holds images referenced from `package.json` → `pi.image` for the [pi.dev/packages](https://pi.dev/packages) gallery.

## pi-intelli-search-pipeline.png

A diagram or illustration explaining what the extension does. This appears as a static preview card on the pi package gallery.

**Format:** PNG, JPEG, GIF, or WebP
**Recommended dimensions:** 1280×720 or 1920×1080

### How to create

The simplest approach is to render the existing Mermaid diagram from the README. The comparison diagram (fetch-and-dump vs intelli-search pipeline) already communicates the value proposition:

1. Go to [mermaid.live](https://mermaid.live)
2. Paste the flowchart from README.md
3. Export as PNG
4. Save as `pi-intelli-search-pipeline.png` in this directory

Alternatively, use `mmdc` (mermaid-cli):

```bash
npm install -g @mermaid-js/mermaid-cli
mmdc -i pipeline.mmd -o pi-intelli-search-pipeline.png -w 1280 -H 720 -b transparent
```

After adding the image, uncomment the `<img>` block in README.md, push to GitHub, bump the version, and republish so the gallery picks up the new `pi.image` URL.
