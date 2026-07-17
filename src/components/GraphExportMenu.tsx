import { useEffect, useRef, useState } from "react";
import type { GraphExportChoice } from "../lib/graphExport";

const OPTIONS: {
  scope: GraphExportChoice["scope"];
  format: GraphExportChoice["format"];
  label: string;
  hint: string;
}[] = [
  {
    scope: "view",
    format: "png",
    label: "Current view → PNG",
    hint: "What you see now",
  },
  {
    scope: "view",
    format: "pdf",
    label: "Current view → PDF",
    hint: "What you see now (1 page)",
  },
  {
    scope: "whole",
    format: "png",
    label: "Whole graph → PNG",
    hint: "Full graph as one image",
  },
  {
    scope: "whole",
    format: "pdf",
    label: "Whole graph → PDF",
    hint: "Full graph (aChart may be multi-page)",
  },
];

export function GraphExportMenu({
  busy,
  onExport,
  wholePdfHint,
}: {
  busy?: boolean;
  onExport: (choice: GraphExportChoice) => void | Promise<void>;
  /** Override tooltip for whole→PDF (e.g. aChart multi-page) */
  wholePdfHint?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="graph-export-menu" ref={rootRef}>
      <button
        type="button"
        disabled={busy}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        title="Export graph as image or PDF"
      >
        {busy ? "Exporting…" : "Export…"}
      </button>
      {open ? (
        <div className="graph-export-dropdown" role="menu">
          {OPTIONS.map((opt) => (
            <button
              key={`${opt.scope}-${opt.format}`}
              type="button"
              role="menuitem"
              disabled={busy}
              title={
                opt.scope === "whole" && opt.format === "pdf" && wholePdfHint
                  ? wholePdfHint
                  : opt.hint
              }
              onClick={() => {
                setOpen(false);
                void onExport({ format: opt.format, scope: opt.scope });
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
