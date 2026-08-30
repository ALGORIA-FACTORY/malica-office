/**
 * Visionneuse de pièce — PDF rendu page par page, zone source surlignée.
 *
 * Les pièces sont stockées en PDF (une photo est cadrée puis encodée en PDF à
 * la capture). Les pièces images antérieures restent affichables. La zone
 * citée est surlignée, amenée à l'écran ET agrandie dans une loupe : sur un
 * téléphone, un cadre de 3 mm ne montre rien. La loupe est un recadrage exact
 * du rendu, pas une approximation.
 */

import { useEffect, useRef, useState } from "react";

import type { Citation } from "@/verticals/regalica-office/ports/repositories";

interface Props {
  fileUrl: string;
  highlight: Citation | null;
  label: string;
  loadingLabel: string;
  errorLabel: string;
}

const RENDER_WIDTH = 1400;
/** Marge autour de la zone citée, en fraction de la largeur de page. */
const PAD_X = 0.06;
const PAD_Y = 0.02;

export function DocumentView({ fileUrl, highlight, label, loadingLabel, errorLabel }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const zoomRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const markRef = useRef<HTMLSpanElement | null>(null);
  const [state, setState] = useState<"loading" | "pdf" | "image" | "error">("loading");
  const [pageCount, setPageCount] = useState(1);
  const [page, setPage] = useState(1);
  const [rendered, setRendered] = useState(0);

  // La page citée prime : une citation en page 3 ouvre la page 3.
  useEffect(() => {
    if (highlight && highlight.page >= 1) setPage(highlight.page);
  }, [highlight]);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    (async () => {
      try {
        const res = await fetch(fileUrl);
        if (!res.ok) throw new Error(String(res.status));
        const buf = await res.arrayBuffer();
        const head = new Uint8Array(buf.slice(0, 5));
        const isPdf = String.fromCharCode(...head) === "%PDF-";
        if (cancelled) return;
        if (!isPdf) {
          setState("image");
          return;
        }
        const pdfjs = await import("pdfjs-dist");
        const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
        if (cancelled) {
          void doc.cleanup();
          return;
        }
        setPageCount(doc.numPages);
        const target = Math.min(Math.max(page, 1), doc.numPages);
        const pdfPage = await doc.getPage(target);
        const base = pdfPage.getViewport({ scale: 1 });
        const viewport = pdfPage.getViewport({ scale: RENDER_WIDTH / base.width });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("canvas");
        await pdfPage.render({ canvas, canvasContext: context, viewport }).promise;
        if (cancelled) return;
        setState("pdf");
        setRendered((n) => n + 1);
        cleanup = () => void doc.cleanup();
      } catch {
        if (!cancelled) setState("error");
      }
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [fileUrl, page]);

  // Amener la zone citée à l'écran : sans cela, le surlignage reste invisible
  // sur mobile, où le document est au-dessus des champs.
  useEffect(() => {
    if (!highlight) return;
    const mark = markRef.current;
    const wrap = wrapRef.current;
    if (!mark || !wrap) return;
    wrap.scrollIntoView({ behavior: "smooth", block: "center" });
    const timer = window.setTimeout(() => {
      mark.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    }, 220);
    return () => window.clearTimeout(timer);
  }, [highlight, state, page]);

  // Loupe : recadrage pixel du rendu autour de la zone citée.
  useEffect(() => {
    const src = canvasRef.current;
    const dst = zoomRef.current;
    if (!highlight || !dst || state !== "pdf" || !src || !src.width) return;
    const b = highlight.bbox;
    const x0 = Math.max(0, (b.x0 - PAD_X) * src.width);
    const x1 = Math.min(src.width, (b.x1 + PAD_X) * src.width);
    const y0 = Math.max(0, (b.y0 - PAD_Y) * src.height);
    const y1 = Math.min(src.height, (b.y1 + PAD_Y) * src.height);
    const sw = Math.max(1, x1 - x0);
    const sh = Math.max(1, y1 - y0);
    const outW = 900;
    const outH = Math.max(80, Math.round((sh / sw) * outW));
    dst.width = outW;
    dst.height = outH;
    const ctx = dst.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, outW, outH);
    ctx.drawImage(src, x0, y0, sw, sh, 0, 0, outW, outH);
    // Encadrer exactement le token cité dans la loupe.
    const k = outW / sw;
    ctx.strokeStyle = "#b45309";
    ctx.lineWidth = 3;
    ctx.strokeRect(
      (b.x0 * src.width - x0) * k,
      (b.y0 * src.height - y0) * k,
      Math.max(6, (b.x1 - b.x0) * src.width * k),
      Math.max(6, (b.y1 - b.y0) * src.height * k),
    );
  }, [highlight, state, page, rendered]);

  const box = highlight
    ? {
        left: `${highlight.bbox.x0 * 100}%`,
        top: `${highlight.bbox.y0 * 100}%`,
        width: `${Math.max(highlight.bbox.x1 - highlight.bbox.x0, 0.012) * 100}%`,
        height: `${Math.max(highlight.bbox.y1 - highlight.bbox.y0, 0.012) * 100}%`,
      }
    : null;

  const imageZoom =
    highlight && state === "image"
      ? (() => {
          const b = highlight.bbox;
          const w = Math.max(b.x1 - b.x0 + PAD_X * 2, 0.08);
          const h = Math.max(b.y1 - b.y0 + PAD_Y * 2, 0.03);
          const cx = (b.x0 + b.x1) / 2;
          const cy = (b.y0 + b.y1) / 2;
          return {
            backgroundImage: `url(${fileUrl})`,
            backgroundSize: `${100 / w}% auto`,
            backgroundPosition: `${(cx * 100).toFixed(2)}% ${(cy * 100).toFixed(2)}%`,
            aspectRatio: `${w} / ${h}`,
          } as const;
        })()
      : null;

  return (
    <div ref={wrapRef} className="space-y-2">
      <div className="relative overflow-hidden border border-border bg-paper">
        {state === "image" ? (
          <img src={fileUrl} alt={label} className="block w-full" />
        ) : (
          <canvas ref={canvasRef} className="block w-full" aria-label={label} />
        )}
        {box ? (
          <span
            ref={markRef}
            className="pointer-events-none absolute border-2 border-signal-warn bg-signal-warn/10"
            style={box}
          />
        ) : null}
        {state === "loading" ? (
          <p className="p-4 text-xs text-muted-foreground">{loadingLabel}</p>
        ) : null}
        {state === "error" ? <p className="p-4 text-xs text-signal-warn">{errorLabel}</p> : null}
      </div>

      {highlight ? (
        <div className="border border-border bg-paper">
          {imageZoom ? (
            <div
              className="w-full bg-no-repeat"
              style={imageZoom}
              role="img"
              aria-label={`${label} — ${highlight.field}`}
            />
          ) : (
            <canvas
              ref={zoomRef}
              className="block w-full"
              aria-label={`${label} — ${highlight.field}`}
            />
          )}
        </div>
      ) : null}

      {pageCount > 1 ? (
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="min-h-[44px] border border-border px-3 text-xs uppercase tracking-wide disabled:opacity-40"
          >
            ‹
          </button>
          <span className="num text-xs text-muted-foreground">
            {page} / {pageCount}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            disabled={page >= pageCount}
            className="min-h-[44px] border border-border px-3 text-xs uppercase tracking-wide disabled:opacity-40"
          >
            ›
          </button>
        </div>
      ) : null}
    </div>
  );
}
