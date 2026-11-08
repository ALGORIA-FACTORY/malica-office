/**
 * Réglages › Bouton + — planche 5, approuvée le 7 novembre 2026.
 *
 * « Le + est toujours à droite. Pour un gaucher qui tient son téléphone d'une
 * main, il est hors de portée du pouce. » Deux aperçus à toucher, pas un mot
 * technique : à gauche, à droite. Le choix s'applique tout de suite et suit
 * le compte (téléphone, ordinateur, application Android).
 *
 * On y vient des Réglages, ou par un appui long sur le « + ».
 */
import { createFileRoute } from "@tanstack/react-router";

import type { CoteDuPlus } from "@malica/socle/ports/repositories";

import { useCoteDuPlus } from "@/hooks/use-cote-du-plus";
import { useRevenir } from "@/hooks/use-revenir";
import { useI18n } from "@/i18n";

export const Route = createFileRoute("/_authenticated/pme/bouton-plus")({
  component: BoutonPlus,
});

function Apercu({ cote }: { cote: CoteDuPlus }) {
  const plus = <span className="p" />;
  return (
    <span className="mini" aria-hidden>
      <span className="l">
        <i />
        <i style={{ width: "70%" }} />
        <i />
      </span>
      {/* Le côté physique : l'aperçu ne se retourne pas en arabe. */}
      <span className="bar" dir="ltr">
        {cote === "gauche" ? plus : null}
        <span className="t" />
        <span className="t" />
        {cote === "droite" ? plus : null}
      </span>
    </span>
  );
}

function BoutonPlus() {
  const { t } = useI18n();
  const revenir = useRevenir();
  const { cote, choisir } = useCoteDuPlus();
  const options: Array<{ cle: CoteDuPlus; label: string }> = [
    { cle: "gauche", label: t("pme.boutonPlus.gauche") },
    { cle: "droite", label: t("pme.boutonPlus.droite") },
  ];

  return (
    <div
      data-ecran="bouton-plus"
      data-famille="papiers"
      className="-mx-4 -my-5 flex min-h-0 flex-1 flex-col"
    >
      <div className="top">
        <button
          type="button"
          className="bk"
          aria-label={t("pme.regler.retour")}
          onClick={() => revenir("/pme/reglages")}
        >
          <svg viewBox="0 0 24 24" className="g" aria-hidden>
            <path d="M14.5 5.5L8 12l6.5 6.5" />
          </svg>
        </button>
        <span className="ttl">{t("pme.boutonPlus.titre")}</span>
      </div>

      <div className="pad">
        <p className="q">{t("pme.boutonPlus.question")}</p>
        <div className="opts" role="radiogroup" aria-label={t("pme.boutonPlus.titre")}>
          {options.map((o) => (
            <button
              key={o.cle}
              type="button"
              role="radio"
              aria-checked={cote === o.cle}
              className="opt"
              onClick={() => choisir(o.cle)}
            >
              <Apercu cote={o.cle} />
              <b>{o.label}</b>
            </button>
          ))}
        </div>
        <p className="note">{t("pme.boutonPlus.compte")}</p>
      </div>
    </div>
  );
}
