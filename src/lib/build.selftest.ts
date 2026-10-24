/**
 * Sticker geometry self-check: `node src/lib/build.selftest.ts`
 * Guards the millimetre maths — the part that decides whether a sticker comes
 * back from the printer the size it was asked for.
 */
import assert from "node:assert/strict";
import { buildSdf } from "./trace.ts";
import { buildSticker, DEFAULT_SPEC, maxBorderMm, maxBleedMm } from "./build.ts";
import type { Artwork } from "./artwork.ts";

// Mirrors artwork.ts: WORK is the artwork's longest side, MARGIN the blank
// room around it that offsetting needs.
const WORK = 640;
const MARGIN = Math.round(WORK * 0.55);

/** Stand-in for a loaded upload: a disc centred in a margined canvas. */
function discArtwork(radius = WORK / 2): Artwork {
  const w = WORK + MARGIN * 2;
  const h = w;
  const a = new Uint8ClampedArray(w * h * 4);
  const c = w / 2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (Math.hypot(x - c, y - c) <= radius) a[(y * w + x) * 4 + 3] = 255;
  const sdf = buildSdf(a, w, h);
  return {
    source: { kind: "svg", inner: "<circle/>", viewBox: { x: 0, y: 0, w: 100, h: 100 } },
    natW: 100,
    natH: 100,
    sdf,
    workToNat: 100 / WORK,
    bounds: { x: c - radius, y: c - radius, w: radius * 2, h: radius * 2 },
    margin: MARGIN,
    wasOpaque: false,
  };
}

const near = (got: number, want: number, tol: number, what: string) =>
  assert.ok(Math.abs(got - want) <= tol, `${what}: got ${got.toFixed(2)}, want ~${want}`);

const art = discArtwork();

// The cut line must come out the width the user asked for.
for (const widthMm of [30, 60, 120]) {
  for (const borderMm of [0, 2, 3, 6]) {
    const out = buildSticker(art, { ...DEFAULT_SPEC, widthMm, borderMm }, "print");
    assert.ok(!out.warning, `${widthMm}mm/${borderMm}mm border warned: ${out.warning}`);
    near(out.cutWidthMm, widthMm, widthMm * 0.03, `cut width at ${widthMm}mm, border ${borderMm}mm`);
  }
}

// The border is the gap between the artwork edge and the cut line, so a wider
// border must grow the cut line while the artwork stays put.
const thin = buildSticker(art, { ...DEFAULT_SPEC, widthMm: 60, borderMm: 1 }, "print");
const fat = buildSticker(art, { ...DEFAULT_SPEC, widthMm: 60, borderMm: 8 }, "print");
near(thin.cutWidthMm, 60, 2, "thin border cut width");
near(fat.cutWidthMm, 60, 2, "fat border cut width");

// The print file must be sized in millimetres and carry the cut layer.
const p = buildSticker(art, { ...DEFAULT_SPEC, widthMm: 50 }, "print");
assert.match(p.svg, /width="[\d.]+mm"/, "print svg is sized in mm");
assert.match(p.svg, /id="CutContour"/, "print svg has a CutContour layer");
assert.match(p.svg, /stroke="#FF00FF"/, "cut line is spot magenta");
assert.ok(!/feTurbulence|mix-blend-mode/.test(p.svg), "print svg drops filters and blending");

// The web file scales instead, and keeps the effects.
const wv = buildSticker(art, DEFAULT_SPEC, "web");
assert.ok(!/width="[\d.]+mm"/.test(wv.svg), "web svg has no fixed size");
assert.match(wv.svg, /viewBox="0 0 [\d.]+ [\d.]+"/, "web svg has a viewBox");

// Asking for more border than the traced canvas can carry warns instead of
// silently producing a wrong-sized sticker.
const greedy = buildSticker(art, { ...DEFAULT_SPEC, widthMm: 60, borderMm: 25, bleedMm: 5 }, "print");
assert.ok(greedy.warning, "over-wide border warns");

// Every border the UI can actually ask for must stay inside the canvas.
for (const widthMm of [15, 30, 60, 120, 200]) {
  const borderMm = maxBorderMm(widthMm);
  const bleedMm = maxBleedMm(widthMm);
  const out = buildSticker(art, { ...DEFAULT_SPEC, widthMm, borderMm, bleedMm }, "print");
  assert.ok(!out.warning, `max border ${borderMm}mm at ${widthMm}mm warned: ${out.warning}`);
  near(out.cutWidthMm, widthMm, widthMm * 0.04, `cut width at max border, ${widthMm}mm`);
}

// Each shape mode produces a cut line of the requested width.
for (const shape of ["contour", "rounded", "circle", "square"] as const) {
  const out = buildSticker(art, { ...DEFAULT_SPEC, shape, widthMm: 60, borderMm: 4 }, "print");
  assert.ok(!out.warning, `${shape} warned: ${out.warning}`);
  near(out.cutWidthMm, 60, 3, `${shape} cut width`);
}

// Rounding must not move the sticker off the artwork or change its size.
const sharp = buildSticker(art, { ...DEFAULT_SPEC, shape: "contour", roundMm: 0 }, "print");
const soft = buildSticker(art, { ...DEFAULT_SPEC, shape: "rounded", roundMm: 4 }, "print");
near(soft.cutWidthMm, sharp.cutWidthMm, 2.5, "rounding keeps the width");

// The artwork must land exactly on the silhouette that was traced from it:
// the fixture disc spans the full WORK box, so the artwork's own viewBox has
// to come out the same width as the artwork area of the sticker.
{
  const widthMm = 60;
  const borderMm = 3;
  const out = buildSticker(art, { ...DEFAULT_SPEC, widthMm, borderMm }, "print");
  const t = out.svg.match(/translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)/);
  assert.ok(t, "artwork layer carries a transform");
  const scale = Number(t![3]);
  // The fixture's source viewBox is 100 units wide and its disc fills it.
  near(100 * scale, widthMm - borderMm * 2, 1, "artwork is drawn at the traced size");

  // ...and it must be centred on the cut shape, not drifting off one side.
  const left = Number(t![1]);
  const right = out.widthMm - (left + 100 * scale);
  near(left, right, 1, "artwork is centred in the sticker");
}

console.log("build.selftest: all checks passed");
