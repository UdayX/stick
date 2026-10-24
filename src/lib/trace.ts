/**
 * Alpha -> vector contour.
 *
 * Both PNG and SVG uploads get rasterised once, then everything geometric
 * (die-cut line, border, bleed) comes out of one signed distance field.
 * Offsetting is just picking a different iso-level, so there is no polygon
 * offset library here and no separate code path per file type.
 */

export type Pt = { x: number; y: number };
export type Loop = Pt[];

const INF = 1e20;

/** Felzenszwalb & Huttenlocher exact squared-distance transform, one row. */
function edt1d(f: Float64Array, d: Float64Array, v: Int32Array, z: Float64Array, n: number) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Euclidean distance (in px) from every pixel to the nearest `true` in mask. */
function edt(mask: Uint8Array, w: number, h: number): Float64Array {
  const g = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = mask[i] ? 0 : INF;

  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = g[y * w + x];
    edt1d(f, d, v, z, w);
    for (let x = 0; x < w; x++) g[y * w + x] = d[x];
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = g[y * w + x];
    edt1d(f, d, v, z, h);
    for (let y = 0; y < h; y++) g[y * w + x] = Math.sqrt(d[y]);
  }
  return g;
}

export type Sdf = { field: Float64Array; w: number; h: number };

/**
 * Signed distance field from an alpha channel: negative inside the artwork,
 * positive outside. An iso-level of R is the artwork grown by R px, so R can
 * also go negative to inset.
 */
export function buildSdf(alpha: Uint8ClampedArray, w: number, h: number, threshold = 8): Sdf {
  const inside = new Uint8Array(w * h);
  const outside = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const on = alpha[i * 4 + 3] > threshold ? 1 : 0;
    inside[i] = on;
    outside[i] = on ^ 1;
  }
  const dOut = edt(inside, w, h);
  const dIn = edt(outside, w, h);
  const field = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) field[i] = dOut[i] - dIn[i];
  return { field, w, h };
}

/** Marching squares at `level`, with linear interpolation along cell edges. */
function isoSegments(sdf: Sdf, level: number): [Pt, Pt][] {
  const { field, w, h } = sdf;
  const at = (x: number, y: number) => {
    // Clamp-sample so artwork touching the canvas edge still closes its loop.
    const cx = x < 0 ? 0 : x >= w ? w - 1 : x;
    const cy = y < 0 ? 0 : y >= h ? h - 1 : y;
    return field[cy * w + cx];
  };
  const segs: [Pt, Pt][] = [];
  const lerp = (va: number, vb: number) => {
    const dv = vb - va;
    if (dv === 0) return 0.5;
    const t = (level - va) / dv;
    return t < 0 ? 0 : t > 1 ? 1 : t;
  };

  // Pad by one cell so shapes running off-canvas still produce closed loops.
  for (let y = -1; y < h; y++) {
    for (let x = -1; x < w; x++) {
      const va = at(x, y);
      const vb = at(x + 1, y);
      const vc = at(x + 1, y + 1);
      const vd = at(x, y + 1);
      const code =
        (va < level ? 8 : 0) | (vb < level ? 4 : 0) | (vc < level ? 2 : 0) | (vd < level ? 1 : 0);
      if (code === 0 || code === 15) continue;

      const top = (): Pt => ({ x: x + lerp(va, vb), y });
      const right = (): Pt => ({ x: x + 1, y: y + lerp(vb, vc) });
      const bottom = (): Pt => ({ x: x + lerp(vd, vc), y: y + 1 });
      const left = (): Pt => ({ x, y: y + lerp(va, vd) });

      switch (code) {
        case 1: case 14: segs.push([left(), bottom()]); break;
        case 2: case 13: segs.push([bottom(), right()]); break;
        case 3: case 12: segs.push([left(), right()]); break;
        case 4: case 11: segs.push([top(), right()]); break;
        case 6: case 9: segs.push([top(), bottom()]); break;
        case 7: case 8: segs.push([top(), left()]); break;
        case 5:
        case 10: {
          // Saddle: the cell centre decides which way the two strands run.
          const centre = (va + vb + vc + vd) / 4 < level;
          const flip = code === 5 ? centre : !centre;
          if (flip) {
            segs.push([top(), left()]);
            segs.push([bottom(), right()]);
          } else {
            segs.push([top(), right()]);
            segs.push([left(), bottom()]);
          }
          break;
        }
      }
    }
  }
  return segs;
}

/** Stitch unordered segments into closed loops by matching endpoints. */
function stitch(segs: [Pt, Pt][]): Loop[] {
  const key = (p: Pt) => `${Math.round(p.x * 128)},${Math.round(p.y * 128)}`;
  const buckets = new Map<string, number[]>();
  segs.forEach((s, i) => {
    for (const p of s) {
      const k = key(p);
      const b = buckets.get(k);
      if (b) b.push(i);
      else buckets.set(k, [i]);
    }
  });

  const used = new Uint8Array(segs.length);
  const loops: Loop[] = [];

  for (let start = 0; start < segs.length; start++) {
    if (used[start]) continue;
    used[start] = 1;
    const loop: Loop = [segs[start][0], segs[start][1]];

    for (;;) {
      const tail = loop[loop.length - 1];
      const cand = buckets.get(key(tail));
      if (!cand) break;
      let next = -1;
      for (const i of cand) if (!used[i]) { next = i; break; }
      if (next === -1) break;
      used[next] = 1;
      const [p, q] = segs[next];
      loop.push(key(p) === key(tail) ? q : p);
      if (key(loop[loop.length - 1]) === key(loop[0])) break;
    }
    if (loop.length > 3) loops.push(loop);
  }
  return loops;
}

/** Ramer-Douglas-Peucker on an open polyline. */
function rdp(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts;
  const first = pts[0];
  const last = pts[pts.length - 1];
  let idx = -1;
  let max = 0;
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const len = Math.hypot(dx, dy);
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const d =
      len === 0
        ? Math.hypot(p.x - first.x, p.y - first.y)
        : Math.abs(dy * (p.x - first.x) - dx * (p.y - first.y)) / len;
    if (d > max) { max = d; idx = i; }
  }
  if (max <= tol) return [first, last];
  return [...rdp(pts.slice(0, idx + 1), tol).slice(0, -1), ...rdp(pts.slice(idx), tol)];
}

/** Ray cast; `loop` is closed implicitly. */
function contains(loop: Loop, p: Pt): boolean {
  let inside = false;
  for (let i = 0, n = loop.length, j = n - 1; i < n; j = i++) {
    const a = loop[i];
    const b = loop[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function area(loop: Loop): number {
  let a = 0;
  for (let i = 0, n = loop.length; i < n; i++) {
    const p = loop[i];
    const q = loop[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/**
 * Closed centripetal Catmull-Rom through the points, as cubic beziers.
 *
 * Centripetal (alpha 0.5) rather than uniform: the simplifier leaves points
 * unevenly spaced, and uniform Catmull-Rom creases wherever the spacing
 * changes, which shows up as a flat facet and a sharp corner on what should
 * be a smooth curve. Weighting the knots by distance removes that.
 */
function loopToPath(loop: Loop, scale: number, ox: number, oy: number): string {
  const n = loop.length;
  const f = (v: number) => Math.round(v * 1000) / 1000;
  const P = (i: number) => loop[((i % n) + n) % n];
  const sx = (p: Pt) => f(p.x * scale + ox);
  const sy = (p: Pt) => f(p.y * scale + oy);
  const knot = (a: Pt, b: Pt) => Math.max(Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)), 1e-6);

  let d = `M${sx(P(0))} ${sy(P(0))}`;
  for (let i = 0; i < n; i++) {
    const p0 = P(i - 1);
    const p1 = P(i);
    const p2 = P(i + 1);
    const p3 = P(i + 2);
    const d1 = knot(p0, p1);
    const d2 = knot(p1, p2);
    const d3 = knot(p2, p3);

    const a1 = 3 * d1 * (d1 + d2);
    const a2 = 3 * d3 * (d3 + d2);
    const c1 = {
      x: (d1 * d1 * p2.x - d2 * d2 * p0.x + (2 * d1 * d1 + 3 * d1 * d2 + d2 * d2) * p1.x) / a1,
      y: (d1 * d1 * p2.y - d2 * d2 * p0.y + (2 * d1 * d1 + 3 * d1 * d2 + d2 * d2) * p1.y) / a1,
    };
    const c2 = {
      x: (d3 * d3 * p1.x - d2 * d2 * p3.x + (2 * d3 * d3 + 3 * d3 * d2 + d2 * d2) * p2.x) / a2,
      y: (d3 * d3 * p1.y - d2 * d2 * p3.y + (2 * d3 * d3 + 3 * d3 * d2 + d2 * d2) * p2.y) / a2,
    };
    d += `C${sx(c1)} ${sy(c1)} ${sx(c2)} ${sy(c2)} ${sx(p2)} ${sy(p2)}`;
  }
  return d + "Z";
}

/**
 * Round a shape's corners by blurring its distance field.
 *
 * Blurring the field pulls convex corners in and pushes concave ones out by
 * the same amount, which rounds both evenly - the result Illustrator gets
 * from offsetting out and back in again (a morphological close), but in one
 * cheap separable pass instead of two full re-traces.
 */
export function roundField(sdf: Sdf, radius: number): Sdf {
  const r = Math.round(radius);
  if (r < 1) return sdf;
  const { w, h } = sdf;
  let src = Float64Array.from(sdf.field);
  let dst = new Float64Array(w * h);

  // Three box passes approximate a gaussian closely enough for an outline.
  for (let pass = 0; pass < 3; pass++) {
    const win = r * 2 + 1;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = src[row] * (r + 1);
      for (let x = 1; x <= r; x++) sum += src[row + Math.min(x, w - 1)];
      for (let x = 0; x < w; x++) {
        dst[row + x] = sum / win;
        sum += src[row + Math.min(x + r + 1, w - 1)] - src[row + Math.max(x - r, 0)];
      }
    }
    [src, dst] = [dst, src];
    for (let x = 0; x < w; x++) {
      let sum = src[x] * (r + 1);
      for (let y = 1; y <= r; y++) sum += src[Math.min(y, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        dst[y * w + x] = sum / win;
        sum += src[Math.min(y + r + 1, h - 1) * w + x] - src[Math.max(y - r, 0) * w + x];
      }
    }
    [src, dst] = [dst, src];
  }
  return { field: src, w, h };
}

export type ContourOpts = {
  /** Iso-level in source pixels; grows the artwork outward when positive. */
  offset: number;
  /** Simplification tolerance in source pixels. */
  tolerance?: number;
  /** Drop loops enclosing less than this area, in source px^2 (speck removal). */
  minArea?: number;
  /** Scale and translate the result into output user units. */
  scale?: number;
  originX?: number;
  originY?: number;
  /**
   * Fill holes: keep the outer loop of every piece and drop the loops nested
   * inside them. Separate pieces all survive — only holes are closed.
   */
  solid?: boolean;
};

/**
 * One `d` attribute covering every piece of the artwork at the given offset.
 * Sub-paths use fill-rule="evenodd" so holes come out as holes regardless of
 * the winding direction the tracer happened to produce.
 */
export function contourPath(sdf: Sdf, opts: ContourOpts): string {
  const { offset, tolerance = 0.25, minArea = 12, scale = 1, originX = 0, originY = 0 } = opts;
  let loops = stitch(isoSegments(sdf, offset)).filter((l) => area(l) >= minArea);
  if (!loops.length) return "";
  if (opts.solid) {
    // A loop nested an odd number of deep is a hole in the piece around it.
    loops = loops.filter((loop) => {
      const probe = loop[0];
      let depth = 0;
      for (const other of loops) {
        if (other !== loop && contains(other, probe)) depth++;
      }
      return depth % 2 === 0;
    });
  }

  return loops
    .map((loop) => {
      const open = rdp([...loop, loop[0]], tolerance);
      open.pop();
      return open.length > 2 ? loopToPath(open, scale, originX, originY) : "";
    })
    .filter(Boolean)
    .join(" ");
}

/** Tight bounds of the artwork's opaque pixels, grown by `pad` px. */
export function sdfBounds(sdf: Sdf, pad: number) {
  const { field, w, h } = sdf;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (field[y * w + x] < pad) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w, h };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Centroid of the artwork and the furthest opaque pixel from it, in px. */
export function radialExtent(sdf: Sdf) {
  const { field, w, h } = sdf;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (field[y * w + x] < 0) {
        sx += x;
        sy += y;
        n++;
      }
    }
  }
  if (!n) return { cx: w / 2, cy: h / 2, radius: Math.min(w, h) / 4 };
  const cx = sx / n;
  const cy = sy / n;
  let r2 = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (field[y * w + x] < 0) {
        const d = (x - cx) ** 2 + (y - cy) ** 2;
        if (d > r2) r2 = d;
      }
    }
  }
  return { cx, cy, radius: Math.sqrt(r2) };
}
