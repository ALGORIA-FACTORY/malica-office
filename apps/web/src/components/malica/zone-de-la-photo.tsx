/**
 * La zone de la photo d'un champ — celle que la lecture a citée.
 *
 * Quand la personne corrige un montant, elle doit avoir sous les yeux ce que
 * la machine a lu à cet endroit : la feuille du crayon montre la zone, au-dessus
 * de la saisie. Le même recadrage que la loupe de la visionneuse
 * (`document-view.tsx`) : la zone citée, un peu de marge autour, cernée.
 *
 * Une photo, ou un PDF que Malica a construit (ses pages sont des JPEG), se
 * recadre ici. Un PDF de texte n'a pas d'image à recadrer : on le dit, et la
 * visionneuse entière est à un toucher.
 */
import { useEffect, useState } from "react";

import { pagesJpegDuPdf } from "@/capabilities/pages-du-pdf";
import { useI18n } from "@/i18n";
import type { Citation } from "@malica/socle/ports/repositories";

/** Marges autour de la zone citée, en fraction de la page (comme la visionneuse). */
const PAD_X = 0.06;
const PAD_Y = 0.02;

/** Un PDF s'annonce par « %PDF- » ; tout le reste est lu comme une image. */
const estUnPdf = (contenu: ArrayBuffer) =>
  new TextDecoder().decode(new Uint8Array(contenu, 0, Math.min(5, contenu.byteLength))) === "%PDF-";

export function ZoneDeLaPhoto({
  contenu,
  citation,
  onVoirLaPhoto,
}: {
  contenu: ArrayBuffer | null;
  citation: Citation | undefined;
  onVoirLaPhoto: () => void;
}) {
  const { t } = useI18n();
  const [url, setUrl] = useState<string | null>(null);
  /** Les dimensions de la page en pixels : la zone se mesure en fractions de la page, le cadre en pixels. */
  const [page, setPage] = useState<{ largeur: number; hauteur: number } | null>(null);

  useEffect(() => {
    if (!contenu || !citation) {
      setUrl(null);
      return undefined;
    }
    const image = estUnPdf(contenu)
      ? pagesJpegDuPdf(contenu)[Math.max(citation.page, 1) - 1]
      : new Blob([contenu.slice(0)]);
    if (!image) {
      setUrl(null);
      return undefined;
    }
    const locale = URL.createObjectURL(image);
    setUrl(locale);
    return () => URL.revokeObjectURL(locale);
  }, [contenu, citation]);

  useEffect(() => {
    setPage(null);
    if (!url) return undefined;
    const lue = new Image();
    let vivant = true;
    lue.onload = () => {
      if (vivant && lue.naturalWidth > 0)
        setPage({ largeur: lue.naturalWidth, hauteur: lue.naturalHeight });
    };
    lue.onerror = () => {
      if (vivant) setUrl(null);
    };
    lue.src = url;
    return () => {
      vivant = false;
    };
  }, [url]);

  if (!citation) {
    return (
      <p className="border border-border bg-card p-3 text-[13px] leading-[1.45] text-text-2">
        {t("pme.crayon.sansZone")}
      </p>
    );
  }
  if (!url) {
    return (
      <div className="grid gap-2 border border-border bg-card p-3">
        <p className="text-[13px] leading-[1.45] text-text-2">{t("pme.crayon.zoneAilleurs")}</p>
        <button
          type="button"
          onClick={onVoirLaPhoto}
          className="min-h-[44px] self-start text-[13.5px] font-semibold underline underline-offset-2"
        >
          {t("pme.crayon.voirLaPhoto")}
        </button>
      </div>
    );
  }

  // La fenêtre : la zone citée et sa marge, en fractions de la page (plafonnées à la page).
  const b = citation.bbox;
  const l = Math.min(Math.max(b.x1 - b.x0 + PAD_X * 2, 0.08), 1);
  const h = Math.min(Math.max(b.y1 - b.y0 + PAD_Y * 2, 0.03), 1);
  const x = Math.min(Math.max((b.x0 + b.x1) / 2 - l / 2, 0), 1 - l);
  const y = Math.min(Math.max((b.y0 + b.y1) / 2 - h / 2, 0), 1 - h);
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-2">
        {t("pme.crayon.zone")}
      </p>
      <div
        role="img"
        aria-label={t("pme.crayon.zone")}
        data-testid="zone-de-la-photo"
        className="relative w-full overflow-hidden border border-border bg-paper"
        style={{
          // Le cadre a les proportions de la fenêtre EN PIXELS, pas en fractions.
          aspectRatio: page ? `${l * page.largeur} / ${h * page.hauteur}` : `${l} / ${h}`,
        }}
      >
        {page ? (
          <>
            <img
              src={url}
              alt=""
              draggable={false}
              className="absolute max-w-none"
              style={{
                width: `${100 / l}%`,
                insetInlineStart: `${(-x / l) * 100}%`,
                top: `${(-y / h) * 100}%`,
              }}
            />
            <span
              aria-hidden
              className="absolute border-2 border-signal-warn"
              style={{
                insetInlineStart: `${((b.x0 - x) / l) * 100}%`,
                top: `${((b.y0 - y) / h) * 100}%`,
                width: `${(Math.max(b.x1 - b.x0, 0.012) / l) * 100}%`,
                height: `${(Math.max(b.y1 - b.y0, 0.012) / h) * 100}%`,
              }}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
