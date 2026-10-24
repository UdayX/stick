/**
 * Geometry self-check: `node src/lib/trace.selftest.ts`
 * Fails loudly if offsetting, hole handling or speck removal regress.
 */
import assert from "node:assert/strict";
import { buildSdf, contourPath } from "./trace.ts";

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
