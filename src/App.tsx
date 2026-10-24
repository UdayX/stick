import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { loadArtwork, type Artwork } from "./lib/artwork";
import {
  buildSticker, computeGeometry, renderSticker, rasterise, svgDataUri,
  DEFAULT_SPEC, clampSpec, scaleToWidth, maxBorderMm, maxBleedMm, maxRoundMm,
  MIN_WIDTH_MM, MAX_WIDTH_MM,
  type StickerSpec, type ShapeMode,
} from "./lib/build";
import { FINISHES, finishById } from "./lib/finishes";
import { Button, Icons, Section, Slider, Switch } from "./ui";

type Format = "web" | "print" | "png";

const SHAPES: { id: ShapeMode; label: string; hint: string }[] = [
  { id: "contour", label: "Contour", hint: "The die line hugs the artwork." },
  { id: "rounded", label: "Rounded", hint: "The same outline with its corners softened." },
  { id: "circle", label: "Circle", hint: "A disc that contains the artwork." },
  { id: "square", label: "Square", hint: "A rounded rectangle around the artwork." },
];

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export default function App() {
  const [art, setArt] = useState<Artwork | null>(null);
  const [name, setName] = useState("sticker");
  const [spec, setSpec] = useState<StickerSpec>(DEFAULT_SPEC);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCut, setShowCut] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [format, setFormat] = useState<Format>("print");
  const [dpi, setDpi] = useState(300);
  const [loadId, setLoadId] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const stage = useRef<HTMLElement>(null);
  const tilt = useRef<HTMLDivElement>(null);

  // Every change goes through the same clamp, so no control can be left
  // holding a value that another control has since made impossible.
  const set = <K extends keyof StickerSpec>(key: K) => (v: StickerSpec[K]) =>
    setSpec((s) => clampSpec({ ...s, [key]: v }));

  // Resizing is a scale, not a redesign: see scaleToWidth.
  const setWidth = (widthMm: number) => setSpec((s) => scaleToWidth(s, widthMm));

  // Picking a finish brings its own edge colour, the way choosing a stock does.
  const setFinish = (id: StickerSpec["finish"]) =>
    setSpec((s) => clampSpec({ ...s, finish: id, borderColor: finishById(id).border }));

  // One transient message channel; it clears itself so nothing piles up.
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), note.bad ? 6000 : 3000);
    return () => clearTimeout(t);
  }, [note]);

  const open = useCallback(async (file: File) => {
    setBusy(true);
    try {
      const loaded = await loadArtwork(file);
      setArt(loaded);
      setLoadId((n) => n + 1);
      setName(file.name.replace(/\.[^.]+$/, "") || "sticker");
      setNote({
        text:
          loaded.wasOpaque && loaded.source.kind === "raster"
            ? "Traced. That image had no transparency, so its flat background was removed."
            : "Traced.",
      });
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : "That file could not be loaded.", bad: true });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const over = (e: DragEvent) => {
      e.preventDefault();
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) void open(file);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [open]);

  // A sticker is a physical thing, so it leans a little towards the pointer.
  // Written straight to the element: putting a pointer position through state
  // would re-render the whole tree on every mouse move.
  useEffect(() => {
    const host = stage.current;
    if (!host || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    let frame = 0;
    const move = (e: PointerEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const el = tilt.current;
        if (!el) return;
        const r = host.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
        const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
        const clamp = (v: number) => Math.max(-1, Math.min(1, v));
        el.style.transform =
          `perspective(900px) rotateY(${(clamp(dx) * 7).toFixed(2)}deg) rotateX(${(-clamp(dy) * 7).toFixed(2)}deg)`;
      });
    };
    const reset = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (tilt.current) tilt.current.style.transform = "";
    };
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerleave", reset);
    return () => {
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", reset);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [art]);

  // Tracing is the expensive step, so the preview trails the controls instead
  // of blocking the slider that is being dragged.
  const liveSpec = useDeferredValue(spec);

  // Tracing only depends on the shape and the measurements, so changing
  // finish, angle or strength re-paints without re-tracing.
  const geo = useMemo(
    () => (art ? computeGeometry(art, liveSpec, false) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [art, liveSpec.shape, liveSpec.widthMm, liveSpec.borderMm, liveSpec.bleedMm,
     liveSpec.roundMm, liveSpec.solid, liveSpec.smoothing, liveSpec.shadow],
  );
  const web = useMemo(() => (geo ? renderSticker(geo, liveSpec, "web") : null), [geo, liveSpec]);

  // The finish previews all share one trace: only the finish differs between
  // them, and tracing thirteen times per keystroke would be absurd. They also
  // use a fixed thumbnail size rather than the live one, so dragging the size
  // sliders never re-traces them - a preview chip has no real-world size.
  const swatchSpec = useMemo(
    () => ({
      ...DEFAULT_SPEC,
      shape: liveSpec.shape,
      solid: liveSpec.solid,
      smoothing: liveSpec.smoothing,
      // A fat border on a small chip: the material lives on the border, so
      // this is what makes one finish tell apart from another at this size.
      widthMm: 40,
      borderMm: 8,
      bleedMm: 0,
      roundMm: liveSpec.roundMm,
      shadow: false,
      animate: false,
    }),
    [liveSpec.shape, liveSpec.solid, liveSpec.smoothing, liveSpec.roundMm],
  );
  const swatchGeo = useMemo(
    () => (art ? computeGeometry(art, swatchSpec, true) : null),
    [art, swatchSpec],
  );
  const swatches = useMemo(() => {
    if (!swatchGeo?.cut) return null;
    const out: Record<string, string> = {};
    for (const f of FINISHES) {
      out[f.id] = renderSticker(
        swatchGeo,
        { ...swatchSpec, finish: f.id, borderColor: f.border },
        "flat",
        `sw${f.id}`,
      ).svg;
    }
    return out;
  }, [swatchGeo, swatchSpec]);

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNote({ text: `${what} copied.` });
    } catch {
      setNote({ text: "The browser blocked clipboard access.", bad: true });
    }
  };

  const save = async () => {
    if (!web || !art) return;
    if (format === "png") {
      setBusy(true);
      try {
        const r = await rasterise(web.svg, web.widthMm, web.heightMm, dpi);
        download(r.blob, `${name}-${spec.finish}-${r.dpi}dpi.png`);
        setNote({
          text:
            r.dpi < dpi
              ? `PNG saved at ${r.dpi} DPI — ${dpi} DPI at this size is past what the browser can rasterise.`
              : `PNG saved at ${dpi} DPI, ${r.width} × ${r.height} px.`,
          bad: r.dpi < dpi,
        });
      } catch (e) {
        setNote({ text: e instanceof Error ? e.message : "The PNG could not be written.", bad: true });
      } finally {
        setBusy(false);
      }
      return;
    }
    const target = format === "print" ? buildSticker(art, liveSpec, "print") : web;
    download(new Blob([target.svg], { type: "image/svg+xml" }), `${name}-${spec.finish}-${format}.svg`);
    setNote({ text: `${format === "print" ? "Print" : "Web"} SVG saved.` });
  };

  const finish = finishById(spec.finish);
  const cutW = web ? Math.round(web.cutWidthMm) : 0;
  const cutH = web ? Math.round(web.cutHeightMm) : 0;
  const pxW = web ? Math.round((web.widthMm / 25.4) * dpi) : 0;
  const pxH = web ? Math.round((web.heightMm / 25.4) * dpi) : 0;

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:flex-row-reverse lg:overflow-hidden">
      <aside className="w-full shrink-0 overflow-y-auto border-line bg-surface lg:w-[360px] lg:border-l">
        <header className="px-6 pt-9 pb-8">
          <h1 className="flex items-baseline gap-2 text-[34px] leading-none font-semibold tracking-[-0.04em]">
            STICK
            <span aria-hidden="true" className="text-[11px] font-medium tracking-[0.22em] text-muted">
              ⌁ PEEL
            </span>
          </h1>
          <p className="mt-3 max-w-[30ch] text-[13px] leading-relaxed text-muted">
            Artwork in, die-cut sticker out. Print and web ready, no Illustrator.
          </p>
        </header>

        <div className="border-t border-line px-6 py-5">
          <input
            ref={fileInput}
            type="file"
            accept=".svg,.png,.jpg,.jpeg,.webp,image/svg+xml,image/png,image/jpeg,image/webp"
            className="sr-only"
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              if (f) void open(f);
              e.currentTarget.value = "";
            }}
          />
          <Button variant={art ? "quiet" : "primary"} full onClick={() => fileInput.current?.click()}>
            {Icons.upload}
            {art ? "Replace artwork" : "Choose a file"}
          </Button>
          {art && <p className="mt-3 truncate text-xs text-muted">{name}</p>}
        </div>

        {/* Nothing below appears until there is artwork to act on. */}
        {art && web && (
          <div className="lift">
            <Section title="Finish" defaultOpen hint={finish.label}>
              <div role="radiogroup" aria-label="Sticker finish" className="grid grid-cols-3 gap-2.5">
                {FINISHES.map((f) => {
                  const on = f.id === spec.finish;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setFinish(f.id)}
                      className={`press group rounded-lg border p-1.5 text-left ${
                        on ? "border-ink" : "hov-tile border-line"
                      }`}
                    >
                      {swatches?.[f.id] ? (
                        /* The preview is the real sticker, in that finish:
                           far more use than an abstract gradient chip. */
                        <span
                          className="checker flex h-14 w-full items-center justify-center overflow-hidden rounded [&>svg]:h-[88%] [&>svg]:w-auto [&>svg]:max-w-[88%]"
                          aria-hidden="true"
                          dangerouslySetInnerHTML={{ __html: swatches[f.id] }}
                        />
                      ) : (
                        <span
                          className="checker block h-14 w-full rounded"
                          style={{ backgroundImage: f.swatch }}
                          aria-hidden="true"
                        />
                      )}
                      <span className="mt-2 mb-0.5 block text-[11px] leading-tight text-muted group-aria-checked:text-ink">
                        {f.label}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-4 text-xs leading-relaxed text-muted">{finish.blurb}</p>
            </Section>

            <Section title="Size and cut" defaultOpen hint={`${cutW} × ${cutH} mm`}>
              <div role="radiogroup" aria-label="Cut shape" className="mb-5 grid grid-cols-4 gap-1 rounded-lg border border-line p-1">
                {SHAPES.map((sh) => {
                  const on = sh.id === spec.shape;
                  return (
                    <button
                      key={sh.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => set("shape")(sh.id)}
                      className={`press rounded-md py-1.5 text-[12px] ${
                        on ? "bg-ink text-base" : "hov text-muted hover:text-ink"
                      }`}
                    >
                      {sh.label}
                    </button>
                  );
                })}
              </div>
              <p id="shape-hint" className="mb-5 text-xs leading-relaxed text-muted">
                {SHAPES.find((sh) => sh.id === spec.shape)!.hint}
              </p>

              <Slider label="Sticker width" value={spec.widthMm} min={MIN_WIDTH_MM} max={MAX_WIDTH_MM} unit=" mm" onChange={setWidth} />
              <Slider
                label="Border"
                value={spec.borderMm}
                min={0}
                max={maxBorderMm(spec.widthMm)}
                step={0.25}
                unit=" mm"
                onChange={set("borderMm")}
              />
              {(spec.shape === "rounded" || spec.shape === "square") && (
                <Slider
                  label="Corner rounding"
                  value={spec.roundMm}
                  min={0}
                  max={maxRoundMm(spec.widthMm, spec.borderMm, spec.shape)}
                  step={0.25}
                  unit=" mm"
                  onChange={set("roundMm")}
                />
              )}
              <Slider
                label="Bleed"
                value={spec.bleedMm}
                min={0}
                max={maxBleedMm(spec.widthMm)}
                step={0.25}
                unit=" mm"
                onChange={set("bleedMm")}
              />
              <div className="mt-6">
                {spec.shape === "contour" || spec.shape === "rounded" ? (
                  <Switch
                    label="Cut as one piece"
                    hint="Closes holes so the sticker peels in one."
                    checked={spec.solid}
                    onChange={set("solid")}
                  />
                ) : null}
                <Switch label="Show the cut line" checked={showCut} onChange={setShowCut} />
              </div>
            </Section>

            <Section title="Appearance">
              <Slider label="Finish strength" value={spec.intensity} min={0} max={1} step={0.01} onChange={set("intensity")} />
              <Slider label="Gradient angle" value={spec.angle} min={0} max={360} unit="°" onChange={set("angle")} />
              {(spec.shape === "contour" || spec.shape === "rounded") && (
                <Slider label="Outline smoothing" value={spec.smoothing} min={0} max={3} step={0.1} onChange={set("smoothing")} />
              )}
              <div className="mt-6 mb-4 flex min-h-[44px] items-center justify-between gap-4">
                <label htmlFor="edge" className="text-[13px]">
                  Edge colour
                  {spec.finish === "clear" && <span className="mt-0.5 block text-xs text-muted">Clear film has no edge.</span>}
                </label>
                <input
                  id="edge"
                  type="color"
                  className="h-8 w-12 cursor-pointer rounded border border-line bg-transparent disabled:opacity-35"
                  value={spec.borderColor}
                  disabled={spec.finish === "clear"}
                  onChange={(e) => set("borderColor")(e.currentTarget.value)}
                />
              </div>
              <Switch label="Drop shadow" hint="Preview and web only, never printed." checked={spec.shadow} onChange={set("shadow")} />
              <Switch label="Moving sheen" hint="Animated in the web export." checked={spec.animate} onChange={set("animate")} />
            </Section>

            <Section title="Export" defaultOpen>
              <div className="mb-5">
                <label htmlFor="format" className="mb-1.5 block text-[13px]">File</label>
                <select
                  id="format"
                  className="press hov h-10 w-full rounded-lg border border-line bg-raised px-3 text-[13px]"
                  value={format}
                  onChange={(e) => setFormat(e.currentTarget.value as Format)}
                >
                  <option value="print">Print SVG — millimetres, cut layer</option>
                  <option value="web">Web SVG — scales, animated</option>
                  <option value="png">PNG — flattened raster</option>
                </select>
              </div>

              {format === "png" && (
                <div className="mb-5 lift">
                  <label htmlFor="dpi" className="mb-1.5 block text-[13px]">Resolution</label>
                  <select
                    id="dpi"
                    className="press hov h-10 w-full rounded-lg border border-line bg-raised px-3 text-[13px]"
                    value={dpi}
                    onChange={(e) => setDpi(Number(e.currentTarget.value))}
                  >
                    <option value={150}>150 DPI — draft</option>
                    <option value={300}>300 DPI — print</option>
                    <option value={600}>600 DPI — fine</option>
                  </select>
                  <p className="tnum mt-2 text-xs text-muted">{pxW} × {pxH} px</p>
                </div>
              )}

              <Button variant="primary" full disabled={busy} onClick={() => void save()}>
                {Icons.download}
                {busy ? "Working" : "Download"}
              </Button>

              <div className="mt-2.5 grid grid-cols-2 gap-2.5">
                <Button onClick={() => void copy(web.svg, "SVG markup")}>{Icons.copy}Copy SVG</Button>
                <Button onClick={() => void copy(`url("${svgDataUri(web.svg)}")`, "CSS value")}>{Icons.copy}Copy CSS</Button>
              </div>

              <p className="mt-5 text-xs leading-relaxed text-muted">
                {format === "print"
                  ? "Sized in millimetres, artwork carried out to the bleed, die line on a CutContour layer in spot magenta. Filters and blend modes are left out, since RIPs handle them unevenly — for a finish that leans on them, send the PNG."
                  : format === "web"
                    ? "No fixed size, so it fills whatever box it lands in. Keeps the filters, blend modes and the sheen."
                    : "Exactly what the preview shows, flattened. The safe option when a printer rejects effects."}
              </p>
            </Section>
          </div>
        )}
      </aside>

      <main ref={stage} className="relative flex min-h-[55vh] flex-1 items-center justify-center p-8 lg:min-h-0 lg:p-16">
        <div className="checker absolute inset-6 rounded-xl border border-line bg-surface/40" aria-hidden="true" />

        {art && web?.svg ? (
          <figure key={loadId} className="rise relative flex w-full max-w-xl flex-col items-center gap-8">
            <div ref={tilt} className="relative w-full transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] will-change-transform">
              <div
                className="[&>svg]:mx-auto [&>svg]:max-h-[62vh] [&>svg]:w-auto [&>svg]:max-w-full"
                /* Uploaded SVG is sanitised in artwork.ts before it gets here. */
                dangerouslySetInnerHTML={{ __html: web.svg }}
              />
              {showCut && (
                <svg
                  className="pointer-events-none absolute inset-0 m-auto max-h-[62vh] w-auto max-w-full"
                  viewBox={`0 0 ${web.widthMm} ${web.heightMm}`}
                  aria-hidden="true"
                >
                  <path
                    d={web.cutPath}
                    fill="none"
                    stroke="#ff00c8"
                    strokeWidth={web.widthMm * 0.005}
                    strokeDasharray={`${web.widthMm * 0.02} ${web.widthMm * 0.015}`}
                    fillRule="evenodd"
                  />
                </svg>
              )}
            </div>
            <figcaption className="tnum text-xs text-muted">
              {finish.label} · {cutW} × {cutH} mm
            </figcaption>
          </figure>
        ) : (
          <div className="relative max-w-sm text-center">
            <p className="text-2xl leading-tight font-semibold tracking-tight">
              {busy ? "Tracing the outline" : "Throw some artwork in here"}
            </p>
            <p className="mx-auto mt-4 max-w-[32ch] text-[13px] leading-relaxed text-muted">
              An SVG or a PNG. Transparent or flat-backed, both work. Nothing leaves this tab.
            </p>
          </div>
        )}

        {web?.warning && (
          <p className="lift absolute bottom-10 flex max-w-md items-center gap-2 rounded-lg border border-line-strong bg-raised px-3.5 py-2.5 text-xs leading-relaxed">
            <span className="text-muted">{Icons.alert}</span>
            {web.warning}
          </p>
        )}

        {dragging && (
          <div className="absolute inset-6 flex items-center justify-center rounded-xl border border-dashed border-ink bg-base/70 text-[13px]">
            Drop to trace
          </div>
        )}
      </main>

      <p aria-live="polite" className="sr-only">{note?.text ?? ""}</p>
      {note && (
        <div className="lift fixed bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-line-strong bg-raised px-3.5 py-2.5 text-[13px] shadow-lg">
          <span className="text-muted">{note.bad ? Icons.alert : Icons.check}</span>
          {note.text}
        </div>
      )}
    </div>
  );
}
