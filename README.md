# figma-var-export

Browser extension for Chrome and Firefox. It adds an `Export vars.css` action next to Figma's native `Export modes` menu item in the variables panel.

## Development

```bash
pnpm install
pnpm dev:chrome
pnpm dev:firefox
```

## Tampermonkey

Install `figma-var-export.tampermonkey.js` in Tampermonkey. The userscript adds the same
`Export vars.css` action on Figma pages and uses a pinned `fflate` dependency via
`@require`.

## Build

```bash
pnpm build
```

The unpacked extensions are generated under `.output/`.
