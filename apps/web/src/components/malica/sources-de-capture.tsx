/**
 * Les trois sources d'une capture — photographier, importer des images,
 * importer des PDF.
 *
 * UN dessin, deux écrans : « Ajouter des pièces » (`pme.capturer`) et la carte
 * d'identification fiscale (`pme.fiche`). 23 novembre 2026 : la carte ouvrait
 * un autre écran de caméra que les pièces ; « je veux tous comme 2 ». Le
 * dessin vient de la planche 9, à l'identique — le grand bouton plein, puis
 * les deux imports côte à côte.
 *
 * Le composant ne prend rien lui-même : il annonce le moyen choisi. La caméra
 * est `usePriseDeVue`, les sélecteurs sont `files.choisir`, et c'est l'écran
 * qui sait où vont les pages — une pièce déposée, une carte lue.
 *
 * Sa peau est sous `.c-sources` dans `styles-pme.css` : elle suit le composant
 * sur n'importe quel écran de la surface, au lieu d'être attachée à un seul.
 */
import { useI18n } from "@/i18n";

/* Les tracés viennent du dessin, à l'identique ; `.g` porte déjà le trait. */
const TRACES = {
  photo: "M4 8h3l2-2.5h6L17 8h3v11H4z",
  images: "M3.5 5.5h17v13h-17zM8.5 10a1.4 1.4 0 1 0 0-.1M4 16.5l4.5-4 4 3.5 3-2.5 4.5 4",
  pdf: "M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21zM9.5 9.5l2 2 3.5-3.5M9 15h6",
} as const;

export function SourcesDeCapture({
  occupe,
  onPhotographier,
  onImporter,
}: {
  /** Un geste est en cours : les trois sources attendent. */
  occupe: boolean;
  onPhotographier: () => void;
  onImporter: (moyen: "images" | "pdf") => void;
}) {
  const { t } = useI18n();
  return (
    <div className="c-sources">
      <button type="button" className="c-photo" disabled={occupe} onClick={onPhotographier}>
        <svg viewBox="0 0 24 24" className="g" aria-hidden>
          <path d={TRACES.photo} />
          <circle cx="12" cy="13" r="3.5" />
        </svg>
        <span>{t("pme.capture.photo")}</span>
      </button>
      <div className="c-deux">
        <button type="button" disabled={occupe} onClick={() => onImporter("images")}>
          <svg viewBox="0 0 24 24" className="g" aria-hidden>
            <path d={TRACES.images} />
          </svg>
          <span>{t("pme.capture.galerie")}</span>
        </button>
        <button type="button" disabled={occupe} onClick={() => onImporter("pdf")}>
          <svg viewBox="0 0 24 24" className="g" aria-hidden>
            <path d={TRACES.pdf} />
          </svg>
          <span>{t("pme.doc.importer")}</span>
        </button>
      </div>
    </div>
  );
}
