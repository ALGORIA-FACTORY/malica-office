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

import { Check, ImageUp } from "lucide-react";
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

  /**
   * Le verdict de cadrage, en un mot et une couleur.
   *
   * Il ne décore pas : il vient de `analyzeFrame`, qui mesure les quatre
   * coins, la netteté et la part de l'image occupée. Vert veut dire que la
   * prise sera acceptée ; ambre dit exactement ce qui manque. Un voyant vert
   * permanent serait pire que pas de voyant du tout — il ferait prendre des
   * photos que le produit refuse ensuite.
   */
  const verdict = camError
    ? { texte: t("scan.hint.nocam"), bon: false }
    : analysis?.blank && pages.length > 0
      ? { texte: t("scan.hint.blank"), bon: false }
      : analysis?.reason === "no_document"
        ? { texte: t("scan.hint.searching"), bon: false }
        : analysis?.reason === "too_small"
          ? { texte: t("scan.hint.closer"), bon: false }
          : analysis?.reason === "blurry"
            ? { texte: t("scan.hint.blurry"), bon: false }
            : analysis?.ok
              ? { texte: t("scan.verdict.ok"), bon: true }
              : { texte: t("scan.hint.searching"), bon: false };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-[#0A0A0A] text-[#FAFAFA]">
      <video
        ref={videoRef}
        playsInline
        muted
        className="absolute inset-0 h-full w-full object-cover"
        aria-label={t("scan.title")}
      />
      <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />

      {/*
       * Le cadre et ses quatre équerres. Ils ne rognent rien — c'est le
       * module de capacité qui détecte les coins réels et redresse. Ils
       * disent où poser le document pour que la détection aboutisse.
       */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-12 inset-y-[110px] border border-[#FAFAFA]/[0.22]"
      >
        <span className="absolute -start-px -top-px h-[26px] w-[26px] border-s-2 border-t-2 border-[#FAFAFA]" />
        <span className="absolute -end-px -top-px h-[26px] w-[26px] border-e-2 border-t-2 border-[#FAFAFA]" />
        <span className="absolute -bottom-px -start-px h-[26px] w-[26px] border-b-2 border-s-2 border-[#FAFAFA]" />
        <span className="absolute -bottom-px -end-px h-[26px] w-[26px] border-b-2 border-e-2 border-[#FAFAFA]" />
        <span className="rg-scan absolute inset-x-0 top-0 h-px bg-[#FAFAFA]" />
      </div>

      {/* Le verdict, au-dessus du cadre. */}
      <div className="absolute inset-x-0 top-[58px] flex justify-center px-4">
        <span
          aria-live="polite"
          className={
            verdict.bon
              ? "inline-flex items-center gap-2 bg-[#15331E] px-[13px] py-2 text-[13px] font-medium text-[#7EC492]"
              : "inline-flex items-center gap-2 bg-[#33260F] px-[13px] py-2 text-[13px] font-medium text-[#E3B75C]"
          }
        >
          <span aria-hidden className="h-[5px] w-[5px] bg-current" />
          {verdict.texte}
        </span>
      </div>

      {camError ? (
        <div className="absolute inset-0 grid place-items-center p-6 text-center">
          <div className="border border-[#3A3A3C] bg-[#161618] p-5">
            <p className="text-sm">{t("scan.hint.nocam")}</p>
            <button
              type="button"
              onClick={onFallback}
              className="mt-4 inline-flex items-center gap-2 border border-[#FAFAFA] bg-[#FAFAFA] px-4 py-2 text-xs uppercase tracking-wide text-[#0A0A0A]"
            >
              <ImageUp className="h-4 w-4" aria-hidden />
              {t("scan.fallback")}
            </button>
          </div>
        </div>
      ) : null}

      <p className="absolute inset-x-6 bottom-[154px] text-center text-[13.5px] leading-[1.5] text-[#9A9AA0]">
        {t("scan.pose.1")}
        <br />
        {t("scan.pose.2")}
      </p>

      {/* Le refus d'une prise, avec son motif. Jamais un échec muet. */}
      {rejected ? (
        <p
          role="alert"
          className="absolute inset-x-6 bottom-[118px] text-center text-[12.5px] text-[#E08163]"
        >
          {rejected === "blurry" ? t("scan.reject.blurry") : t("scan.reject.frame")}
        </p>
      ) : null}

      <div className="absolute inset-x-0 bottom-10 flex items-center justify-center">
        <button
          type="button"
          onClick={() => void capture()}
          disabled={!!camError}
          aria-label={t("scan.capture")}
          className="grid h-[74px] w-[74px] place-items-center border border-[#3A3A3C] bg-[#FAFAFA] active:bg-[#C7C7CC] disabled:opacity-40"
        >
          <span aria-hidden className="h-[52px] w-[52px] border-2 border-[#0A0A0A]" />
        </button>
      </div>

      <button
        type="button"
        onClick={onCancel}
        className="absolute bottom-[60px] start-6 text-[14px] font-medium text-[#C7C7CC]"
      >
        {t("common.cancel")}
      </button>

      {/*
       * Le multipage reste, discrètement : une facture de deux pages n'est
       * pas un cas rare, et le prototype ne le montre pas parce qu'il ne
       * montre qu'une prise. Le bouton n'apparaît qu'une fois une page prise.
       */}
      {pages.length > 0 ? (
        <button
          type="button"
          onClick={() => onDone(pages)}
          className="absolute bottom-[60px] end-6 flex items-center gap-2 text-[14px] font-medium text-[#FAFAFA]"
        >
          <Check className="h-4 w-4" aria-hidden />
          {t("scan.finish")} · {pages.length}
        </button>
      ) : null}

      {autoClosed ? (
        <p className="absolute inset-x-6 bottom-[196px] text-center text-[11px] text-[#9A9AA0]">
          {t("scan.autoclosed")}
        </p>
      ) : null}
    </div>
  );
}
