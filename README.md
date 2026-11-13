# Scry

A crystal-ball skin for [Video.js v10](https://videojs.org). The video is a rectangle until you travel through time:
drag the timeline, drag sideways on the picture, or jump with the keys, and the picture curls up into a glass orb in
which the video flows from one moment to the next. The timeline curls onto the orb's rim. Arrive, and it uncurls onto
the new frame. Buffering shows as fog in a small orb; the end of the video as an orb holding its opening frame.

The effect runs on the viewer's device in WebGL2 fragment shaders: optical flow between storyboard tiles, the morph,
the wrap and the lens. There is no model to download and no extension to enable. With a Mux source, resting on a moment
also fetches that exact frame from Mux so the orb comes into focus. Without WebGL2, or with reduced motion turned on,
nothing wraps: seeks cut and the timeline preview shows a still thumbnail.

`<scry-vision hover="orb">` (the default) also wraps the picture when the pointer merely rests on the timeline;
`hover="peek"` shows a small orb at the pointer instead. The showcase page has a switch for the two.

## Depth tier (opt-in)

Add `depth="auto"` to `<scry-vision>` (or `?depth=auto` to the showcase or preview URL) and the orb gains real
parallax: Depth Anything V2 Small estimates depth for each storyboard tile in a worker, and the picture in the orb
drifts, leans and pushes in as a volume instead of a flat card. `auto` uses WebGPU where it exists and the viewer has
not asked to save data; `depth="wasm"` forces the slower WebAssembly backend. This is the only part that downloads
anything beyond the page: the model (about 19 MB on WebGPU, 27 MB on WebAssembly) from the Hugging Face hub and the
ONNX runtime from jsDelivr, once, cached by the browser. It is off by default, and if it fails the orb stays flat.

## Layout

- `src/video/` — the skin: markup (`skin.html`), elements and icons (`skin.ts`, `icons/`), styles (`skin.css` for
  structure, `scry.css` for the look), `scry-vision.ts`, the element that draws the orb, and `scry-arc.ts`, the curved timeline.
- `src/liquid/` — the engine, with no dependency on Video.js: `engine.ts`, `shaders.ts`, `storyboard.ts`, and the
  optional `depth.ts` and `depth.worker.ts`.
- `design/spec.md` — the design.
- `apps/preview/` — the showcase page (`index.html`), the Video.js workbench (`workbench.html`) and the frame it
  previews (`preview.html`).
- `apps/preview/lab.html` — development page that renders contact sheets of the morph (`npm run dev`, then `/lab.html`).

Licensed under the Apache License, Version 2.0.

---

# scry

A Video.js video skin for HTML, styled with CSS. It started from the Scaffold skin.

## Develop

```sh
npm run dev
```

The workbench opens your skin in a slimmed-down version of the Video.js sandbox. It plays NASA's Cosmic Dawn trailer from Mux, with chapters; change the media in `apps/preview/src/frame/player`. The options panel sets the player's width and aspect ratio, the color scheme, text direction, and language, and playback options such as autoplay, muted, loop, and preload. The arrow button opens the preview on its own. The settings live in the URL, so a link such as `/?width=384&ratio=9:16&dir=rtl&locale=ar` opens the workbench in that state, and `/preview.html#width=384&ratio=9:16` opens the preview alone.

## Deploy

```sh
npm run deploy
```

It asks where to deploy the workbench: Vercel, Netlify, or Cloudflare Pages. Name one to skip the question, such as `npm run deploy vercel`. The first time, the host's CLI signs you in and creates the project, then every run prints the URL. Vercel and Netlify deploy to a preview URL you can share; to deploy to production instead, add `--prod` to the `deploy:netlify` script, or to both commands in `deploy:vercel`.

To deploy on every push instead, put the project on GitHub and import it on Vercel or Netlify; `vercel.json` and `netlify.toml` already describe the build. The build uses relative URLs, so `dist/` also works on any static host, including in a subfolder.

## Where things live

- `src/`: your skin, and only your skin. Keep, rewrite, or delete any of it.
  - `src/video/`: the skin component and its parts.
  - `src/styles/`: theme tokens and shared styles the skin imports, when it started from a packaged skin.
  - `src/skin.css`: global styles for the skin.
- `apps/preview/`: the workbench that previews the skin. You don't need to change it.
  - `src/shell/`: the Shadcn shell.
  - `src/frame/`: the page the shell frames. `player` mounts your skin in a player and sets the media it plays.
  - `public/`: files the preview serves, such as the chapters track.
- `vercel.json`, `netlify.toml`: how those hosts build the workbench.
- `skin.json`: what this skin is built from. Keep it; it records the Video.js version the skin was created with.

## Learn more

- [Build your own skin](https://videojs.org/docs/framework/html/guides/build-your-own-skin)
- [Customize skins](https://videojs.org/docs/framework/html/guides/customize-skins)
- [UI components](https://videojs.org/docs/framework/html/guides/ui-components)
