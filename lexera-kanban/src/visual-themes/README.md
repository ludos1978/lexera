# Visual Themes

Lexera ships two built-in visual theme states:

- `warm-paper` is the default Lexera v2 appearance.
- `no-style` applies no visual theme attributes, so the raw app CSS baseline remains untouched.

User-installed Lexera themes are discovered from:

- Effective app path: `dirs::config_dir()/lexera/themes/`
- Typical Linux path: `~/.config/lexera/themes/`
- Typical macOS path: `~/Library/Application Support/lexera/themes/`

Each theme lives in its own folder:

```text
<config-dir>/lexera/themes/
  my-theme/
    theme.json
    theme.css
```

`theme.json` example:

```json
{
  "id": "my-theme",
  "name": "My Theme",
  "description": "Custom Lexera skin",
  "extends": "sleek-uniform",
  "baseId": "sleek",
  "cssFile": "theme.css"
}
```

Notes:

- `theme.json` is required.
- `theme.css` is optional.
- `extends` lets a theme inherit another theme's CSS and DOM lineage.
- `baseId` controls the low-level `data-visual-theme` attribute. If omitted, Lexera inherits it from the extended parent when possible.

Recommended CSS selector:

```css
:root[data-visual-theme-lineage~="my-theme"] {
  --board-font-size: calc(13px * var(--ui-scale));
}
```

If a theme extends `sleek-uniform`, keep targeting `data-visual-theme-lineage~="my-theme"` for your overrides. The parent `sleek-uniform` selectors continue to apply automatically through the lineage attribute.
