/**
 * Les sept dossiers en miniatures — la rangée de pochettes de l'accueil.
 *
 * SEPT DOSSIERS, TOUJOURS LES MÊMES (maquette validée le 25 octobre 2026).
 * Une carte n'existait que pour un type qui avait des pièces : « Gouvernance »
 * disparaissait dès qu'aucun PV n'était rangé, et sa couleur dépendait de sa
 * place. Désormais chaque dossier du référentiel a sa carte, dans son ordre et
 * sa teinte — vide, elle reste là, dans sa couleur (Wissem, 25 octobre). Elle
 * compte la période qu'elle affiche : le mois en cours, ou l'année pour un PV
 * ou une déclaration.
 *
 * 1er novembre 2026 : la bibliothèque montre la même rangée (maquette validée
 * par Wissem). Elle vit donc ici, une fois, et les deux écrans l'appellent.
 */
import { Link } from "@tanstack/react-router";

import { useDossiers } from "@/hooks/use-dossiers";
import { currentPeriod } from "@/hooks/use-tva";
import { useI18n } from "@/i18n";
import { dansLaPeriodeMontree, dossierDeLaPiece, periodeMontree } from "@/lib/dossiers";
import { statutDeLaPieceLue } from "@/lib/lecture";
import type { PieceLue } from "@malica/socle/ports/repositories";

export function RailDesDossiers({ pieces }: { pieces: readonly PieceLue[] }) {
  const { t, locale } = useI18n();
  const sept = useDossiers();
  const periode = currentPeriod();
  const mois = (p: string) =>
    new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(
      new Date(`${p}-01T00:00:00Z`),
    );

  const dossiers = sept.dossiers.map((d) => {
    const duDossier = pieces.filter((p) => dossierDeLaPiece(p, sept.types) === d.code);
    // La période la plus récente qui a des pièces (`periodeMontree`) : le 1er
    // du mois, Achats et Ventes ne se disent plus vides sur un dossier plein.
    const montree = periodeMontree(duDossier, d.periode, periode);
    const duMois = duDossier.filter((p) => dansLaPeriodeMontree(p, montree));
    // Un reçu ou un justificatif n'attend rien : il compte pour fait. Une
    // pièce est faite quand le cabinet l'a prise en charge — la règle de la
    // liste (`statutDeLaPieceLue`), sur les faits du suivi.
    const faites = duMois.filter(
      (p) => p.accompagne || statutDeLaPieceLue(p) === "prise_en_charge",
    ).length;
    return {
      ...d,
      total: duMois.length,
      faites,
      part: duMois.length === 0 ? 0 : Math.round((faites / duMois.length) * 100),
      etiquette: d.periode === "mois" ? mois(montree) : montree,
    };
  });

  if (dossiers.length === 0) return null;
  return (
    <div className="rail">
      {dossiers.map((d) => (
        /*
         * Planche 9 (7 novembre 2026) : une tuile VIDE dit « + Ajouter » — elle
         * ouvre donc « Ajouter des pièces », dans ce dossier. Une tuile qui a
         * des pièces ouvre le dossier, comme avant.
         */
        <Link
          key={d.code}
          {...(d.total === 0
            ? { to: "/pme/capturer" as const, search: { dossier: d.code } }
            : { to: "/pme/dossier/$type" as const, params: { type: d.code } })}
          data-teinte={d.teinte}
          className="poch"
        >
          <span className="cv">
            <span className="mo">{d.etiquette}</span>
            <span className="ini" aria-hidden="true">
              {d.libelle.slice(0, 1)}
            </span>
            <b>{d.libelle}</b>
            <span className="av">
              <i style={{ width: `${d.part}%` }} />
            </span>
          </span>
          {d.total === 0 ? (
            <>
              <b>{t("pme.home.dossier.aucune")}</b>
              <span>{t("pme.home.dossier.ajouter")}</span>
            </>
          ) : (
            <>
              <b>{t("pme.home.dossier.pieces", { count: d.total })}</b>
              <span>{t("pme.home.dossier.faites", { count: d.faites })}</span>
            </>
          )}
        </Link>
      ))}
    </div>
  );
}
