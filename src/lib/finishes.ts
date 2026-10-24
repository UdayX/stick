/**
 * Sticker finishes.
 *
 * A finish is markup, not a bitmap: defs plus layers that sit under and over
 * the artwork, all clipped to the die-cut shape. Everything stays resolution
 * independent so one description drives the on-screen preview, the copied
 * code and the exported file.
 *
 * `flat` renders the same finish without filters or blend modes, for print
 * output where RIPs handle those unevenly. Gradients survive; turbulence,
 * blur and blending do not.
 */

export type FinishId =
  | "holographic"
  | "prismatic"
  | "solar"
  | "chrome"
  | "brushed"
  | "glitter"
  | "pearl"
  | "neon"
  | "paper"
  | "kraft"
  | "matte"
  | "vinyl"
  | "clear";

export type Finish = {
  id: FinishId;
  label: string;
  blurb: string;
  /** Border colour when the finish does not paint its own material. */
  border: string;
  /** Swatch for the UI, CSS gradient syntax. */
  swatch: string;
};

export const FINISHES: Finish[] = [
  {
    id: "holographic",
    label: "Holographic",
    blurb: "Iridescent rainbow foil with an oil-slick ripple and a moving sheen.",
    border: "#ffffff",
    swatch: "linear-gradient(135deg,#ff2d9b,#ff8a3d,#ffe84d,#4dff9b,#3dd8ff,#8a6bff)",
  },
  {
    id: "prismatic",
    label: "Prismatic",
    blurb: "Sharp spectrum bands, like light split through a prism edge.",
    border: "#ffffff",
    swatch: "linear-gradient(135deg,#ff0040 0%,#ff0040 16%,#ffd400 16%,#ffd400 33%,#00e36a 33%,#00e36a 50%,#00b7ff 50%,#00b7ff 66%,#6a3cff 66%,#6a3cff 83%,#ff2bb5 83%)",
  },
  {
    id: "solar",
    label: "Solar",
    blurb: "Warm gold foil with hard specular banding, like sun on metal.",
    border: "#fff3d6",
    swatch: "linear-gradient(135deg,#3d2a00,#b8841f,#ffe9a8,#d9a73c,#7a5210,#ffd98a)",
  },
  {
    id: "chrome",
    label: "Chrome",
    blurb: "Mirror-polished metal with a cool horizon band.",
    border: "#eef4fa",
    swatch: "linear-gradient(135deg,#e8f4ff,#8fa8bd,#ffffff,#5b7183,#dfeaf5,#2f3d49)",
  },
  {
    id: "brushed",
    label: "Brushed",
    blurb: "Brushed aluminium, grain running with the gradient.",
    border: "#e9edf0",
    swatch: "linear-gradient(135deg,#d7dde2,#9aa5ad,#e8edf1,#848f98,#cfd6db)",
  },
  {
    id: "glitter",
    label: "Glitter",
    blurb: "Dense sparkle suspended in clear film, catching light at random.",
    border: "#ffffff",
    swatch: "radial-gradient(circle at 30% 30%,#fff 0 6%,transparent 6%),radial-gradient(circle at 70% 60%,#ffe9f6 0 5%,transparent 5%),linear-gradient(135deg,#ff9ad5,#9ad7ff,#fff0a8)",
  },
  {
    id: "pearl",
    label: "Pearl",
    blurb: "Soft pastel shimmer, the restrained cousin of holographic.",
    border: "#fffdfb",
    swatch: "linear-gradient(135deg,#fde9f3,#e6f0ff,#fff6e3,#eaf6ef,#f3e9fb)",
  },
  {
    id: "neon",
    label: "Neon",
    blurb: "Fluorescent stock with a glow that bleeds past the die line.",
    border: "#f2ff5e",
    swatch: "linear-gradient(135deg,#caff2e,#00ffa3,#00e5ff)",
  },
  {
    id: "paper",
    label: "Paper",
    blurb: "Uncoated matte stock with visible grain and a short, soft shadow.",
    border: "#fdfbf6",
    swatch: "linear-gradient(135deg,#fdfbf6,#efe8da,#f7f2e8)",
  },
  {
    id: "kraft",
    label: "Kraft",
    blurb: "Recycled brown stock with visible fibre and no shine at all.",
    border: "#c3a476",
    swatch: "linear-gradient(135deg,#c9ab7e,#a9875a,#d4ba93)",
  },
  {
    id: "matte",
    label: "Matte black",
    blurb: "Deep matte laminate that swallows light instead of reflecting it.",
    border: "#17181a",
    swatch: "linear-gradient(135deg,#2a2c30,#141517,#232528)",
  },
  {
    id: "vinyl",
    label: "Glossy vinyl",
    blurb: "The classic laminated die-cut sticker: white edge, crisp gloss.",
    border: "#ffffff",
    swatch: "linear-gradient(160deg,#ffffff 0%,#ffffff 46%,#e3ecf5 47%,#ffffff 100%)",
  },
  {
    id: "clear",
    label: "Clear",
    blurb: "Transparent film: no white edge, just a glass rim and a gloss pass.",
    border: "transparent",
    swatch: "linear-gradient(135deg,rgba(255,255,255,.5),rgba(190,220,255,.35),rgba(255,255,255,.6))",
  },
];

export const finishById = (id: FinishId) => FINISHES.find((f) => f.id === id) ?? FINISHES[0];

export type RenderCtx = {
  /** Unique prefix for every id this render emits. */
  ns: string;
  /** Sticker box in user units. */
  w: number;
  h: number;
  /** Id of the clipPath holding the die-cut shape. */
  clip: string;
  /**
   * Id of a mask that is white over the exposed border and black over the
   * artwork. The material reads at full strength on bare vinyl and only as a
   * sheen over printed ink, which is how a real foil sticker behaves.
   */
  maskBorder: string;
  /** Rotation of the finish's main gradient, degrees. */
  angle: number;
  /** 0..1 strength of the finish over the artwork. */
  intensity: number;
  flat: boolean;
  animate: boolean;
};

export type FinishLayers = {
  defs: string;
  /** Painted behind the artwork, inside the die-cut shape. */
  under: string;
  /** Painted over the artwork, clipped to the die-cut shape. */
  over: string;
  /** Fill for the die-cut base shape. */
  baseFill: string;
  /** CSS that belongs in the SVG's own <style>. */
  css: string;
};

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

/** A gradient at `angle` across the sticker box, in objectBoundingBox space. */
function gradientStops(id: string, angle: number, stops: [number, string, number?][]) {
  const r = ((angle - 90) * Math.PI) / 180;
  const dx = Math.cos(r) / 2;
  const dy = Math.sin(r) / 2;
  const body = stops
    .map(([o, c, a]) => `<stop offset="${pct(o)}" stop-color="${c}"${a === undefined ? "" : ` stop-opacity="${a}"`}/>`)
    .join("");
  return `<linearGradient id="${id}" x1="${pct(0.5 - dx)}" y1="${pct(0.5 - dy)}" x2="${pct(0.5 + dx)}" y2="${pct(0.5 + dy)}">${body}</linearGradient>`;
}

const RAINBOW: [number, string][] = [
  [0, "#ff2d9b"], [0.14, "#ff8a3d"], [0.28, "#ffe84d"], [0.43, "#4dff9b"],
  [0.57, "#3dd8ff"], [0.71, "#8a6bff"], [0.86, "#ff5ec4"], [1, "#ffe84d"],
];
const GOLD: [number, string][] = [
  [0, "#5a3c05"], [0.1, "#b8841f"], [0.2, "#ffe9a8"], [0.3, "#c9941f"],
  [0.44, "#7a5210"], [0.56, "#ffd98a"], [0.68, "#a87a24"], [0.82, "#ffe9a8"], [1, "#8a5f12"],
];
const PRISM: [number, string][] = [
  [0, "#ff0040"], [0.16, "#ff0040"], [0.16, "#ff8a00"], [0.32, "#ff8a00"],
  [0.32, "#ffd400"], [0.48, "#ffd400"], [0.48, "#00e36a"], [0.62, "#00e36a"],
  [0.62, "#00b7ff"], [0.78, "#00b7ff"], [0.78, "#6a3cff"], [0.9, "#6a3cff"],
  [0.9, "#ff2bb5"], [1, "#ff2bb5"],
];
const PEARL: [number, string][] = [
  [0, "#fde9f3"], [0.22, "#e6f0ff"], [0.44, "#fff6e3"], [0.66, "#eaf6ef"],
  [0.84, "#f3e9fb"], [1, "#fde9f3"],
];
const NEON: [number, string][] = [
  [0, "#caff2e"], [0.35, "#5bff8f"], [0.68, "#00ffd0"], [1, "#00e5ff"],
];
const STEEL: [number, string][] = [
  [0, "#f2f8ff"], [0.16, "#9fb4c7"], [0.3, "#ffffff"], [0.42, "#6a8294"],
  [0.5, "#2f3d49"], [0.58, "#7f97a9"], [0.72, "#ffffff"], [0.86, "#9fb4c7"], [1, "#e4eef7"],
];

/**
 * A sheen that travels across the sticker. Implemented as an oversized
 * gradient band moved by a CSS transform rather than an animated gradient,
 * because transforms animate reliably and keep working in a standalone file.
 */
function sheen(ctx: RenderCtx, opacity: number) {
  const { ns, w, h, animate } = ctx;
  // Scaled by intensity so turning the finish down actually turns it off.
  const strength = opacity * ctx.intensity;
  const id = `${ns}-sheen`;
  const band = Math.max(w, h) * 0.42;
  const defs = gradientStops(id, 100, [
    [0, "#ffffff", 0], [0.42, "#ffffff", 0.0], [0.5, "#ffffff", 1], [0.58, "#ffffff", 0.0], [1, "#ffffff", 0],
  ]);
  const rect = `<rect x="${-band}" y="${-h * 0.2}" width="${band * 1.4}" height="${h * 1.4}" fill="url(#${id})"/>`;
  const g = animate
    ? `<g class="${ns}-sweep">${rect}</g>`
    : `<g transform="translate(${w * 0.34} 0)">${rect}</g>`;
  return {
    defs,
    markup: `<g opacity="${strength.toFixed(3)}"${ctx.flat ? "" : ' style="mix-blend-mode:screen"'}>${g}</g>`,
    css: animate
      ? `@keyframes ${ns}-sweepk{0%{transform:translateX(0)}100%{transform:translateX(${(w + band * 1.4).toFixed(1)}px)}}` +
        `.${ns}-sweep{animation:${ns}-sweepk 4.2s cubic-bezier(.45,0,.55,1) infinite}` +
        `@media (prefers-reduced-motion:reduce){.${ns}-sweep{animation:none;transform:translateX(${(w * 0.34).toFixed(1)}px)}}`
      : "",
  };
}

/** Soft inner shade around the die-cut rim, so the sticker reads as an object. */
function rim(ctx: RenderCtx, strength: number) {
  const { ns, clip } = ctx;
  const id = `${ns}-rim`;
  const inset = Math.max(ctx.w, ctx.h) * 0.012;
  return {
    defs: `<filter id="${id}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${inset.toFixed(2)}"/></filter>`,
    markup: ctx.flat
      ? ""
      : `<g clip-path="url(#${clip})" opacity="${strength}"><use href="#${ns}-cut" fill="none" stroke="#000" stroke-width="${(inset * 2.4).toFixed(2)}" filter="url(#${id})"/></g>`,
  };
}

export function renderFinish(id: FinishId, ctx: RenderCtx): FinishLayers {
  const { ns, w, h, clip, maskBorder, angle, intensity, flat } = ctx;
  const f = finishById(id);
  const defs: string[] = [];
  const under: string[] = [];
  const over: string[] = [];
  const css: string[] = [];
  const full = `<rect width="${w}" height="${h}"`;

  /** Rippled foil: turbulence displaces the gradient into oil-slick bands. */
  const foil = (stops: [number, string][], ripple: number, blend: string) => {
    const gid = `${ns}-foil`;
    const fid = `${ns}-ripple`;
    defs.push(gradientStops(gid, angle, stops));
    if (!flat && ripple > 0) {
      defs.push(
        `<filter id="${fid}" x="-15%" y="-15%" width="130%" height="130%">` +
          `<feTurbulence type="fractalNoise" baseFrequency="${(0.004 + ripple * 0.004).toFixed(4)}" numOctaves="3" seed="7" result="n"/>` +
          `<feDisplacementMap in="SourceGraphic" in2="n" scale="${(Math.max(w, h) * 0.08 * ripple).toFixed(1)}" xChannelSelector="R" yChannelSelector="G"/>` +
          `</filter>`,
      );
    }
    const sheet = `${full} fill="url(#${gid})"/>`;
    const rippled = !flat && ripple > 0 ? `<g filter="url(#${fid})">${sheet}</g>` : sheet;
    under.push(rippled);
    // Full-strength material on the bare border...
    over.push(
      `<g mask="url(#${maskBorder})" opacity="${intensity.toFixed(2)}"${flat ? "" : ` style="mix-blend-mode:${blend}"`}>${rippled}</g>`,
    );
    // ...and a restrained pass across the artwork, so it keeps its own colour.
    over.push(
      `<g opacity="${(intensity * 0.28).toFixed(2)}"${flat ? "" : ` style="mix-blend-mode:${blend}"`}>${rippled}</g>`,
    );
  };

  switch (id) {
    case "holographic": {
      foil(RAINBOW, 1, "hard-light");
      const s = sheen(ctx, 0.5);
      defs.push(s.defs);
      over.push(s.markup);
      css.push(s.css);
      break;
    }
    case "solar": {
      foil(GOLD, 0.35, "overlay");
      const s = sheen(ctx, 0.65);
      defs.push(s.defs);
      over.push(s.markup);
      css.push(s.css);
      break;
    }
    case "chrome": {
      foil(STEEL, 0.15, "overlay");
      const s = sheen(ctx, 0.7);
      defs.push(s.defs);
      over.push(s.markup);
      css.push(s.css);
      break;
    }
    case "prismatic": {
      // Hard stops, no ripple: a prism splits light into bands, not swirls.
      foil(PRISM, 0, "hard-light");
      const sh = sheen(ctx, 0.45);
      defs.push(sh.defs);
      over.push(sh.markup);
      css.push(sh.css);
      break;
    }
    case "pearl": {
      foil(PEARL, 0.5, "soft-light");
      const sh = sheen(ctx, 0.4);
      defs.push(sh.defs);
      over.push(sh.markup);
      css.push(sh.css);
      break;
    }
    case "brushed": {
      // Brushing leaves the grain running one way, so the noise is stretched
      // along the gradient instead of being isotropic.
      const gid = `${ns}-brush`;
      defs.push(gradientStops(gid, angle, STEEL));
      if (!flat) {
        defs.push(
          `<filter id="${ns}-brushf" x="-10%" y="-10%" width="120%" height="120%">` +
            `<feTurbulence type="fractalNoise" baseFrequency="0.004 0.9" numOctaves="2" seed="11" result="n"/>` +
            `<feDisplacementMap in="SourceGraphic" in2="n" scale="${(Math.max(w, h) * 0.02).toFixed(1)}" xChannelSelector="R" yChannelSelector="G"/>` +
            `</filter>`,
        );
      }
      const sheet = `${full} fill="url(#${gid})"/>`;
      const brushed = flat ? sheet : `<g filter="url(#${ns}-brushf)">${sheet}</g>`;
      under.push(brushed);
      over.push(`<g mask="url(#${maskBorder})" opacity="${intensity.toFixed(2)}"${flat ? "" : ' style="mix-blend-mode:overlay"'}>${brushed}</g>`);
      over.push(`<g opacity="${(intensity * 0.22).toFixed(2)}"${flat ? "" : ' style="mix-blend-mode:overlay"'}>${brushed}</g>`);
      const sh = sheen(ctx, 0.55);
      defs.push(sh.defs);
      over.push(sh.markup);
      css.push(sh.css);
      break;
    }
    case "glitter": {
      // Sparkle is noise pushed through a hard threshold, so only the peaks
      // survive as flakes rather than the whole field going grey.
      const gid = `${ns}-flakegrad`;
      defs.push(gradientStops(gid, angle, [
        [0, "#ff9ad5"], [0.3, "#fff0a8"], [0.55, "#9ad7ff"], [0.8, "#d7b4ff"], [1, "#ffffff"],
      ]));
      if (!flat) {
        defs.push(
          `<filter id="${ns}-flake" x="0%" y="0%" width="100%" height="100%">` +
            `<feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="1" seed="19" result="n"/>` +
            `<feColorMatrix in="n" type="matrix" result="k" values="` +
            `0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  5 0 0 0 -2.6"/>` +
            `<feComposite in="SourceGraphic" in2="k" operator="in"/>` +
            `</filter>`,
        );
        over.push(
          `<g opacity="${Math.min(1, intensity * 1.5).toFixed(2)}" style="mix-blend-mode:screen">` +
            `<g filter="url(#${ns}-flake)">${full} fill="url(#${gid})"/></g></g>`,
        );
      }
      under.push(`${full} fill="url(#${gid})" opacity="0.5"/>`);
      const sh = sheen(ctx, 0.4);
      defs.push(sh.defs);
      over.push(sh.markup);
      css.push(sh.css);
      break;
    }
    case "neon": {
      defs.push(gradientStops(`${ns}-fluoro`, angle, NEON));
      under.push(`${full} fill="url(#${ns}-fluoro)"/>`);
      // Fluorescent ink is flat and loud: strong on the bare border, barely
      // anything over the artwork, and no specular highlight.
      over.push(`<g mask="url(#${maskBorder})" opacity="${intensity.toFixed(2)}"${flat ? "" : ' style="mix-blend-mode:hard-light"'}>${full} fill="url(#${ns}-fluoro)"/></g>`);
      over.push(`<g opacity="${(intensity * 0.18).toFixed(2)}"${flat ? "" : ' style="mix-blend-mode:screen"'}>${full} fill="url(#${ns}-fluoro)"/></g>`);
      break;
    }
    case "kraft": {
      const gid = `${ns}-fibre`;
      if (!flat) {
        defs.push(
          `<filter id="${gid}" x="0%" y="0%" width="100%" height="100%">` +
            `<feTurbulence type="fractalNoise" baseFrequency="0.55 0.9" numOctaves="4" seed="23"/>` +
            `<feColorMatrix type="saturate" values="0.15"/>` +
            `</filter>`,
        );
        over.push(`<g opacity="${(0.45 * intensity).toFixed(2)}" style="mix-blend-mode:multiply">${full} filter="url(#${gid})"/></g>`);
      }
      defs.push(gradientStops(`${ns}-kraftwash`, angle, [[0, "#d9bd90", 0.55], [1, "#9c7a4c", 0.5]]));
      over.push(`<g opacity="${(0.5 * intensity).toFixed(2)}"${flat ? "" : ' style="mix-blend-mode:multiply"'}>${full} fill="url(#${ns}-kraftwash)"/></g>`);
      break;
    }
    case "matte": {
      const gid = `${ns}-mattegrain`;
      if (!flat) {
        defs.push(
          `<filter id="${gid}" x="0%" y="0%" width="100%" height="100%">` +
            `<feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="3" seed="31"/>` +
            `<feColorMatrix type="saturate" values="0"/>` +
            `</filter>`,
        );
        over.push(`<g opacity="${(0.18 * intensity).toFixed(2)}" style="mix-blend-mode:overlay">${full} filter="url(#${gid})"/></g>`);
      }
      // Matte laminate darkens and flattens; it never throws a highlight.
      defs.push(gradientStops(`${ns}-mattewash`, angle, [[0, "#3a3d42", 0.4], [1, "#0d0e10", 0.5]]));
      over.push(`<g mask="url(#${maskBorder})" opacity="${(0.7 * intensity).toFixed(2)}"${flat ? "" : ' style="mix-blend-mode:multiply"'}>${full} fill="url(#${ns}-mattewash)"/></g>`);
      break;
    }
    case "paper": {
      const gid = `${ns}-grain`;
      if (!flat) {
        defs.push(
          `<filter id="${gid}" x="0%" y="0%" width="100%" height="100%">` +
            `<feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="4" seed="3"/>` +
            `<feColorMatrix type="saturate" values="0"/>` +
            `</filter>`,
        );
        over.push(
          `<g opacity="${(0.3 * intensity).toFixed(2)}" style="mix-blend-mode:multiply">${full} filter="url(#${gid})"/></g>`,
        );
      }
      // Uncoated stock scatters light: a flat warm wash, no specular at all.
      defs.push(gradientStops(`${ns}-wash`, angle, [[0, "#ffffff", 0.5], [1, "#e7dcc6", 0.45]]));
      over.push(`<g opacity="${(0.4 * intensity).toFixed(2)}"${flat ? "" : ' style="mix-blend-mode:soft-light"'}>${full} fill="url(#${ns}-wash)"/></g>`);
      break;
    }
    case "vinyl": {
      // Laminate gloss: one broad highlight across the top, one tight rim light.
      defs.push(
        gradientStops(`${ns}-gloss`, angle, [
          [0, "#ffffff", 0.55], [0.4, "#ffffff", 0.12], [0.42, "#ffffff", 0], [1, "#ffffff", 0],
        ]),
      );
      over.push(`<g opacity="${(0.9 * intensity).toFixed(2)}"${flat ? "" : ' style="mix-blend-mode:screen"'}>${full} fill="url(#${ns}-gloss)"/></g>`);
      const s = sheen(ctx, 0.35);
      defs.push(s.defs);
      over.push(s.markup);
      css.push(s.css);
      break;
    }
    case "clear": {
      defs.push(
        gradientStops(`${ns}-glass`, angle, [
          [0, "#ffffff", 0.42], [0.35, "#dceaff", 0.1], [0.65, "#ffffff", 0.06], [1, "#cfe4ff", 0.3],
        ]),
      );
      over.push(`<g opacity="${(0.85 * intensity).toFixed(2)}"${flat ? "" : ' style="mix-blend-mode:screen"'}>${full} fill="url(#${ns}-glass)"/></g>`);
      over.push(`<use href="#${ns}-cut" fill="none" stroke="#ffffff" stroke-opacity="0.5" stroke-width="${(Math.max(w, h) * 0.004).toFixed(2)}"/>`);
      break;
    }
  }

  const flatStock = id === "paper" || id === "kraft" || id === "matte";
  const r = rim(ctx, flatStock ? 0.09 : 0.16);
  defs.push(r.defs);
  if (r.markup) over.push(r.markup);

  return {
    defs: defs.join(""),
    under: `<g clip-path="url(#${clip})">${under.join("")}</g>`,
    over: `<g clip-path="url(#${clip})">${over.join("")}</g>`,
    baseFill: f.border,
    css: css.join(""),
  };
}
