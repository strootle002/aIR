import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";

export type GraphExportFormat = "png" | "pdf";
export type GraphExportScope = "view" | "whole";

export type GraphExportChoice = {
  format: GraphExportFormat;
  scope: GraphExportScope;
};

function dataUrlToBase64(dataUrl: string): string {
  const i = dataUrl.indexOf(",");
  return i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
}

function bgColor(): string {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue("--bg")
    .trim();
  return v || "#1a1d21";
}

export async function captureElementPng(
  el: HTMLElement,
  opts?: {
    width?: number;
    height?: number;
    style?: Partial<CSSStyleDeclaration>;
    filter?: (node: HTMLElement) => boolean;
  },
): Promise<string> {
  return toPng(el, {
    cacheBust: true,
    pixelRatio: 2,
    backgroundColor: bgColor(),
    width: opts?.width,
    height: opts?.height,
    style: opts?.style as Record<string, string> | undefined,
    filter: opts?.filter,
  });
}

export async function promptSavePath(
  defaultName: string,
  format: GraphExportFormat,
): Promise<string | null> {
  return save({
    defaultPath: defaultName,
    filters:
      format === "pdf"
        ? [{ name: "PDF", extensions: ["pdf"] }]
        : [{ name: "PNG", extensions: ["png"] }],
  });
}

export async function writeExportFile(
  path: string,
  dataUrlOrBase64: string,
): Promise<void> {
  const base64 = dataUrlOrBase64.startsWith("data:")
    ? dataUrlToBase64(dataUrlOrBase64)
    : dataUrlOrBase64;
  await invoke("export_bytes", { path, base64 });
}

/** Single PNG → one-page PDF (landscape, image scaled to fit). */
export function pngDataUrlToPdfBase64(dataUrl: string): string {
  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "pt",
    format: "a4",
  });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 18;
  const maxW = pageW - margin * 2;
  const maxH = pageH - margin * 2;

  const props = pdf.getImageProperties(dataUrl);
  const scale = Math.min(maxW / props.width, maxH / props.height);
  const w = props.width * scale;
  const h = props.height * scale;
  const x = (pageW - w) / 2;
  const y = (pageH - h) / 2;
  pdf.addImage(dataUrl, "PNG", x, y, w, h);
  return dataUrlToBase64(pdf.output("datauristring"));
}

/**
 * Multiple PNGs → multi-page PDF. Each image becomes one or more pages
 * (vertically split if taller than the page).
 */
export function pngDataUrlsToMultiPagePdfBase64(dataUrls: string[]): string {
  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "pt",
    format: "a4",
  });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 12;
  const maxW = pageW - margin * 2;
  const usableH = pageH - margin * 2;

  let first = true;
  for (const dataUrl of dataUrls) {
    const props = pdf.getImageProperties(dataUrl);
    const scale = maxW / props.width;
    const scaledW = maxW;
    const scaledH = props.height * scale;

    let offsetY = 0;
    while (offsetY < scaledH - 0.5) {
      if (!first) pdf.addPage();
      first = false;
      // Negative y draws the portion of the tall image for this page
      const y = margin - offsetY;
      pdf.addImage(dataUrl, "PNG", margin, y, scaledW, scaledH);
      offsetY += usableH;
    }
  }

  return dataUrlToBase64(pdf.output("datauristring"));
}

export async function savePngOrPdf(
  path: string,
  pngDataUrl: string,
  format: GraphExportFormat,
): Promise<void> {
  if (format === "png") {
    await writeExportFile(path, pngDataUrl);
  } else {
    await writeExportFile(path, pngDataUrlToPdfBase64(pngDataUrl));
  }
}

export function waitFrames(n = 2): Promise<void> {
  return new Promise((resolve) => {
    const step = (left: number) => {
      if (left <= 0) {
        window.setTimeout(resolve, 40);
        return;
      }
      requestAnimationFrame(() => step(left - 1));
    };
    step(n);
  });
}

export function defaultExportBasename(prefix: string): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `${prefix}-${stamp}`;
}
