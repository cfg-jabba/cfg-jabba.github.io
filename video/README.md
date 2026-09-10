# Video pipeline

Generates finished 1080×1920 social videos from code — no editor, no GPU,
no subscription. This is the same technique Remotion uses: draw each frame
in a headless browser, capture it, encode with ffmpeg.

## Why this exists

Creative is a volume game — roughly one video in five does anything. Hand-
editing each one in CapCut is what makes people give up in week two. This
renders variants by changing numbers in a file.

## Run it

```
npm i playwright          # or point NODE_PATH at an existing install
sudo apt-get install -y ffmpeg
node render.mjs out/clasp-demo.mp4
```

Roughly 90 seconds for an 8-second clip on 4 CPUs.

## Files

| File | Purpose |
|---|---|
| `src/scene.html` | The animation. Exposes `renderFrame(t)` and `SCENE_DURATION`. |
| `render.mjs` | Steps time, screenshots each frame, encodes with ffmpeg. |

## Editing the animation

`src/scene.html` is one canvas and a `renderFrame(t)` function where `t` is
seconds. Everything is a pure function of `t`, so frames are deterministic
and reproducible — no `requestAnimationFrame`, no randomness that changes
between runs.

Act timings live at the top of `renderFrame`. To retime, change those
numbers. To restyle, change the palette constants.

## What this is and is not

**Is:** motion graphics. Type, product diagrams, the snap, brand cards.
Genuinely usable for text-on-screen social content, which is the dominant
faceless format.

**Is not:** photorealistic footage. It cannot generate a person, and it
cannot show your actual product. For those you need either a camera or a
video model — see `docs/AD-CREATIVE.md`.

## Next step

The obvious extension is a variants file: one JSON array of hook/body/timing
combinations, rendered in a loop, producing dozens of cuts in one command.
