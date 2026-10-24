/**
 * Geometry self-check: `node src/lib/trace.selftest.ts`
 * Fails loudly if offsetting, hole handling or speck removal regress.
 */
import assert from "node:assert/strict";
import { buildSdf, contourPath, roundField } from "./trace.ts";

const W = 220;
const H = 220;

function canvas(fill: (x: number, y: number) => boolean) {
  const a = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) a[(y * W + x) * 4 + 3] = fill(x, y) ? 255 : 0;
  return buildSdf(a, W, H);
}

/** Bounding box of a path's absolute coordinates. */
function bbox(d: string) {
  const n = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  const xs = n.filter((_, i) => i % 2 === 0);
  const ys = n.filter((_, i) => i % 2 === 1);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}
const subpaths = (d: string) => (d.match(/M/g) ?? []).length;
const near = (got: number, want: number, tol: number, what: string) =>
  assert.ok(Math.abs(got - want) <= tol, `${what}: got ${got.toFixed(2)}, want ~${want}`);

// A disc of radius 40, offset outward and inward.
const disc = canvas((x, y) => Math.hypot(x - 110, y - 110) <= 40);
for (const [offset, diameter] of [[0, 80], [10, 100], [25, 130], [-10, 60]]) {
  const b = bbox(contourPath(disc, { offset }));
  near(b.w, diameter, 2.5, `disc offset ${offset} width`);
  near(b.h, diameter, 2.5, `disc offset ${offset} height`);
  assert.equal(subpaths(contourPath(disc, { offset })), 1, `disc offset ${offset} subpaths`);
}

// An annulus keeps its hole, and `solid` fills it in for the cut line.
const ring = canvas((x, y) => {
  const r = Math.hypot(x - 110, y - 110);
  return r <= 70 && r >= 30;
});
assert.equal(subpaths(contourPath(ring, { offset: 0 })), 2, "annulus keeps its hole");
assert.equal(subpaths(contourPath(ring, { offset: 0, solid: true })), 1, "solid drops the hole");
// Offsetting past the hole radius (30) closes it on its own.
assert.equal(subpaths(contourPath(ring, { offset: 34 })), 1, "big offset closes the hole");

// Two separate pieces trace as two loops, then merge once they touch.
const pair = canvas((x, y) => Math.hypot(x - 70, y - 110) <= 20 || Math.hypot(x - 150, y - 110) <= 20);
assert.equal(subpaths(contourPath(pair, { offset: 0 })), 2, "two pieces, two loops");
assert.equal(subpaths(contourPath(pair, { offset: 25 })), 1, "offset merges touching pieces");

// A single stray pixel is a scanning speck, not artwork.
const speck = canvas((x, y) => (Math.hypot(x - 110, y - 110) <= 40) || (x === 5 && y === 5));
assert.equal(subpaths(contourPath(speck, { offset: 0 })), 1, "speck removed by minArea");

// Scale and origin land the path in output units.
const scaled = bbox(contourPath(disc, { offset: 0, scale: 2, originX: 100, originY: 100 }));
near(scaled.w, 160, 5, "scaled width");

console.log("trace.selftest: all checks passed");

// `solid` closes holes without discarding separate pieces.
const ringAndDot = canvas((x, y) => {
  const r = Math.hypot(x - 90, y - 90);
  return (r <= 55 && r >= 25) || Math.hypot(x - 190, y - 190) <= 16;
});
assert.equal(subpaths(contourPath(ringAndDot, { offset: 0 })), 3, "ring + dot traces 3 loops");
assert.equal(
  subpaths(contourPath(ringAndDot, { offset: 0, solid: true })),
  2,
  "solid fills the hole but keeps the separate dot",
);

console.log("trace.selftest: solid-fill checks passed");

// A traced circle must come out smooth. Faceting shows up as the radius
// rippling in and out along the curve, so measure that rather than counting
// corners: a coarse but round outline is fine, a scalloped one is not.
{
  const AA = 260;
  const C = 130;
  const R = 80;
  const px = new Uint8ClampedArray(AA * AA * 4);
  for (let y = 0; y < AA; y++) {
    for (let x = 0; x < AA; x++) {
      const cov = Math.max(0, Math.min(1, R - Math.hypot(x - C, y - C) + 0.5));
      px[(y * AA + x) * 4 + 3] = Math.round(cov * 255);
    }
  }
  const disc = roundField(buildSdf(px, AA, AA), 1);
  const d = contourPath(disc, { offset: 8, tolerance: 0.3 });

  // Walk the beziers and track how far the radius wanders.
  const n = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  let cur = { x: n[0], y: n[1] };
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 2; i + 5 < n.length; i += 6) {
    const c1 = { x: n[i], y: n[i + 1] };
    const c2 = { x: n[i + 2], y: n[i + 3] };
    const p = { x: n[i + 4], y: n[i + 5] };
    for (let s = 1; s <= 10; s++) {
      const t = s / 10;
      const u = 1 - t;
      const x = u * u * u * cur.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p.x;
      const y = u * u * u * cur.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p.y;
      const r = Math.hypot(x - C, y - C);
      if (r < lo) lo = r;
      if (r > hi) hi = r;
    }
    cur = p;
  }
  assert.ok(hi - lo < 0.45, `circle outline is scalloped: radius ripples ${(hi - lo).toFixed(3)}px`);
  near((hi + lo) / 2, R + 8, 0.6, "circle traced at the right radius");
}

console.log("trace.selftest: smoothness checks passed");
