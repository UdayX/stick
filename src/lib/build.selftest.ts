/**
 * Sticker geometry self-check: `node src/lib/build.selftest.ts`
 * Guards the millimetre maths — the part that decides whether a sticker comes
 * back from the printer the size it was asked for.
 */
import assert from "node:assert/strict";
import { buildSdf, roundField } from "./trace.ts";
import {
  buildSticker, clampSpec, scaleToWidth, DEFAULT_SPEC, maxBorderMm, maxBleedMm, maxRoundMm,
  MIN_WIDTH_MM, MAX_WIDTH_MM, type ShapeMode, type StickerSpec,
} from "./build.ts";
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

// A small star: detailed enough that an over-aggressive setting visibly
// destroys it, small enough to sweep a few hundred combinations quickly.
const S = 200;
const SM = Math.round(S * 0.55);
const N = S + SM * 2;
const c = N / 2;
const rr = S / 2;
const a = new Uint8ClampedArray(N * N * 4);
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const ang = Math.atan2(y - c, x - c);
    const lim = rr * (0.5 + 0.5 * Math.abs(Math.cos(ang * 2.5)));
    if (Math.hypot(x - c, y - c) <= lim) a[(y * N + x) * 4 + 3] = 255;
  }
}
const sdf = roundField(buildSdf(a, N, N), 1);
const star: Artwork = {
  source: { kind: "svg", inner: "<path/>", viewBox: { x: 0, y: 0, w: 100, h: 100 } },
  natW: 100, natH: 100, sdf, workToNat: 100 / S,
  bounds: { x: c - rr, y: c - rr, w: rr * 2, h: rr * 2 },
  margin: SM, wasOpaque: false,
};


// Every control, at every extreme, for every shape. A sticker that comes out
// the wrong size, warns, or loses its outline is a bug no matter how odd the
// combination of settings looks.
{
  const shapes: ShapeMode[] = ["contour", "rounded", "circle", "square"];
  // Count every path command: the traced shapes are M/C, but a circle is
  // arcs and a square is H/V/A, so an M-and-C count reads them as degenerate.
  const anchors = (d: string) => (d.match(/[MCLHVAZ]/gi) ?? []).length;
  let checked = 0;

  for (const shape of shapes) {
    for (const widthMm of [MIN_WIDTH_MM, 20, 60, 120, MAX_WIDTH_MM]) {
      for (const borderFrac of [0, 0.5, 1]) {
        for (const bleedFrac of [0, 1]) {
          for (const roundFrac of [0, 1]) {
            const borderMm = maxBorderMm(widthMm) * borderFrac;
            const draft: StickerSpec = {
              ...DEFAULT_SPEC, shape, widthMm, borderMm,
              bleedMm: maxBleedMm(widthMm) * bleedFrac,
              roundMm: maxRoundMm(widthMm, borderMm, shape) * roundFrac,
            };
            const spec = clampSpec(draft);
            const where = `${shape} ${widthMm}mm border=${spec.borderMm} bleed=${spec.bleedMm} round=${spec.roundMm}`;

            // Clamping must be a fixed point: applying it twice changes nothing.
            assert.deepEqual(clampSpec(spec), spec, `clamp is not stable: ${where}`);

            const out = buildSticker(star, spec, "print");
            assert.ok(!out.warning, `warned: ${where} -> ${out.warning}`);
            assert.ok(out.cutPath.length > 0, `empty cut: ${where}`);
            assert.ok(out.svg.length > 0, `empty svg: ${where}`);
            near(out.cutWidthMm, widthMm, widthMm * 0.06, `cut width: ${where}`);

            assert.ok(anchors(out.cutPath) >= 4, `degenerate outline: ${where}`);
            checked++;
          }
        }
      }
    }
  }
  console.log(`build.selftest: swept ${checked} parameter combinations`);
}

// The remaining controls only repaint, but they still must not break the file.
for (const intensity of [0, 0.5, 1]) {
  for (const smoothing of [0, 1.5, 3]) {
    for (const angle of [0, 135, 359]) {
      const spec = clampSpec({ ...DEFAULT_SPEC, intensity, smoothing, angle });
      const out = buildSticker(art, spec, "web");
      assert.ok(!out.warning, `paint controls warned at ${intensity}/${smoothing}/${angle}`);
      assert.match(out.svg, /<svg[^>]*viewBox=/, `malformed svg at ${intensity}/${smoothing}/${angle}`);
    }
  }
}

// Resizing has to be a pure scale. With the border, bleed and rounding
// scaled alongside the width, a small sticker must keep the same proportions
// as a large one - not blob up as the border eats the artwork.
{
  /** How much of its own bounding box the cut shape fills. */
  const fill = (d: string) => {
    const n = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const pts = [{ x: n[0], y: n[1] }];
    for (let i = 2; i + 5 < n.length; i += 6) pts.push({ x: n[i + 4], y: n[i + 5] });
    let A = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      A += p.x * q.y - q.x * p.y;
    }
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const bb = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    return Math.abs(A) / 2 / bb;
  };

  const base = clampSpec({ ...DEFAULT_SPEC, widthMm: 60, borderMm: 3, bleedMm: 1.5, roundMm: 1.5 });
  const ref = fill(buildSticker(star, base, "print").cutPath);
  for (const widthMm of [MIN_WIDTH_MM, 25, 120, MAX_WIDTH_MM]) {
    const f = widthMm / base.widthMm;
    const scaled = clampSpec({
      ...base, widthMm,
      borderMm: base.borderMm * f, bleedMm: base.bleedMm * f, roundMm: base.roundMm * f,
    });
    const got = fill(buildSticker(star, scaled, "print").cutPath);
    assert.ok(
      Math.abs(got - ref) < 0.06,
      `resizing changed the sticker's proportions at ${widthMm}mm: fills ${(got * 100).toFixed(1)}% vs ${(ref * 100).toFixed(1)}%`,
    );
  }

  // Resizing through scaleToWidth must hold the proportions: the border is
  // the same share of the sticker at 15mm as it is at 200mm. Without this the
  // border keeps its millimetres while the artwork shrinks under it.
  for (const widthMm of [MIN_WIDTH_MM, 25, 120, MAX_WIDTH_MM]) {
    const out = scaleToWidth(base, widthMm);
    assert.equal(out.widthMm, widthMm, `scaleToWidth missed the width at ${widthMm}`);
    const want = base.borderMm / base.widthMm;
    const got = out.borderMm / out.widthMm;
    assert.ok(
      Math.abs(got - want) < 0.02,
      `border drifted when resizing to ${widthMm}mm: ${(got * 100).toFixed(1)}% of width vs ${(want * 100).toFixed(1)}%`,
    );
    // Repeated resizes must not creep away from the proportion either.
    const round = scaleToWidth(scaleToWidth(out, 60), widthMm);
    assert.ok(
      Math.abs(round.borderMm / round.widthMm - want) < 0.03,
      `border drifted after resizing back and forth at ${widthMm}mm`,
    );
  }
}

console.log("build.selftest: all checks passed");
