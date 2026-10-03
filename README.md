# videocube

Upload a video and see its frames stacked into a 3D cuboid. Orbit it in real time and slice through time. Processing stays in the browser — the file is never uploaded.

**Live:** [https://davidhanson90.github.io/videocube/](https://davidhanson90.github.io/videocube/)

## Run

```bash
npm install
npm run dev
```

Vite serves the app at `http://localhost:5173/videocube/`.

```bash
npm run build
npm run preview
```

## How frame sampling works

The page loads the file into a `<video>`, waits for metadata, then seeks to one timestamp per second (`0`, `1`, `2`, …) and draws each frame onto its own canvas. The long edge is capped at 512px and the aspect ratio is kept. If a one-per-second pass would exceed 180 frames, it takes 180 samples spread evenly across the duration instead, and the UI says `showing N frames`.

Each canvas is a Three.js texture on a `PlaneGeometry`. Planes are stacked along Z with a small gap so the edges read as a cuboid rather than a solid brick. Time 0 is the front of the stack.

Drag to orbit. The slice slider keeps frames near that second opaque and fades the rest, so the whole volume stays slightly translucent. **Show up to** hides frames after the chosen second.

## Deploy

GitHub Actions (`.github/workflows/deploy-pages.yml`) builds `dist/` and deploys it to GitHub Pages on pushes to `main`.
