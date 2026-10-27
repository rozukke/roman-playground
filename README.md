# Roman Playground

A static, browser-only musical playground for hearing and arranging Roman-numeral harmony.

## Develop

```bash
nix develop
npm install
npm run dev
```

Build the static site with `npm run build`; Vite writes it to `dist/`.

## Deploy to GitHub Pages

Before enabling the included workflow, set `base` in `vite.config.ts` to `"/YOUR-REPOSITORY-NAME/"` (or leave it as `"/"` for a custom domain). In the repository's **Settings → Pages**, choose **GitHub Actions** as the deployment source.

The app uses the browser's Web Audio API directly. It has no server and currently uses a lightweight synthesized, electric-piano-ish triangle-wave sound.
