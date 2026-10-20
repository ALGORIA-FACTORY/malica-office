/**
 * Visionneuse de pièce — le document tel qu'il est, pas une vignette.
 *
 * ===================================================== POURQUOI ELLE EXISTE
 *
 * C'est l'écran le plus regardé du produit. Un expert-comptable passe sa
 * journée à comparer une pièce et une écriture ; s'il ne peut pas lire un
 * matricule fiscal imprimé petit, ou redresser un scan de travers, il ouvre le
 * PDF ailleurs — et la citation, le surlignage, tout le travail du Socle reste
 * sur l'écran qu'il vient de quitter.
 *
 * D'où : zoom réel, rotation, ajustement, clavier, et la zone citée qui
 * survit aux trois.
 *
 * ============================================== LE DÉFAUT QUI L'A FAIT NAÎTRE
 *
 * « Document illisible » s'affichait un affichage sur deux. La cause n'était
 * pas le PDF : `getDocument({ data })` TRANSFÈRE le tampon au worker, ce qui le
 * DÉTACHE. React Query, lui, garde le même `ArrayBuffer` en cache pour la
 * pièce. Le premier rendu marchait ; tout retour sur la pièce recevait un
 * tampon vide, et la visionneuse concluait que le fichier était corrompu.
 *
 * On ne donne donc jamais les octets du cache : on en donne une copie. Un
 * mégaoctet copié vaut mieux qu'un cache qu'on vide sans le dire.
 *
 * ===================================================== CE QU'ELLE NE FAIT PAS
 *
 * Elle ne recharge pas le document à chaque page. Le `PDFDocumentProxy` vit
 * dans une référence : changer de page, zoomer ou tourner ne fait qu'un
 * nouveau rendu. La version précédente reparsait tout le fichier à chaque
 * geste.
 */

import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "@/i18n";
import { noterAuJournal } from "@/lib/journal-atelier";
import { cn } from "@/lib/utils";
import type { Citation } from "@malica/socle/ports/repositories";

interface Props {
  /** Les octets de la pièce. On ne les consomme jamais : on les copie. */
  contenu: ArrayBuffer;
  highlight: Citation | null;
  label: string;
}

/** Les paliers de zoom. Au-delà de 4×, un scan à 200 ppp ne montre plus rien. */
const PALIERS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

/** Marge autour de la zone citée, en fraction de la page. */
const PAD_X = 0.06;
const PAD_Y = 0.02;

type Ajustement = "largeur" | "page" | null;
type Rotation = 0 | 90 | 180 | 270;

/**
 * La zone citée, tournée avec la page.
 *
 * Les coordonnées d'une citation sont des fractions de la page NON tournée —
 * c'est le lecteur qui les a produites. Tourner l'affichage sans les tourner
 * ferait pointer le surlignage à côté, et l'expert conclurait que la citation
 * est fausse.
 */
function tourner(bbox: Citation["bbox"], rotation: Rotation) {
  const vu = (x: number, y: number): [number, number] => {
    if (rotation === 90) return [1 - y, x];
    if (rotation === 180) return [1 - x, 1 - y];
    if (rotation === 270) return [y, 1 - x];
    return [x, y];
  };
  const a = vu(bbox.x0, bbox.y0);
  const b = vu(bbox.x1, bbox.y1);
  return {
    x0: Math.min(a[0], b[0]),
    y0: Math.min(a[1], b[1]),
    x1: Math.max(a[0], b[0]),
    y1: Math.max(a[1], b[1]),
  };
}

export function DocumentView({ contenu, highlight, label }: Props) {
  const { t } = useI18n();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const loupeRef = useRef<HTMLCanvasElement | null>(null);
  const cadreRef = useRef<HTMLDivElement | null>(null);
  const marqueRef = useRef<HTMLSpanElement | null>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const tacheRef = useRef<RenderTask | null>(null);
  /** La largeur du cadre au dernier rendu réussi — l'observateur s'y compare. */
  const largeurRenduRef = useRef(0);

  /*
   * « natif » : le lecteur intégré a renoncé, celui du navigateur prend le
   * relais. Voir le bloc de secours plus bas — c'est ce qui évite d'annoncer
   * un document illisible alors qu'il est parfaitement lisible.
   */
  const [etat, setEtat] = useState<"chargement" | "pdf" | "image" | "natif" | "erreur">(
    "chargement",
  );
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [echelle, setEchelle] = useState(1);
  const [ajustement, setAjustement] = useState<Ajustement>("largeur");
  const [rotation, setRotation] = useState<Rotation>(0);
  const [rendus, setRendus] = useState(0);
  const [essai, setEssai] = useState(0);

  // Une image ne s'affiche pas depuis un tampon : il lui faut une URL. Celle-ci
  // est locale au navigateur et meurt avec le composant — contrairement à une
  // URL signée, qui circule.
  const urlLocale = useMemo(() => URL.createObjectURL(new Blob([contenu])), [contenu]);
  useEffect(() => () => URL.revokeObjectURL(urlLocale), [urlLocale]);

  // La page citée prime : une citation en page 3 ouvre la page 3.
  useEffect(() => {
    if (highlight && highlight.page >= 1) setPage(highlight.page);
  }, [highlight]);

  // ------------------------------------------------------ ouvrir le document
  useEffect(() => {
    let annule = false;
    let chargement: PDFDocumentLoadingTask | null = null;

    void (async () => {
      setEtat("chargement");
      try {
        const entete = new Uint8Array(contenu.slice(0, 5));
        if (entete.length === 0) {
          setEtat("erreur");
          return;
        }
        if (String.fromCharCode(...entete) !== "%PDF-") {
          if (!annule) setEtat("image");
          return;
        }

        /*
         * =========================================== LA CONSTRUCTION « LEGACY »
         *
         * 20 octobre 2026, recette : l'aperçu était VIDE sur des navigateurs à
         * jour de quelques mois (Chromium 141). pdf.js 6 appelle
         * `Map.prototype.getOrInsertComputed`, une méthode que ces moteurs
         * n'ont pas encore. La construction `legacy` de pdf.js embarque ses
         * compléments de compatibilité, pour la bibliothèque ET pour le worker :
         * on prend les deux, sinon le worker plante seul et en silence.
         */
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        /*
         * ============================ « Cannot transfer object of unsupported type »
         *
         * Ce message, que l'utilisateur a vu tel quel sur son téléphone, ne
         * vient pas du document : il vient du repli de pdf.js.
         *
         * On lui donnait l'ADRESSE du fichier du worker (`?url`). pdf.js
         * ouvrait alors lui-même un worker, en devinant s'il fallait un worker
         * classique ou un module — et il devinait mal : le fichier de pdf.js
         * est un module ES. Le worker mourait à sa première ligne, pdf.js
         * basculait sans rien dire sur son « faux worker », qui fait passer les
         * images par un canal incapable de transférer un tampon. D'où ce
         * message, en anglais, au milieu d'un écran français.
         *
         * On ne lui donne plus une adresse mais le worker LUI-MÊME, construit
         * par Vite avec le bon type. Il n'y a plus rien à deviner, donc plus de
         * repli possible — ni en développement, ni dans le paquet livré.
         *
         * `workerPort` prime sur `workerSrc` : il n'en reste qu'un chemin.
         */
        const { default: PdfWorker } =
          await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker");
        pdfjs.GlobalWorkerOptions.workerPort ??= new PdfWorker();

        // La copie, et la raison d'être du commentaire d'en-tête : `contenu`
        // appartient au cache, pdf.js détacherait l'original.
        chargement = pdfjs.getDocument({ data: new Uint8Array(contenu.slice(0)) });
        const doc = await chargement.promise;
        if (annule) return;
        docRef.current = doc;
        setPages(doc.numPages);
        setPage((p) => Math.min(Math.max(p, 1), doc.numPages));
        setEtat("pdf");
      } catch (raison) {
        if (annule) return;
        // La trace part au journal de l atelier : sans elle, on ne saurait
        // jamais POURQUOI le lecteur integre a renonce sur cet appareil-la.
        noterAuJournal("visionneuse : ouverture", raison);
        /*
         * ================================================ POURQUOI PAS UNE ERREUR
         *
         * Les octets commencent par « %PDF- » : le document EST un PDF. Si le
         * lecteur intégré échoue, ce n'est pas la pièce qui est en cause, c'est
         * lui — le plus souvent parce que son processus de rendu n'a pas pu
         * démarrer sur cet appareil, et qu'il se rabat alors sur un canal
         * interne incapable de transporter l'image.
         *
         * Annoncer « document illisible » serait faux, et afficher le message
         * de la bibliothèque l'était doublement : c'est du jargon anglais que
         * l'utilisateur a vu tel quel à l'écran. Le navigateur sait ouvrir un
         * PDF ; on lui passe la main sans rien dire de tout cela.
         */
        setEtat("natif");
      }
    })();

    return () => {
      annule = true;
      tacheRef.current?.cancel();
      tacheRef.current = null;
      docRef.current = null;
      void chargement?.destroy();
    };
  }, [contenu, essai]);

  // ----------------------------------------------------------- rendre la page
  //
  // On peint À CÔTÉ, puis on recopie.
  //
  // La première version peignait directement dans le canevas visible. Or
  // fixer `canvas.width` EFFACE le canevas : à chaque rendu la page
  // disparaissait avant de revenir. Et comme un rendu annulé ne repeint
  // jamais, il suffisait d'une annulation — l'apparition d'une barre de
  // défilement changeait la largeur du cadre, l'observateur relançait, et le
  // rendu en cours mourait — pour laisser une page blanche définitive.
  //
  // Un tampon hors écran coûte une copie. La page à l'écran, elle, n'est
  // jamais effacée avant d'avoir son remplacement.
  const rendre = useCallback(async () => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    const cadre = cadreRef.current;
    if (!doc || !canvas || !cadre) return;

    // Un rendu déjà en cours sur le même tampon fait échouer les deux :
    // pdf.js le dit explicitement.
    tacheRef.current?.cancel();

    const pdfPage = await doc.getPage(Math.min(Math.max(page, 1), doc.numPages));
    const nature = pdfPage.getViewport({ scale: 1, rotation });

    // L'ajustement se calcule sur la largeur RÉELLE du cadre, pas sur une
    // constante : les 1400 px d'avant étaient flous sur un écran 4K et
    // gaspillés sur un téléphone. On retire la place d'une barre de
    // défilement, faute de quoi le rendu la fait apparaître, ce qui rétrécit
    // le cadre, ce qui relance le rendu.
    const dispo = Math.max(120, (cadre.clientWidth || 800) - 2);
    const facteur =
      ajustement === "largeur"
        ? dispo / nature.width
        : ajustement === "page"
          ? Math.min(dispo / nature.width, (window.innerHeight * 0.66) / nature.height)
          : echelle;

    const vue = pdfPage.getViewport({ scale: facteur, rotation });
    // Le rapport de pixels rend le texte net là où l'écran l'est vraiment.
    const densite = Math.min(window.devicePixelRatio || 1, 2);
    const largeur = Math.round(vue.width * densite);
    const hauteur = Math.round(vue.height * densite);

    const tampon = document.createElement("canvas");
    tampon.width = largeur;
    tampon.height = hauteur;
    const contexte = tampon.getContext("2d");
    if (!contexte) return;
    contexte.setTransform(densite, 0, 0, densite, 0, 0);

    const tache = pdfPage.render({ canvas: tampon, canvasContext: contexte, viewport: vue });
    tacheRef.current = tache;
    try {
      await tache.promise;
      // Le canevas visible ne change qu'ici, une fois la page prête.
      canvas.width = largeur;
      canvas.height = hauteur;
      canvas.style.width = `${Math.round(vue.width)}px`;
      canvas.style.height = `${Math.round(vue.height)}px`;
      canvas.getContext("2d")?.drawImage(tampon, 0, 0);
      largeurRenduRef.current = cadre.clientWidth;
      setRendus((n) => n + 1);
      if (ajustement) setEchelle(facteur);
    } catch (e) {
      // Une annulation n'est pas une panne : c'est le geste suivant.
      if ((e as { name?: string }).name !== "RenderingCancelledException") {
        noterAuJournal("visionneuse : rendu de page", e);
        // Le rendu d une page a echoue : le lecteur du navigateur, pas un
        // message d erreur emprunte a la bibliotheque.
        setEtat("natif");
      }
    }
  }, [page, echelle, ajustement, rotation]);

  useEffect(() => {
    if (etat !== "pdf") return;
    void rendre();
  }, [etat, rendre]);

  // Le cadre change de largeur — panneau de Malica ouvert ou fermé, téléphone
  // tourné. Un ajustement qui ne suit pas n'ajuste rien.
  useEffect(() => {
    if (etat !== "pdf" || !ajustement) return;
    const cadre = cadreRef.current;
    if (!cadre || typeof ResizeObserver === "undefined") return;
    const observateur = new ResizeObserver(() => {
      // Le seuil dépasse la largeur d'une barre de défilement : sans cela,
      // son apparition relance un rendu qui la fait disparaître, et ainsi de
      // suite. On se compare au dernier rendu RÉUSSI, pas à une largeur notée
      // par l'observateur, qui dériverait à chaque annulation.
      if (Math.abs(cadre.clientWidth - largeurRenduRef.current) < 24) return;
      void rendre();
    });
    observateur.observe(cadre);
    return () => observateur.disconnect();
  }, [etat, ajustement, rendre]);

  // ------------------------------------------- amener la zone citée à l'écran
  useEffect(() => {
    if (!highlight) return;
    const marque = marqueRef.current;
    if (!marque) return;
    const minuteur = window.setTimeout(() => {
      marque.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    }, 120);
    return () => window.clearTimeout(minuteur);
  }, [highlight, etat, page, rendus]);

  // ------------------------------------------------------------------- loupe
  useEffect(() => {
    const source = canvasRef.current;
    const cible = loupeRef.current;
    if (!highlight || !cible || etat !== "pdf" || !source || !source.width) return;
    const b = tourner(highlight.bbox, rotation);
    const x0 = Math.max(0, (b.x0 - PAD_X) * source.width);
    const x1 = Math.min(source.width, (b.x1 + PAD_X) * source.width);
    const y0 = Math.max(0, (b.y0 - PAD_Y) * source.height);
    const y1 = Math.min(source.height, (b.y1 + PAD_Y) * source.height);
    const sw = Math.max(1, x1 - x0);
    const sh = Math.max(1, y1 - y0);
    const largeur = 900;
    const hauteur = Math.max(80, Math.round((sh / sw) * largeur));
    cible.width = largeur;
    cible.height = hauteur;
    const ctx = cible.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, largeur, hauteur);
    ctx.drawImage(source, x0, y0, sw, sh, 0, 0, largeur, hauteur);
    const k = largeur / sw;
    ctx.strokeStyle = "#b45309";
    ctx.lineWidth = 3;
    ctx.strokeRect(
      (b.x0 * source.width - x0) * k,
      (b.y0 * source.height - y0) * k,
      Math.max(6, (b.x1 - b.x0) * source.width * k),
      Math.max(6, (b.y1 - b.y0) * source.height * k),
    );
  }, [highlight, etat, page, rotation, rendus]);

  // ------------------------------------------------------------------ gestes
  const zoomer = useCallback((sens: 1 | -1) => {
    setAjustement(null);
    setEchelle((actuelle) => {
      if (sens > 0) return PALIERS.find((p) => p > actuelle + 0.01) ?? actuelle;
      const dessous = PALIERS.filter((p) => p < actuelle - 0.01);
      return dessous[dessous.length - 1] ?? actuelle;
    });
  }, []);

  const allerA = useCallback(
    (n: number) => setPage((p) => (n >= 1 && n <= pages ? n : p)),
    [pages],
  );

  // Le clavier n'est pas un supplément : on compare des dizaines de pièces par
  // jour, et repasser par la souris fait perdre le fil du document.
  const auClavier = useCallback(
    (e: React.KeyboardEvent) => {
      const gestes: Record<string, () => void> = {
        ArrowLeft: () => allerA(page - 1),
        ArrowRight: () => allerA(page + 1),
        PageUp: () => allerA(page - 1),
        PageDown: () => allerA(page + 1),
        Home: () => allerA(1),
        End: () => allerA(pages),
        "+": () => zoomer(1),
        "=": () => zoomer(1),
        "-": () => zoomer(-1),
        r: () => setRotation((r) => ((r + 90) % 360) as Rotation),
        R: () => setRotation((r) => ((r + 270) % 360) as Rotation),
      };
      const geste = gestes[e.key];
      if (!geste) return;
      e.preventDefault();
      geste();
    },
    [allerA, page, pages, zoomer],
  );

  const bbox = highlight ? tourner(highlight.bbox, rotation) : null;
  const cadreCite = bbox
    ? {
        left: `${bbox.x0 * 100}%`,
        top: `${bbox.y0 * 100}%`,
        width: `${Math.max(bbox.x1 - bbox.x0, 0.012) * 100}%`,
        height: `${Math.max(bbox.y1 - bbox.y0, 0.012) * 100}%`,
      }
    : null;

  const loupeImage =
    highlight && etat === "image"
      ? (() => {
          const b = highlight.bbox;
          const l = Math.max(b.x1 - b.x0 + PAD_X * 2, 0.08);
          const h = Math.max(b.y1 - b.y0 + PAD_Y * 2, 0.03);
          const cx = ((b.x0 + b.x1) / 2) * 100;
          const cy = ((b.y0 + b.y1) / 2) * 100;
          return {
            backgroundImage: `url(${urlLocale})`,
            backgroundSize: `${100 / l}% auto`,
            backgroundPosition: `${cx.toFixed(2)}% ${cy.toFixed(2)}%`,
            aspectRatio: `${l} / ${h}`,
          } as const;
        })()
      : null;

  const outil =
    "min-h-[32px] border border-border px-2 text-[11px] uppercase tracking-wide hover:bg-accent disabled:opacity-40";

  return (
    <div className="space-y-2">
      {/* La barre reste visible : un zoom qu'il faut chercher n'est pas un zoom. */}
      <div className="flex flex-wrap items-center gap-1 border border-border bg-card px-2 py-1.5">
        <button
          type="button"
          onClick={() => zoomer(-1)}
          className={outil}
          title={t("doc.zoom.out")}
        >
          −
        </button>
        <span className="num min-w-[3.5rem] text-center text-[11px] text-muted-foreground">
          {Math.round(echelle * 100)}%
        </span>
        <button type="button" onClick={() => zoomer(1)} className={outil} title={t("doc.zoom.in")}>
          +
        </button>

        <span aria-hidden className="mx-1 h-4 w-px bg-border" />

        <button
          type="button"
          onClick={() => setAjustement("largeur")}
          className={cn(outil, ajustement === "largeur" && "bg-accent font-semibold")}
        >
          {t("doc.fit.width")}
        </button>
        <button
          type="button"
          onClick={() => setAjustement("page")}
          className={cn(outil, ajustement === "page" && "bg-accent font-semibold")}
        >
          {t("doc.fit.page")}
        </button>

        <span aria-hidden className="mx-1 h-4 w-px bg-border" />

        {/* Un scan arrive de travers une fois sur trois. Sans rotation, on
            penche la tête, ou on ouvre le fichier ailleurs. */}
        <button
          type="button"
          onClick={() => setRotation((r) => ((r + 90) % 360) as Rotation)}
          className={outil}
          title={t("doc.rotate")}
        >
          ↻
        </button>

        <span className="ms-auto flex items-center gap-1">
          {pages > 1 ? (
            <>
              <button
                type="button"
                onClick={() => allerA(page - 1)}
                disabled={page <= 1}
                className={outil}
                aria-label={t("doc.page.prev")}
              >
                ‹
              </button>
              <span className="num text-[11px] text-muted-foreground">
                {page} / {pages}
              </span>
              <button
                type="button"
                onClick={() => allerA(page + 1)}
                disabled={page >= pages}
                className={outil}
                aria-label={t("doc.page.next")}
              >
                ›
              </button>
            </>
          ) : null}
          <a
            href={urlLocale}
            target="_blank"
            rel="noreferrer"
            className={cn(outil, "inline-flex items-center")}
          >
            {t("doc.open")}
          </a>
        </span>
      </div>

      <div
        ref={cadreRef}
        tabIndex={0}
        onKeyDown={auClavier}
        aria-label={label}
        className="relative max-h-[70vh] overflow-auto border border-border bg-paper focus:outline-none focus-visible:ring-1 focus-visible:ring-foreground"
      >
        {etat === "natif" ? (
          // Le lecteur du navigateur, avec le lien pour l'ouvrir en grand si
          // l'appareil ne sait pas afficher un PDF dans la page.
          <div className="flex min-h-[60vh] flex-col">
            <object data={urlLocale} type="application/pdf" className="min-h-[60vh] w-full">
              <div className="space-y-3 p-6 text-center">
                <p className="text-[13px] text-muted-foreground">{t("pme.doc.native")}</p>
                <a href={urlLocale} target="_blank" rel="noreferrer" className={outil}>
                  {t("doc.open")}
                </a>
              </div>
            </object>
          </div>
        ) : etat === "erreur" ? (
          <div className="space-y-3 p-6 text-center">
            <p className="text-[13px] text-signal-warn">{t("pme.doc.error")}</p>
            <div className="flex justify-center gap-2">
              <button type="button" onClick={() => setEssai((n) => n + 1)} className={outil}>
                {t("doc.retry")}
              </button>
              <a href={urlLocale} target="_blank" rel="noreferrer" className={outil}>
                {t("doc.open")}
              </a>
            </div>
          </div>
        ) : (
          <div className="relative inline-block min-w-full">
            {etat === "image" ? (
              <img src={urlLocale} alt={label} className="block w-full" />
            ) : (
              <canvas ref={canvasRef} className="block" />
            )}
            {cadreCite && etat !== "chargement" ? (
              <span
                ref={marqueRef}
                className="pointer-events-none absolute border-2 border-signal-warn bg-signal-warn/10"
                style={cadreCite}
              />
            ) : null}
            {etat === "chargement" ? (
              <p className="p-6 text-center text-[12px] text-muted-foreground">
                {t("pme.doc.loading")}
              </p>
            ) : null}
          </div>
        )}
      </div>

      {highlight && etat !== "erreur" ? (
        <div className="border border-border bg-paper">
          {loupeImage ? (
            <div
              className="w-full bg-no-repeat"
              style={loupeImage}
              role="img"
              aria-label={`${label} — ${highlight.field}`}
            />
          ) : (
            <canvas
              ref={loupeRef}
              className="block w-full"
              aria-label={`${label} — ${highlight.field}`}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
