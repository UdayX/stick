# STICK

Drop in an SVG or PNG, get a die-cut sticker out — print ready and web ready,
without opening Illustrator.

Everything runs in the browser. Nothing is uploaded.

## What it does

**Traces a real cut line.** The die line is an offset path: the same result as
Illustrator's `Object > Path > Offset Path` followed by `Pathfinder > Unite`.
It comes from an iso-contour of a signed distance field built from the
artwork's alpha, which means the unite step is free — wherever two offset
pieces overlap, the field has already merged them — and the border, the bleed
and the artwork silhouette are the same operation at three different
distances. One code path covers SVG and PNG alike.

**Keeps vector artwork vector.** An uploaded SVG is inlined into the export,
so the result stays resolution independent. The rasterisation exists only to
trace geometry from.

**Four cut shapes.** Contour hugs the artwork; Rounded softens its corners by
blurring the distance field (a morphological close, so the shape stays centred
and both convex and concave corners round evenly); Circle and Square wrap it.

**Thirteen finishes.** Holographic, Prismatic, Solar, Chrome, Brushed,
Glitter, Pearl, Neon, Paper, Kraft, Matte black, Glossy vinyl and Clear. Each
is markup rather than a bitmap, so it scales. Foil reads at full strength on
the bare border and only as a sheen over the artwork, the way a real foil
sticker behaves.

## Exports

| File | What it is |
| --- | --- |
| **Print SVG** | Sized in millimetres, artwork carried out to the bleed, die line on a `CutContour` layer in spot magenta. Filters and blend modes are left out, since RIPs handle them unevenly. |
| **Web SVG** | No fixed size, so it fills whatever box it lands in. Keeps the filters, blend modes and the moving sheen. |
| **PNG** | Exactly what the preview shows, flattened, at 150/300/600 DPI. The safe option when a printer rejects effects. |

Plus copy-to-clipboard for the raw SVG markup and for a CSS `url()` value.

## Running it

```bash
npm install
npm run dev     # http://localhost:5173
npm run check   # typecheck + geometry self-checks
npm run build
```

## Geometry self-checks

The tracing and millimetre maths are the parts that quietly ruin a print run,
so they have runnable checks that need no test framework:

```bash
node src/lib/trace.selftest.ts   # offsetting, holes, specks, separate pieces
node src/lib/build.selftest.ts   # cut sizes, shape modes, artwork placement
```

## Uploaded SVG is treated as untrusted

An uploaded SVG is inlined into the live DOM and into every export, so it is
sanitised first: scripts, event handlers and any reference pointing off-document
are removed, and its ids are namespaced so the artwork cannot collide with — or
capture — the generated gradients, masks and filters.

## Licence

MIT
