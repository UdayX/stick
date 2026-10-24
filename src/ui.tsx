import type { ReactNode } from "react";

/* Icons are inline SVG at a single stroke width, never emoji: emoji are
   font-dependent and cannot take a theme colour. */
const icon = (path: ReactNode) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="size-4 shrink-0"
  >
    {path}
  </svg>
);

export const Icons = {
  upload: icon(<><path d="M12 15V3" /><path d="m8 7 4-4 4 4" /><path d="M3 15v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4" /></>),
  copy: icon(<><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>),
  download: icon(<><path d="M12 3v12" /><path d="m8 11 4 4 4-4" /><path d="M3 17v2a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2" /></>),
  check: icon(<path d="m5 13 4 4L19 7" />),
  alert: icon(<><circle cx="12" cy="12" r="9" /><path d="M12 8v4" /><path d="M12 16h.01" /></>),
  chevron: icon(<path d="m9 6 6 6-6 6" />),
};

/** A collapsible group. Native <details>, so keyboard and find-in-page work. */
export function Section({
  title, children, defaultOpen = false, hint,
}: {
  title: string; children: ReactNode; defaultOpen?: boolean; hint?: string;
}) {
  return (
    <details open={defaultOpen} className="border-b border-line">
      <summary className="flex items-center gap-2 px-6 py-4 select-none">
        <span className="chev text-muted">{Icons.chevron}</span>
        <span className="text-[13px] font-medium">{title}</span>
        {hint && <span className="ml-auto text-xs text-muted tnum">{hint}</span>}
      </summary>
      <div className="px-6 pb-6">{children}</div>
    </details>
  );
}

/** Label on the left, value on the right, control underneath. */
export function Slider({
  label, value, min, max, step = 1, unit = "", onChange, describedBy,
}: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string;
  onChange: (v: number) => void; describedBy?: string;
}) {
  const id = `r-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className="mb-5 last:mb-0">
      <div className="mb-1 flex items-baseline justify-between gap-4">
        <label htmlFor={id} className="text-[13px] text-ink">{label}</label>
        <output htmlFor={id} className="tnum text-[13px] text-muted">
          {Math.round(value * 100) / 100}
          {unit}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.currentTarget.valueAsNumber)}
      />
    </div>
  );
}

/** Switch rather than a checkbox: this turns a thing on, it does not pick one. */
export function Switch({
  label, hint, checked, onChange, disabled,
}: {
  label: string; hint?: string; checked: boolean; disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className={`mb-4 flex min-h-[44px] items-center justify-between gap-4 last:mb-0 ${
        disabled ? "opacity-40" : "cursor-pointer"
      }`}
    >
      <span className="text-[13px] leading-snug">
        {label}
        {hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}
      </span>
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
      <span
        aria-hidden="true"
        className="relative h-[22px] w-[38px] shrink-0 rounded-full border border-line-strong bg-raised transition-colors duration-200 peer-checked:border-ink peer-checked:bg-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink"
      >
        {/* Driven by `checked` directly: the knob is a descendant, not a
            sibling of the input, so a peer selector cannot reach it. */}
        <span
          className="absolute top-[3px] left-[3px] size-[14px] rounded-full transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]"
          style={{
            transform: checked ? "translateX(16px)" : "translateX(0)",
            background: checked ? "var(--color-base)" : "var(--color-muted)",
          }}
        />
      </span>
    </label>
  );
}

export function Button({
  children, onClick, variant = "quiet", disabled, full,
}: {
  children: ReactNode; onClick: () => void;
  variant?: "quiet" | "primary"; disabled?: boolean; full?: boolean;
}) {
  const look =
    variant === "primary"
      ? "bg-ink text-base border-ink"
      : "bg-surface text-ink border-line";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`press hov inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg border px-3 text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-35 ${look} ${
        full ? "w-full" : ""
      }`}
    >
      {children}
    </button>
  );
}
