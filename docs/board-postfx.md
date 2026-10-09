# Board post-processing

One switch in settings, off by default. On, the board gets a colour grade,
bloom and drifting motes, and the frame goes through the HDR path in
`frontend/src/lib/board3d/oceanPass.ts` instead of compositing straight to the
canvas.

The values live in `board3d/boardTheme.ts` (four looks: on/off x day/night), the
setting in `lib/boardPostFx.ts`, the passes in `board3d/postfx.ts`.

The cloud over an unrevealed Explorers hex (`board3d/layers/fog.ts`) is lit like
every other surface, so no look carries a colour for it. Its albedo is held at
or under `Mat_Mountains_snow`, the brightest lit albedo on the board, so bloom
cannot halo it more than mountain snow; `layers/fog.test.ts` checks this
against `palette.json`.

## Why it is off by default

Cost. GPU time from `EXT_disjoint_timer_query_webgl2` on an M3 Max, a 4-player
base board at the default camera:

| drawing buffer | full frame off | full frame on | water frame off | water frame on |
| -------------- | -------------- | ------------- | --------------- | -------------- |
| 1280x720       | 2.07 ms        | 3.20 ms       | 0.38 ms         | 1.76 ms        |
| 2560x1440      | 5.42 ms        | 8.19 ms       | 0.83 ms         | 4.14 ms        |

The water frame is the one that matters. A full frame happens when something on
the board changes; a water frame is what the ocean clock issues about thirty
times a second while a board is open (see `OCEAN_FRAME_MS` and `oceanPass.ts`).
So an idle board costs the water frame times 30:

| | 1280x720 | 2560x1440 |
| --- | --- | --- |
| off | 11 ms/s (~1%) | 25 ms/s (~2.5%) |
| on | 53 ms/s (~5%) | 124 ms/s (~12%) |

About 12% of an M3 Max, continuously, on an idle board. The work is fill-rate
bound and scales with pixels, so integrated GPUs fare several times worse. As
with the 30Hz full redraw (see the ocean-clock comment in `Board3D.tsx`), the
cost belongs behind a setting the player chooses.

## Where the cost actually is

Measured by removing one thing at a time, at 2560x1440, water frame:

| variant | ms |
| --- | --- |
| off | 0.83 |
| on | 4.14 |
| on, no bloom (grade only) | 3.69 |
| on, with 4x MSAA on the scene target | 8.55 |

**Bloom is cheap:** 0.45 ms of the 3.3 ms overhead. The cost is the HDR round
trip: compositing into a full-resolution half-float target, drawing the water
into it, and reading it back through the grade.

**The scene target has no MSAA** (`samples: 0`); with it the cost doubles for
nothing. The composite quad writes one depth value per pixel (restoring the
cached board's depth from a texture), so the water/shore boundary is decided per
pixel and MSAA could not antialias it. The island's edges keep antialiasing from
the board cache, which is `samples: 4` and resolves before the composite.

## If it should ever be on by default

The remaining cost is the full-resolution half-float round trip, so the lever is
resolution rather than effects. Capping the post-processed path's internal scale
(rendering at dpr 1 and letting the final pass upscale) would bring the retina
number back to about the 720p one, at the price of a slightly softer image. Not
built yet.

## Reproducing the numbers

`window.__board3d` is exposed in dev builds. `draw(true)` forces a full frame,
`draw(false)` a water frame, and `sampleRadiance()` reports the scene's linear
radiance distribution (which is how the bloom thresholds were chosen; see
`BoardBloom.threshold`).

```js
const r = window.__board3d;
const gl = r.renderer.getContext();
const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
const time = async (full, n) => {
  for (let i = 0; i < 20; i++) r.draw(full); // warm up
  const q = gl.createQuery();
  gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
  for (let i = 0; i < n; i++) r.draw(full);
  gl.endQuery(ext.TIME_ELAPSED_EXT);
  while (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) {
    await new Promise((res) => setTimeout(res, 10));
  }
  return gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6 / n;
};
```

Do not time this with `performance.now()` around `draw()`. GPU work is
asynchronous and `gl.finish()` does not reliably block here, so that only
measures CPU command submission.
