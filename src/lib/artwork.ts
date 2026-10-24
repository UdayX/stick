/**
 * Loading uploads. Uploaded SVG is inlined into the live DOM and into every
 * export, so it is sanitised, not trusted: scripts, event handlers and any
 * reference pointing off-document are removed, and ids are namespaced so the
 * artwork cannot collide with (or capture) our own gradients and filters.
 *
 * SVG stays vector all the way to the export; the rasterisation here exists
 * only to trace geometry from.
 */
import { buildSdf, sdfBounds, type Sdf } from "./trace.ts";

/** Longest side of the artwork in the canvas geometry is traced from. */
const WORK = 640;

/**
 * Blank margin around the artwork, as a fraction of WORK.
 *
 * Offsetting pushes the outline outwards, so artwork that runs to the edge of
 * its own file - any tightly cropped PNG - needs somewhere for its border to
 * go, or the contour gets clamped at the canvas edge and breaks up.
 *
 * How much room a border needs is a pure ratio, independent of resolution:
 * border_px / artwork_px = borderMm / (widthMm - 2 * borderMm). At 0.55 that
 * covers borders up to about a quarter of the sticker's width, which is well
 * past anything a die-cutter would ask for, and the border control is capped
 * to the same range so the limit is never reached by accident.
 */
const MARGIN = 0.55;

const DROP_TAGS = new Set([
  "script", "foreignobject", "iframe", "object", "embed", "link",
  "handler", "set", "audio", "video", "a",
]);

/** Keep only fragment references: blocks javascript:, data: and remote URLs. */
const safeRef = (v: string) => /^#[\w:.-]+$/.test(v.trim());

function scrubCss(css: string) {
  return css
    .replace(/@import[^;]*;?/gi, "")
    .replace(/url\(\s*(['"]?)(?!#)[^)]*\1\s*\)/gi, "none");
}

export type SvgArtwork = {
  kind: "svg";
  /** Sanitised inner markup, ids namespaced. */
  inner: string;
  viewBox: { x: number; y: number; w: number; h: number };
};
export type RasterArtwork = { kind: "raster"; dataUrl: string };
export type ArtworkSource = SvgArtwork | RasterArtwork;

export type Artwork = {
  source: ArtworkSource;
  /** Natural artwork size, in its own units. */
  natW: number;
  natH: number;
  /** Signed distance field at work resolution, plus how to map it back. */
  sdf: Sdf;
  /** Multiply work-space px by this to reach natural units. */
  workToNat: number;
  /** Blank margin around the artwork in work px; caps how far it can offset. */
  margin: number;
  /** Opaque bounds in work space. */
  bounds: { x: number; y: number; w: number; h: number };
  /** True when the upload had no transparency at all (likely a flat backdrop). */
  wasOpaque: boolean;
};

function parseSvg(text: string) {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = doc.documentElement;
  if (!root || root.nodeName === "parsererror" || root.getElementsByTagName("parsererror").length) {
    throw new Error("That SVG could not be parsed.");
  }

  const ns = `a${Math.random().toString(36).slice(2, 8)}`;
  const ids = new Map<string, string>();

  // Pass 1: strip anything executable or outward-facing, and collect ids.
  const walk = (el: Element) => {
    for (const child of [...el.children]) {
      if (DROP_TAGS.has(child.tagName.toLowerCase())) {
        // <a> wrappers carry no paint; keep the artwork inside them.
        if (child.tagName.toLowerCase() === "a") {
          while (child.firstChild) el.insertBefore(child.firstChild, child);
        }
        child.remove();
        continue;
      }
      walk(child);
    }
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) el.removeAttribute(attr.name);
      else if ((name === "href" || name.endsWith(":href")) && !safeRef(attr.value)) {
        el.removeAttribute(attr.name);
      } else if (name === "style") {
        el.setAttribute("style", scrubCss(attr.value));
      }
    }
    if (el.tagName.toLowerCase() === "style") el.textContent = scrubCss(el.textContent ?? "");
    const id = el.getAttribute("id");
    if (id) ids.set(id, `${ns}-${id}`);
  };
  walk(root);

  // Pass 2: namespace ids and every reference to them.
  const renameIn = (el: Element) => {
    const id = el.getAttribute("id");
    if (id && ids.has(id)) el.setAttribute("id", ids.get(id)!);
    for (const attr of [...el.attributes]) {
      let v = attr.value;
      if (!v.includes("#")) continue;
      for (const [from, to] of ids) {
        v = v.split(`url(#${from})`).join(`url(#${to})`).split(`#${from}"`).join(`#${to}"`);
        if (v.trim() === `#${from}`) v = `#${to}`;
      }
      if (v !== attr.value) el.setAttribute(attr.name, v);
    }
    for (const child of [...el.children]) renameIn(child);
  };
  renameIn(root);

  const vbAttr = root.getAttribute("viewBox");
  let viewBox = { x: 0, y: 0, w: 0, h: 0 };
  if (vbAttr) {
    const [x, y, w, h] = vbAttr.trim().split(/[\s,]+/).map(Number);
    viewBox = { x, y, w, h };
  }
  const num = (v: string | null) => (v ? parseFloat(v) : 0);
  if (!viewBox.w || !viewBox.h) {
    viewBox = { x: 0, y: 0, w: num(root.getAttribute("width")) || 512, h: num(root.getAttribute("height")) || 512 };
  }

  return {
    inner: root.innerHTML,
    viewBox,
    // Rasterise from a copy with an explicit size, so browsers that render a
    // size-less SVG as 0x0 still give us pixels to trace.
    rasterText: (() => {
      const clone = root.cloneNode(true) as Element;
      clone.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
      clone.setAttribute("width", String(viewBox.w));
      clone.setAttribute("height", String(viewBox.h));
      return new XMLSerializer().serializeToString(clone);
    })(),
  };
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("That image could not be decoded."));
    img.src = url;
  });
}

/**
 * Knock out a flat backdrop. A PNG with no transparency would otherwise trace
 * as its own bounding box, which is never the sticker anyone wanted.
 */
function keyOutBackdrop(
  data: Uint8ClampedArray, w: number, _h: number,
  mx: number, aw: number, ah: number, tolerance: number,
) {
  const at = (x: number, y: number) => (y * w + x) * 4;
  const corners = [
    at(mx, mx), at(mx + aw - 1, mx), at(mx, mx + ah - 1), at(mx + aw - 1, mx + ah - 1),
  ];
  const bg = [0, 1, 2].map((c) => corners.reduce((s, i) => s + data[i + c], 0) / corners.length);
  const tol2 = tolerance * tolerance * 3;
  for (let y = mx; y < mx + ah; y++) for (let x = mx; x < mx + aw; x++) {
    const o = at(x, y);
    const d =
      (data[o] - bg[0]) ** 2 + (data[o + 1] - bg[1]) ** 2 + (data[o + 2] - bg[2]) ** 2;
    if (d <= tol2) data[o + 3] = 0;
  }
}

export async function loadArtwork(file: File, keyTolerance = 26): Promise<Artwork> {
  const isSvg = file.type.includes("svg") || /\.svg$/i.test(file.name);
  let source: ArtworkSource;
  let rasterUrl: string;
  let natW: number;
  let natH: number;

  if (isSvg) {
    const { inner, viewBox, rasterText } = parseSvg(await file.text());
    source = { kind: "svg", inner, viewBox };
    natW = viewBox.w;
    natH = viewBox.h;
    rasterUrl = URL.createObjectURL(new Blob([rasterText], { type: "image/svg+xml" }));
  } else {
    const dataUrl = await new Promise<string>((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.onerror = () => rej(new Error("That file could not be read."));
      fr.readAsDataURL(file);
    });
    source = { kind: "raster", dataUrl };
    rasterUrl = dataUrl;
    const probe = await loadImage(dataUrl);
    natW = probe.naturalWidth;
    natH = probe.naturalHeight;
  }

  const img = await loadImage(rasterUrl);
  natW = natW || img.naturalWidth;
  natH = natH || img.naturalHeight;

  const scale = WORK / Math.max(natW, natH);
  const aw = Math.max(1, Math.round(natW * scale));
  const ah = Math.max(1, Math.round(natH * scale));
  const margin = Math.round(WORK * MARGIN);
  const w = aw + margin * 2;
  const h = ah + margin * 2;
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, margin, margin, aw, ah);
  if (isSvg) URL.revokeObjectURL(rasterUrl);

  const px = ctx.getImageData(0, 0, w, h);
  let wasOpaque = true;
  for (let i = 3; i < px.data.length; i += 4) {
    if (px.data[i] < 250) { wasOpaque = false; break; }
  }
  // Key off the artwork's own corners, not the blank margin we just added.
  if (wasOpaque && source.kind === "raster") keyOutBackdrop(px.data, w, h, margin, aw, ah, keyTolerance);

  const sdf = buildSdf(px.data, w, h);
  return {
    source,
    natW,
    natH,
    sdf,
    workToNat: natW / aw,
    margin,
    bounds: sdfBounds(sdf, 0),
    wasOpaque,
  };
}
