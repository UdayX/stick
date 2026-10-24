/**
 * Assembles a sticker into one self-contained SVG.
 *
 * Geometry is computed in millimetres, because the die-cut line, the border
 * and the bleed are physical measurements and guessing at them is what makes
 * a sticker come back from the printer wrong. One user unit = 1 mm.
 *
 * The cut line is an offset path: the same thing Illustrator produces from
 * Object > Path > Offset Path followed by Pathfinder > Unite. Taking it from
 * an iso-contour of a signed distance field means the unite step is free -
 * wherever two offset pieces overlap, the field has already merged them - and
 * the border, the bleed and the artwork silhouette are all the same operation
 * at three different distances.
 *
 * Two variants come out of the same description:
 *   web   - filters, blend modes and the moving sheen, no physical size, so
 *           it scales to whatever box it is dropped into.
 *   print - flat (gradients only), sized in mm, artwork carried out to the
 *           bleed, and the cut line on its own CutContour layer in spot
 *           magenta, which is what cutting plotters look for.
 */
import type { Artwork } from "./artwork.ts";
import { contourPath, radialExtent, roundField, type Sdf } from "./trace.ts";
import { renderFinish, finishById, type FinishId } from "./finishes.ts";

/** How the die line relates to the artwork. */
export type ShapeMode = "contour" | "rounded" | "circle" | "square";

export type StickerSpec = {
  finish: FinishId;
  shape: ShapeMode;
  /** Width of the die-cut shape, millimetres. */
  widthMm: number;
  /** Edge around the artwork, millimetres. */
  borderMm: number;
  /** Artwork carried past the cut line, millimetres. Printers want 1-2 mm. */
  bleedMm: number;
  /** Corner rounding, millimetres. Rounds the contour, or the square's corners. */
  roundMm: number;
  /** Fill holes so the sticker cuts as one piece. */
  solid: boolean;
  /** Outline simplification. */
  smoothing: number;
  angle: number;
  intensity: number;
  borderColor: string;
  shadow: boolean;
  animate: boolean;
};

export const DEFAULT_SPEC: StickerSpec = {
  finish: "holographic",
  shape: "contour",
  widthMm: 60,
  borderMm: 3,
  bleedMm: 1.5,
  roundMm: 1.5,
  solid: true,
  smoothing: 1,
  angle: 135,
  intensity: 0.55,
  borderColor: "#ffffff",
  shadow: true,
  animate: true,
};

/**
 * Caps for the two controls that grow the outline. Together they stay inside
 * the blank margin the tracer leaves around the artwork (border 20% + bleed
 * 8% of the width works out at 47% of the artwork span, against 55% of room),
 * so the clamp below is a backstop that normal use never reaches.
 */
export const maxBorderMm = (widthMm: number) => Math.round(widthMm * 0.2 * 4) / 4;
/** Printers ask for 1-2 mm; the cap only stops absurd values on tiny stickers. */
export const maxBleedMm = (widthMm: number) => Math.min(5, Math.round(widthMm * 0.08 * 4) / 4);

export type BuiltSticker = {
  svg: string;
  cutPath: string;
  /** Size of the whole file, including bleed and any shadow room. */
  widthMm: number;
  heightMm: number;
  /** Size of the die-cut shape itself: what the sticker measures in the hand. */
  cutWidthMm: number;
  cutHeightMm: number;
  warning?: string;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Rounded rectangle as a path, clamped so the radius cannot self-intersect. */
function roundedRect(x: number, y: number, w: number, h: number, r: number) {
  const k = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  const [X, Y, W, H, K] = [x, y, w, h, k].map(r2);
  return (
    `M${X + K} ${Y}H${X + W - K}A${K} ${K} 0 0 1 ${X + W} ${Y + K}` +
    `V${Y + H - K}A${K} ${K} 0 0 1 ${X + W - K} ${Y + H}` +
    `H${X + K}A${K} ${K} 0 0 1 ${X} ${Y + H - K}` +
    `V${Y + K}A${K} ${K} 0 0 1 ${X + K} ${Y}Z`
  );
}

function circlePath(cx: number, cy: number, r: number) {
  const [C, D, R] = [cx, cy, Math.max(r, 0.01)].map(r2);
  return `M${C - R} ${D}a${R} ${R} 0 1 0 ${R * 2} 0a${R} ${R} 0 1 0 ${-R * 2} 0Z`;
}

export function buildSticker(art: Artwork, spec: StickerSpec, mode: "web" | "print"): BuiltSticker {
  const flat = mode === "print";
  const b = art.bounds;

  const radial = spec.shape === "circle" ? radialExtent(art.sdf) : null;
  // What the sticker's width is measured across, before the border is added.
  const spanPx = radial ? radial.radius * 2 : b.w;

  const artMm = Math.max(1, spec.widthMm - spec.borderMm * 2);
  const k = spanPx / artMm; // work pixels per millimetre

  // The traced canvas only has so much blank room around the artwork, so the
  // outline can only grow so far before it would run off the edge. The border
  // control is capped well inside this, so it is a backstop, not a limit.
  const maxOffsetMm = (art.margin - 3) / k;
  const wantedMm = spec.borderMm + spec.bleedMm;
  const over = wantedMm > maxOffsetMm;
  const shrink = over ? maxOffsetMm / wantedMm : 1;
  const borderWork = spec.borderMm * shrink * k;
  const bleedWork = wantedMm * shrink * k;
  const warning = over
    ? `Border and bleed exceed what this artwork can carry (${Math.floor(maxOffsetMm * 10) / 10} mm at this size). Reduce them, or raise the sticker width.`
    : undefined;

  // Simplification tolerance in traced pixels.
  const tol = 0.12 + spec.smoothing * 0.18;

  // Rounding the outline is a blur of the distance field: it pulls convex
  // corners in and pushes concave ones out equally, the way offsetting out
  // and back in again does, so the shape stays centred on the artwork.
  // The radius has to be converted into traced pixels, or the same slider
  // value would round a small sticker far more than a large one.
  const roundPx = spec.shape === "rounded" ? Math.max(1, spec.roundMm * k) : 0;
  const field: Sdf = roundPx > 0 ? roundField(art.sdf, roundPx) : art.sdf;
  const shadowPadMm = spec.shadow && !flat ? Math.max(1.5, spec.widthMm * 0.05) : 0;
  const padWork = bleedWork + shadowPadMm * k;

  // Viewport: the cut shape, plus bleed, plus room for the shadow on screen.
  const boxX = radial ? radial.cx - radial.radius : b.x;
  const boxY = radial ? radial.cy - radial.radius : b.y;
  const boxW = radial ? radial.radius * 2 : b.w;
  const boxH = radial ? radial.radius * 2 : b.h;
  const vx = boxX - padWork;
  const vy = boxY - padWork;
  const wMm = r2((boxW + padWork * 2) / k);
  const hMm = r2((boxH + padWork * 2) / k);

  const toMm = { scale: 1 / k, originX: -vx / k, originY: -vy / k };
  const mm = (px: number) => px / k;

  /** The die line at a given offset, in millimetres. */
  const shapeAt = (offsetWork: number): string => {
    if (spec.shape === "circle" && radial) {
      return circlePath(mm(radial.cx - vx), mm(radial.cy - vy), mm(radial.radius + offsetWork));
    }
    if (spec.shape === "square") {
      return roundedRect(
        mm(b.x - offsetWork - vx),
        mm(b.y - offsetWork - vy),
        mm(b.w + offsetWork * 2),
        mm(b.h + offsetWork * 2),
        spec.roundMm,
      );
    }
    return contourPath(field, { offset: offsetWork, tolerance: tol, solid: spec.solid, ...toMm });
  };

  const cutWidthMm = r2((boxW + borderWork * 2) / k);
  const cutHeightMm = r2((boxH + borderWork * 2) / k);

  const cut = shapeAt(borderWork);
  if (!cut) {
    return {
      svg: "",
      cutPath: "",
      widthMm: spec.widthMm,
      heightMm: spec.widthMm,
      cutWidthMm,
      cutHeightMm,
      warning: "No shape found — the upload looks empty or fully transparent.",
    };
  }
  const bleedShape = spec.bleedMm > 0 ? shapeAt(bleedWork) : cut;

  // The artwork silhouette, tucked a hair inside its own edge so the mask
  // cannot leave a bright halo where it meets the border.
  const artShape = contourPath(art.sdf, { offset: -1, tolerance: tol, ...toMm });

  const ns = "sf";
  const finish = renderFinish(spec.finish, {
    ns,
    w: wMm,
    h: hMm,
    clip: `${ns}-clip`,
    maskBorder: `${ns}-border`,
    angle: spec.angle,
    intensity: spec.intensity,
    flat,
    animate: spec.animate && !flat,
  });

  // The artwork sits in the middle of the traced canvas, inset by the blank
  // margin that offsetting needs. Mapping it to the whole canvas instead
  // would draw it oversized and push it out over its own border.
  const inset = art.margin;
  const axMm = r2((inset - vx) / k);
  const ayMm = r2((inset - vy) / k);
  const awMm = r2((art.sdf.w - inset * 2) / k);
  const ahMm = r2((art.sdf.h - inset * 2) / k);

  let artLayer: string;
  if (art.source.kind === "raster") {
    artLayer = `<image x="${axMm}" y="${ayMm}" width="${awMm}" height="${ahMm}" href="${art.source.dataUrl}" preserveAspectRatio="none"/>`;
  } else {
    const vb = art.source.viewBox;
    const sx = awMm / vb.w;
    const sy = ahMm / vb.h;
    artLayer =
      `<g transform="translate(${r2(axMm - vb.x * sx)} ${r2(ayMm - vb.y * sy)}) scale(${r2(sx)} ${r2(sy)})">` +
      art.source.inner +
      `</g>`;
  }

  const baseFill = spec.finish === "clear" ? "none" : spec.borderColor;
  const shadowId = `${ns}-shadow`;
  const defs = [
    `<clipPath id="${ns}-clip"><path d="${bleedShape}" fill-rule="evenodd"/></clipPath>`,
    `<path id="${ns}-cut" d="${cut}" fill-rule="evenodd"/>`,
    `<mask id="${ns}-border" maskUnits="userSpaceOnUse" x="0" y="0" width="${wMm}" height="${hMm}">` +
      `<path d="${bleedShape}" fill="#fff" fill-rule="evenodd"/>` +
      (artShape ? `<path d="${artShape}" fill="#000" fill-rule="evenodd"/>` : "") +
      `</mask>`,
    spec.shadow && !flat
      ? `<filter id="${shadowId}" x="-25%" y="-25%" width="150%" height="150%">` +
        `<feDropShadow dx="0" dy="${r2(spec.widthMm * 0.012)}" stdDeviation="${r2(spec.widthMm * 0.012)}" flood-color="#05070c" flood-opacity="0.4"/>` +
        `</filter>`
      : "",
    finish.defs,
  ].join("");

  const body = [
    // The base carries the artwork out to the bleed so trimming cannot
    // expose a bare sliver at the cut line.
    // isolation:isolate keeps the blend modes inside the sticker. Without it
    // they composite against whatever the page puts behind the SVG, which
    // washes the whole thing out.
    `<g${spec.shadow && !flat ? ` filter="url(#${shadowId})"` : ""}${flat ? "" : ' style="isolation:isolate"'}>`,
    `<path d="${bleedShape}" fill-rule="evenodd" fill="${baseFill}"/>`,
    finish.under,
    `<g clip-path="url(#${ns}-clip)">${artLayer}</g>`,
    finish.over,
    `</g>`,
  ].join("");

  const cutLayer = flat
    ? `<g id="CutContour" inkscape:label="CutContour" inkscape:groupmode="layer">` +
      `<desc>Die-cut line. Spot colour: CutContour, 100% magenta, stroke only.</desc>` +
      `<path d="${cut}" fill="none" stroke="#FF00FF" stroke-width="0.25" fill-rule="evenodd"/>` +
      `</g>`
    : "";

  const sizeAttrs = flat ? ` width="${wMm}mm" height="${hMm}mm"` : "";
  const style = finish.css ? `<style>${finish.css}</style>` : "";
  const nsAttr = flat ? ` xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"` : "";

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg"${nsAttr}${sizeAttrs} viewBox="0 0 ${wMm} ${hMm}" role="img" aria-label="Die-cut ${finishById(spec.finish).label.toLowerCase()} sticker">` +
    (flat
      ? `<desc>Print-ready die-cut sticker. Cut size ${r2(spec.widthMm)}mm wide, ${spec.bleedMm}mm bleed. Cut line on the CutContour layer.</desc>`
      : "") +
    `<defs>${defs}</defs>${style}${body}${cutLayer}</svg>`;

  return { svg, cutPath: cut, widthMm: wMm, heightMm: hMm, cutWidthMm, cutHeightMm, warning };
}

/** SVG as a data URI, ready to drop into `background-image` or an `<img>`. */
export function svgDataUri(svg: string) {
  return `data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, "%27").replace(/"/g, "%22")}`;
}

/** Rasterise a built SVG at a print resolution. */
export async function rasterise(svg: string, widthMm: number, heightMm: number, dpi: number) {
  const px = (v: number) => Math.max(1, Math.round((v / 25.4) * dpi));
  const w = px(widthMm);
  const h = px(heightMm);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("Could not rasterise the sticker."));
      i.src = url;
    });
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    cv.getContext("2d")!.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob>((res, rej) =>
      cv.toBlob((bl) => (bl ? res(bl) : rej(new Error("Could not encode the PNG."))), "image/png"),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
