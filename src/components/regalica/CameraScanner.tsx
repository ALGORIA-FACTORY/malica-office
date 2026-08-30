/**
 * Numériseur mobile — guides de contour en temps réel.
 *
 * L'écran ne fait que montrer : toute la géométrie vient du module de capacité
 * `scanner`. Le contour détecté est tracé sur la prévisualisation à chaque
 * trame, la netteté et le cadrage sont mesurés en continu, et la prise de vue
 * n'est proposée que lorsque la page est nette et suffisamment grande. Une
 * photo floue ou mal cadrée est refusée avec son motif — jamais numérisée en
 * silence. Une page vierge ferme automatiquement le document.
 */

import { Camera, Check, ImageUp, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { analyzeFrame, type FrameAnalysis } from "@/capabilities/scanner";
import { useI18n } from "@/i18n";

const ANALYSIS_SIDE = 480;

export interface CameraScannerProps {
  /** Reçoit les pages retenues, dans l'ordre de prise de vue. */
  onDone: (pages: Blob[]) => void;
  onCancel: () => void;
  /** Repli lorsque la caméra est indisponible : import d'un fichier. */
  onFallback: () => void;
}

export function CameraScanner({ onDone, onCancel, onFallback }: CameraScannerProps) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const workRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analysisRef = useRef<FrameAnalysis | null>(null);
  const [pages, setPages] = useState<Blob[]>([]);
  const [analysis, setAnalysis] = useState<FrameAnalysis | null>(null);
  const [rejected, setRejected] = useState<FrameAnalysis["reason"] | null>(null);
  const [autoClosed, setAutoClosed] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);

  // ---- flux caméra
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
      } catch (e) {
        setCamError(e instanceof Error ? e.message : "caméra indisponible");
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    };
  }, []);

  // ---- analyse continue + tracé des guides
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      const video = videoRef.current;
      const overlay = overlayRef.current;
      if (!video || !overlay || video.readyState < 2) return;
      if (ts - last < 180) return; // ~5 analyses par seconde : fluide et sobre
      last = ts;

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return;
      const scale = Math.min(1, ANALYSIS_SIDE / Math.max(vw, vh));
      const aw = Math.max(1, Math.round(vw * scale));
      const ah = Math.max(1, Math.round(vh * scale));
      const work = (workRef.current ??= document.createElement("canvas"));
      work.width = aw;
      work.height = ah;
      const wg = work.getContext("2d", { willReadFrequently: true });
      if (!wg) return;
      wg.drawImage(video, 0, 0, aw, ah);
      const result = analyzeFrame(wg.getImageData(0, 0, aw, ah));
      analysisRef.current = result;
      setAnalysis(result);

      const rect = video.getBoundingClientRect();
      overlay.width = Math.max(1, Math.round(rect.width));
      overlay.height = Math.max(1, Math.round(rect.height));
      const g = overlay.getContext("2d");
      if (!g) return;
      g.clearRect(0, 0, overlay.width, overlay.height);
      // La prévisualisation est en `object-cover` : même facteur sur les deux axes.
      const cover = Math.max(overlay.width / vw, overlay.height / vh);
      const offX = (overlay.width - vw * cover) / 2;
      const offY = (overlay.height - vh * cover) / 2;
      const k = cover / scale;
      if (result.quad) {
        g.lineWidth = 2;
        g.strokeStyle = result.ok ? "#111111" : "#8a8a8a";
        g.setLineDash(result.ok ? [] : [6, 5]);
        g.beginPath();
        result.quad.forEach((p, i) => {
          const x = offX + p.x * k;
          const y = offY + p.y * k;
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        });
        g.closePath();
        g.stroke();
        if (result.ok) {
          g.fillStyle = "rgba(255,255,255,0.10)";
          g.fill();
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const grabFrame = useCallback(async (): Promise<Blob | null> => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    const c = document.createElement("canvas");
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    const g = c.getContext("2d");
    if (!g) return null;
    g.drawImage(video, 0, 0);
    return await new Promise<Blob | null>((resolve) =>
      c.toBlob((b) => resolve(b), "image/jpeg", 0.95),
    );
  }, []);

  const capture = useCallback(async () => {
    const current = analysisRef.current;
    if (!current) return;
    if (current.blank && pages.length > 0) {
      // Fin de document détectée : la page vierge n'est pas conservée.
      setAutoClosed(true);
      onDone(pages);
      return;
    }
    if (!current.ok) {
      setRejected(current.reason);
      return;
    }
    const blob = await grabFrame();
    if (!blob) return;
    setRejected(null);
    setPages((p) => [...p, blob]);
  }, [grabFrame, onDone, pages]);

  const hint = camError
    ? t("scan.hint.nocam")
    : analysis?.blank && pages.length > 0
      ? t("scan.hint.blank")
      : analysis?.reason === "no_document"
        ? t("scan.hint.searching")
        : analysis?.reason === "too_small"
          ? t("scan.hint.closer")
          : analysis?.reason === "blurry"
            ? t("scan.hint.blurry")
            : t("scan.hint.ready");

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          {t("scan.title")}
        </p>
        <button
          type="button"
          onClick={onCancel}
          aria-label={t("common.cancel")}
          className="grid h-9 w-9 place-items-center border border-border"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </header>

      <div className="relative flex-1 overflow-hidden bg-muted">
        <video
          ref={videoRef}
          playsInline
          muted
          className="h-full w-full object-cover"
          aria-label={t("scan.title")}
        />
        <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />
        {camError ? (
          <div className="absolute inset-0 grid place-items-center p-6 text-center">
            <div className="border border-border bg-card p-5">
              <p className="text-sm">{t("scan.hint.nocam")}</p>
              <button
                type="button"
                onClick={onFallback}
                className="mt-4 inline-flex items-center gap-2 border border-foreground bg-foreground px-4 py-2 text-xs uppercase tracking-wide text-background"
              >
                <ImageUp className="h-4 w-4" aria-hidden />
                {t("scan.fallback")}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="border-t border-border px-4 py-3">
        <p aria-live="polite" className="min-h-[2.5rem] text-sm">
          {hint}
          {rejected ? (
            <span className="ms-1 text-muted-foreground">
              {rejected === "blurry" ? t("scan.reject.blurry") : t("scan.reject.frame")}
            </span>
          ) : null}
        </p>
        <p className="mt-1 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
          {t("scan.pages", { count: String(pages.length) })}
          {analysis
            ? ` · ${t("scan.metrics", {
                sharp: analysis.sharpness.toFixed(4),
                coverage: `${Math.round(analysis.coverage * 100)}%`,
              })}`
            : null}
        </p>
        <div className="mt-3 grid grid-cols-3 items-center gap-3">
          <button
            type="button"
            onClick={onFallback}
            className="flex h-12 items-center justify-center gap-2 border border-border px-3 text-[11px] uppercase tracking-wide"
          >
            <ImageUp className="h-4 w-4" aria-hidden />
            {t("scan.fallback")}
          </button>
          <button
            type="button"
            onClick={() => void capture()}
            disabled={!!camError}
            aria-label={t("scan.capture")}
            className="mx-auto grid h-16 w-16 place-items-center border border-foreground bg-foreground text-background disabled:opacity-40"
          >
            <Camera className="h-6 w-6" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => onDone(pages)}
            disabled={pages.length === 0}
            className="flex h-12 items-center justify-center gap-2 border border-foreground px-3 text-[11px] uppercase tracking-wide disabled:opacity-40"
          >
            <Check className="h-4 w-4" aria-hidden />
            {t("scan.finish")}
          </button>
        </div>
        {autoClosed ? (
          <p className="mt-2 text-[11px] text-muted-foreground">{t("scan.autoclosed")}</p>
        ) : null}
      </div>
    </div>
  );
}
