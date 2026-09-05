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

import { cadrer } from "@/capabilities/cadrage";
import { analyzeFrame, type FrameAnalysis } from "@/capabilities/scanner";
import { cleDuMotif, motifCamera, type MotifCamera } from "@/capabilities/camera";
import { useI18n, type MessageKey } from "@/i18n";
import { noterAuJournal } from "@/lib/journal-atelier";

const ANALYSIS_SIDE = 480;

/**
 * Analyses bonnes consécutives avant de prendre tout seul.
 *
 * Trois, à cinq analyses par seconde : un peu plus d'une demi-seconde
 * immobile. Moins déclencherait sur un passage fortuit ; plus donnerait
 * l'impression que rien ne se passe.
 */
const STABLE_POUR_PRENDRE = 3;

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

  /*
   * ============================================ LE FLUX SUIT L'ÉLÉMENT
   *
   * L'écran d'aperçu remplace toute la vue, `<video>` compris. Quand la vue
   * revient — « Reprendre », « Ajouter une page » — l'élément est NEUF, et
   * le flux, lui, est toujours là dans `streamRef`. Le poser une seule fois
   * au montage laissait ce second élément vide : caméra noire, prise
   * impossible. Cette ref le branche à chaque apparition.
   */
  const brancherVideo = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    const flux = streamRef.current;
    if (el && flux && el.srcObject !== flux) {
      el.srcObject = flux;
      void el.play().catch(() => undefined);
    }
  }, []);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const workRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analysisRef = useRef<FrameAnalysis | null>(null);
  /*
   * ==================================== CE QU'IL FAUT POUR PRENDRE TOUT SEUL
   *
   * L'analyse passe maintenant par un modèle : elle est asynchrone. Un garde
   * empêche deux analyses de se chevaucher, sinon une image lente ferait la
   * queue devant les suivantes et le voyant retarderait sur la réalité.
   *
   * `stable` compte les analyses bonnes consécutives ; `pris` empêche de
   * déclencher deux fois pendant qu'une prise est en cours. Ce sont des
   * références et non des états : la boucle les lit à chaque image, et un état
   * de React arriverait toujours avec une image de retard.
   */
  const analyseEnCoursRef = useRef(false);
  const stableRef = useRef(0);
  const prisRef = useRef(false);
  const captureRef = useRef<(() => Promise<void>) | null>(null);
  const [stable, setStable] = useState(0);
  /*
   * ============================================== L'APERÇU D'UNE PAGE PRISE
   *
   * `null` : on est devant la caméra. Sinon on montre la page qui vient d'être
   * prise, telle qu'elle sera lue — et l'on attend une décision : la garder,
   * ou la reprendre. Rien ne part au dossier tant que cette décision n'est pas
   * prise.
   */
  const [apercu, setApercu] = useState<{
    url: string | null;
    recadree: boolean;
    origine: string;
  } | null>(null);
  const [preparation, setPreparation] = useState(false);
  const [pages, setPages] = useState<Blob[]>([]);
  const [analysis, setAnalysis] = useState<FrameAnalysis | null>(null);
  // « attente » et « image » ne viennent pas de l'analyse : ce sont les deux
  // cas où l'obturateur rendait la main sans rien dire.
  const [rejected, setRejected] = useState<FrameAnalysis["reason"] | "attente" | "image" | null>(
    null,
  );
  const [autoClosed, setAutoClosed] = useState(false);
  /*
   * Une prise doit SE VOIR.
   *
   * L'obturateur ajoutait la page sans rien changer à l'écran : on appuyait,
   * l'image restait identique, et seul un petit lien texte apparaissait dans un
   * coin. Sur un téléphone, c'est indistinguable d'un bouton mort — « j'ai pris
   * la photo et rien ne se passe ».
   */
  const [eclair, setEclair] = useState(false);
  /*
   * Combien de fois le cadrage a refusé d'affilée.
   *
   * Le verdict conseille, il n'emprisonne pas : après deux refus, on propose de
   * prendre quand même. La personne voit son document ; nous ne voyons qu'une
   * mesure de contraste, et elle peut se tromper — un papier mat sous une
   * lumière rasante est jugé flou alors qu'il est net.
   */
  const [refusDeSuite, setRefusDeSuite] = useState(0);
  // Le MOTIF, pas un message. « Caméra indisponible sur cet appareil » était
  // faux dans le cas le plus fréquent : la page en HTTP, sur un téléphone qui
  // a très bien une caméra.
  const [camMotif, setCamMotif] = useState<MotifCamera | null>(null);

  // ---- flux caméra
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const securise = typeof window !== "undefined" && window.isSecureContext;
      const apiPresente =
        typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);

      // On n'appelle même pas : hors contexte sécurisé, le navigateur retire
      // l'interface, et l'erreur qui en sortirait ne dirait rien d'utile.
      if (!securise || !apiPresente) {
        setCamMotif(motifCamera(undefined, securise, apiPresente));
        return;
      }

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
        setCamMotif(motifCamera(e, securise, apiPresente));
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
      const petite = wg.getImageData(0, 0, aw, ah);

      /*
       * ============================== L'APERÇU JUGE AVEC LE DÉTECTEUR DE LA CAPTURE
       *
       * Avant, l'aperçu utilisait le détecteur maison et la capture le modèle
       * entraîné. Les deux ne voyaient pas la même scène : le voyant passait
       * au vert sur une photo que la capture allait rater, et restait ambre
       * sur une facture que le modèle trouvait parfaitement.
       *
       * Un voyant qui ment est pire que pas de voyant. On appelle donc ICI la
       * même cascade — modèle, puis algorithme, puis maison. Mesuré à 19 ms
       * une fois le modèle chargé : largement dans le budget d'une analyse
       * toutes les 180 ms.
       *
       * L'appel est asynchrone : un garde empêche deux analyses de se
       * chevaucher, sinon une image lente ferait la queue devant les suivantes.
       */
      if (analyseEnCoursRef.current) return;
      analyseEnCoursRef.current = true;
      void (async () => {
        try {
          const cadrage = await cadrer(petite);
          // La résolution VRAIE de la caméra, pas celle de la trame d'analyse :
          // c'est elle qui dit si le document sera lisible une fois pris.
          const result = analyzeFrame(petite, Math.max(vw, vh), cadrage.coins);
          analysisRef.current = result;
          setAnalysis(result);
          dessinerLeCadre(result);

          /*
           * ==================================== LE DÉCLENCHEMENT AUTOMATIQUE
           *
           * Un scanner qui attend qu'on appuie demande à l'utilisateur de
           * juger lui-même si le cadrage est bon — c'est précisément ce qu'il
           * ne sait pas faire, et la raison pour laquelle la tasse de café
           * finissait dans la photo.
           *
           * Trois analyses consécutives bonnes, soit un peu plus d'une demi-
           * seconde immobile, et l'on prend. L'écran l'annonce avant, pour que
           * la photo ne surprenne jamais.
           */
          if (result.ok) {
            stableRef.current += 1;
            setStable(stableRef.current);
            if (stableRef.current >= STABLE_POUR_PRENDRE && !prisRef.current) {
              prisRef.current = true;
              void captureRef.current?.();
            }
          } else {
            stableRef.current = 0;
            setStable(0);
          }
        } finally {
          analyseEnCoursRef.current = false;
        }
      })();
      return;
    };

    /** Le contour détecté, tracé sur la prévisualisation. */
    const dessinerLeCadre = (result: FrameAnalysis) => {
      const video = videoRef.current;
      const overlay = overlayRef.current;
      if (!video || !overlay) return;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return;
      const scale = Math.min(1, ANALYSIS_SIDE / Math.max(vw, vh));

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
    if (!video || !video.videoWidth) {
      // Rien à photographier : l'élément n'est pas là, ou il n'a pas de flux.
      // Aucune exception ne serait levée — c'est précisément pourquoi on le
      // note : une caméra noire ne se voit que depuis le téléphone.
      noterAuJournal(
        "components/regalica/CameraScanner (prise)",
        new Error(video ? "vidéo sans flux : videoWidth = 0" : "élément vidéo absent"),
      );
      return null;
    }
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

  /**
   * Prendre.
   *
   * @param malgreLeVerdict Passer outre un cadrage jugé insuffisant. C'est un
   * geste délibéré de la personne, jamais un défaut : elle voit son document.
   *
   * AUCUN chemin ne rend la main en silence. Un obturateur qui ne fait rien
   * sans rien dire est indistinguable d'un obturateur cassé — et c'est ce qui
   * s'est produit.
   */
  const capture = useCallback(
    async (malgreLeVerdict = false) => {
      const current = analysisRef.current;
      if (!current) {
        // L'analyse tourne cinq fois par seconde : ne pas l'avoir encore est
        // normal la première demi-seconde, mais il faut le dire.
        setRejected("attente");
        return;
      }
      if (current.blank && pages.length > 0) {
        // Fin de document détectée : la page vierge n'est pas conservée.
        setAutoClosed(true);
        onDone(pages);
        return;
      }
      if (!current.ok && !malgreLeVerdict) {
        setRejected(current.reason);
        setRefusDeSuite((n) => n + 1);
        return;
      }
      const blob = await grabFrame();
      if (!blob) {
        setRejected("image");
        return;
      }
      setRejected(null);
      setRefusDeSuite(0);
      setPages((p) => [...p, blob]);
      // L'éclair : la seule confirmation que le geste a porté.
      setEclair(true);
      setTimeout(() => setEclair(false), 220);

      /*
       * ================================== LA PAGE SE MONTRE AVANT D'ÊTRE GARDÉE
       *
       * L'écran enchaînait sur la caméra : la personne ne voyait jamais ce qui
       * avait été retenu. Elle photographiait un bureau, l'application gardait
       * un bureau, et cela ne se découvrait qu'au moment de la lecture.
       *
       * On prépare donc la page tout de suite — recadrée, redressée, nettoyée —
       * et on la montre. Ce qui s'affiche est EXACTEMENT ce qui sera lu, pas la
       * photo d'origine : un aperçu qui embellit serait pire que pas d'aperçu.
       */
      setPreparation(true);
      try {
        const { preparePage } = await import("@/capabilities/scanner");
        const page = await preparePage(blob);
        const octets = page.jpeg;
        let binaire = "";
        for (let i = 0; i < octets.length; i += 1) binaire += String.fromCharCode(octets[i]!);
        setApercu({
          url: `data:image/jpeg;base64,${btoa(binaire)}`,
          recadree: page.cropped,
          origine: page.cadrage.origine,
        });
      } catch {
        // La préparation a échoué : on garde la page quand même — la perdre
        // pour un aperçu manquant serait absurde — mais on le dit.
        setApercu({ url: null, recadree: false, origine: "aucune" });
      } finally {
        setPreparation(false);
      }

      /*
       * On repart de zéro APRÈS la prise, et pas avant.
       *
       * Sans cette remise, le compteur de stabilité resterait au-dessus du
       * seuil et la page suivante partirait dans la foulée — on photographierait
       * la même feuille en rafale. Le petit délai laisse le temps de déplacer
       * le document avant que la prise suivante puisse s'armer.
       */
      stableRef.current = 0;
      setStable(0);
      setTimeout(() => {
        prisRef.current = false;
      }, 900);
    },
    [grabFrame, onDone, pages],
  );

  // La boucle d'analyse déclenche la prise par cette référence : elle est
  // montée une fois, et ne peut donc pas capturer une version périmée.
  useEffect(() => {
    captureRef.current = () => capture();
  }, [capture]);

  /**
   * Le verdict de cadrage, en un mot et une couleur.
   *
   * Il ne décore pas : il vient de `analyzeFrame`, qui mesure les quatre
   * coins, la netteté et la part de l'image occupée. Vert veut dire que la
   * prise sera acceptée ; ambre dit exactement ce qui manque. Un voyant vert
   * permanent serait pire que pas de voyant du tout — il ferait prendre des
   * photos que le produit refuse ensuite.
   */
  const verdict = camMotif
    ? { texte: t(cleDuMotif(camMotif) as MessageKey), bon: false }
    : analysis?.blank && pages.length > 0
      ? { texte: t("scan.hint.blank"), bon: false }
      : analysis?.reason === "no_document"
        ? { texte: t("scan.hint.searching"), bon: false }
        : analysis?.reason === "too_small"
          ? { texte: t("scan.hint.closer"), bon: false }
          : analysis?.reason === "blurry"
            ? { texte: t("scan.hint.blurry"), bon: false }
            : analysis?.ok
              ? /*
                 * Quand c'est bon, l'écran ne dit plus « c'est bon » : il dit
                 * ce qui va se passer. « Ne bougez plus » demande un geste
                 * précis ; « cadrage correct » n'en demande aucun, et laisse
                 * l'utilisateur se demander s'il doit appuyer.
                 */
                { texte: t("scan.verdict.tenez"), bon: true }
              : { texte: t("scan.hint.searching"), bon: false };

  /** La prise automatique approche : 0, puis 1, puis 2 sur trois. */
  const compteARebours = analysis?.ok ? Math.min(stable, STABLE_POUR_PRENDRE) : 0;

  /*
   * ================================================== L'ÉCRAN DE REVUE
   *
   * « Lorsque je prends une photo, un aperçu direct apparaît, propre, où je
   * peux supprimer et reprendre ; si ça me paraît bon, je tape lire. »
   *
   * C'est exactement l'ordre ci-dessous. Il remplace l'ancien enchaînement,
   * qui gardait la page sans jamais la montrer — et laissait découvrir un
   * mauvais cadrage seulement à la lecture, une fois la pièce enregistrée.
   *
   * Trois gestes, et rien d'autre : reprendre, ajouter une page, lire.
   */
  if (apercu) {
    const derniere = pages.length;
    return (
      <div className="fixed inset-0 z-50 mx-auto flex w-full max-w-md flex-col bg-[#0A0A0A] text-[#FAFAFA]">
        <div className="flex items-center justify-between px-5 pb-3 pt-[18px]">
          <span className="text-[13px] font-medium text-[#C7C7CC]">
            {t("scan.apercu.page", { n: derniere })}
          </span>
          {/* Ce que le cadrage a fait, dit sans jargon. Une page non recadrée
              n'est pas une panne : c'est une information qui décide s'il faut
              reprendre la photo. */}
          <span className="text-[12px] text-[#C7C7CC]">
            {apercu.recadree ? t("scan.apercu.recadree") : t("scan.apercu.entiere")}
          </span>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center bg-[#161618] px-5">
          {apercu.url ? (
            <img
              src={apercu.url}
              alt={t("scan.apercu.alt")}
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <p className="px-6 text-center text-[13px] text-[#C7C7CC]">{t("scan.apercu.sans")}</p>
          )}
        </div>

        <div className="space-y-2 px-5 pb-8 pt-4">
          <button
            type="button"
            onClick={() => {
              setApercu(null);
              onDone(pages);
            }}
            className="h-[54px] w-full bg-[#FAFAFA] text-[16px] font-semibold text-[#0A0A0A]"
          >
            {t("scan.apercu.lire")}
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setApercu(null)}
              className="h-[48px] flex-1 border border-[#3A3A3C] text-[14px] font-medium"
            >
              {t("scan.apercu.ajouter")}
            </button>
            <button
              type="button"
              onClick={() => {
                // Reprendre : la page est ÉCARTÉE, pas gardée « au cas où ».
                setPages((p) => p.slice(0, -1));
                setApercu(null);
              }}
              className="h-[48px] flex-1 border border-[#3A3A3C] text-[14px] font-medium text-[#E3B75C]"
            >
              {t("scan.apercu.reprendre")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 mx-auto w-full max-w-md overflow-hidden bg-[#0A0A0A] text-[#FAFAFA]">
      {preparation ? (
        <div className="absolute inset-0 z-[60] grid place-items-center bg-[#0A0A0A]/80">
          <p className="text-[14px] font-medium">{t("scan.apercu.preparation")}</p>
        </div>
      ) : null}
      <video
        ref={brancherVideo}
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
          {/*
           * Trois points qui se remplissent : l'utilisateur VOIT que la photo
           * arrive, et combien de temps il lui reste à tenir. Sans ce signal,
           * une prise automatique est une surprise — et une surprise sur un
           * appareil photo donne envie d'appuyer par-dessus.
           */}
          {verdict.bon ? (
            <span aria-hidden className="ms-1 inline-flex items-center gap-[3px]">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className={
                    i < compteARebours
                      ? "h-[6px] w-[6px] rounded-full bg-current"
                      : "h-[6px] w-[6px] rounded-full border border-current opacity-50"
                  }
                />
              ))}
            </span>
          ) : null}
        </span>
      </div>

      {camMotif ? (
        <div className="absolute inset-0 grid place-items-center p-6 text-center">
          <div className="border border-[#3A3A3C] bg-[#161618] p-5">
            {/*
             * La vraie cause, et le geste qui va avec. Un cadrage assisté qui
             * manque n'empêche pas de photographier : l'appareil natif donne la
             * même photo, et la lecture qui suit est identique.
             */}
            <p className="text-sm leading-[1.5]">{t(cleDuMotif(camMotif) as MessageKey)}</p>
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
          {rejected === "blurry"
            ? t("scan.reject.blurry")
            : rejected === "attente"
              ? t("scan.reject.attente")
              : rejected === "image"
                ? t("scan.reject.image")
                : t("scan.reject.frame")}
        </p>
      ) : null}

      {/* L'éclair : bref, franc, et c'est tout ce qu'il faut pour que le
          geste se sente. */}
      {eclair ? (
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[#FAFAFA] opacity-70" />
      ) : null}

      {/*
       * L'issue.
       *
       * Le verdict conseille ; après deux refus d'affilée il cesse de décider
       * à la place de la personne. Elle voit son document — nous ne voyons
       * qu'une mesure, et un papier mat sous une lumière rasante est jugé flou
       * alors qu'il est net.
       */}
      {refusDeSuite >= 2 && !camMotif ? (
        <button
          type="button"
          onClick={() => void capture(true)}
          className="absolute inset-x-6 bottom-[150px] border border-[#FAFAFA] py-2.5 text-[13px] font-medium text-[#FAFAFA]"
        >
          {t("scan.malgreTout")}
        </button>
      ) : null}

      <div className="absolute inset-x-0 bottom-10 flex items-center justify-center">
        <button
          type="button"
          onClick={() => void capture()}
          disabled={!!camMotif}
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
      {/*
       * « Terminer » était un lien texte, du même poids que « Annuler ». C'est
       * pourtant lui qui achève la tâche : une page prise et non validée est
       * une photo perdue. Il devient un bouton plein, impossible à manquer.
       */}
      {pages.length > 0 ? (
        <button
          type="button"
          onClick={() => onDone(pages)}
          className="absolute bottom-[54px] end-6 flex items-center gap-2 bg-[#FAFAFA] px-4 py-2.5 text-[14px] font-semibold text-[#0A0A0A]"
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
