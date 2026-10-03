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

## Motion walker

**Follow motion** does not start on upload. It runs a genetic algorithm on the frames you just sampled. Pause, resume, or step a generation. A new video clears the run. Orbit and both time sliders keep working; **Show up to** clips the path with the stack.

A walker is a path from the first frame to the last. The genome is a start point plus one step per frame, in normalized image space (`u` left to right, `v` top to bottom), so mutation bends the route instead of scattering it. Each point sits on that frame's plane.

Consecutive frames are reduced to a coarse grayscale grid (long edge 40) and differenced. That motion field is just pixel change, not a model.

Defaults are a population of 64, 4 elites, tournament size 3, and about one generation every 120 ms. The best route is a bright line through the cube; the next 4 walkers are faint trails. The readout is the generation number and that generation's best fitness.

Fitness is higher when the path follows motion:

- add the motion at the midpoint of each step (bilinear sample of the absolute grayscale difference, 0–1)
- subtract 18 × the sum of squared step lengths beyond 0.02
- subtract 1.5 × how far points sit outside the frame

## Deploy

GitHub Actions (`.github/workflows/deploy-pages.yml`) builds `dist/` and deploys it to GitHub Pages on pushes to `main`.
