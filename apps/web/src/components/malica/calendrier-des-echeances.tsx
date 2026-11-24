/**
 * Le mois en calendrier, à côté de la liste des échéances (ordinateur seulement).
 *
 * Chaque jour qui porte une échéance prend le ton que la liste lui donne déjà
 * (en retard, sous la semaine, déposée) : l'écran le calcule une fois, ce
 * calendrier ne fait que le placer. Aucune date n'est dérivée ici (R4) ; les
 * jours viennent de `dueDate`, et la grille n'est qu'un découpage d'affichage.
 */
import { useState } from "react";

import { useI18n } from "@/i18n";
import { casesDuMois, unJourParColonne } from "@/lib/calendrier-du-mois";
import { moisDecale } from "@malica/socle/exercice";

/** Un jour d'échéance, avec le ton que la liste lui donne. */
interface JourDEcheance {
  readonly date: string;
  readonly ton: string;
  readonly libelle: string;
}

/** Le ton qui l'emporte quand plusieurs échéances tombent le même jour. */
const PRIORITE = ["ve", "am", "", "acc"];

export function CalendrierDesEcheances({
  jours,
  aujourdHui,
}: {
  jours: readonly JourDEcheance[];
  aujourdHui: string;
}) {
  const { t, locale } = useI18n();
  const [mois, setMois] = useState(aujourdHui.slice(0, 7));

  const parDate = new Map<string, { ton: string; libelles: string[] }>();
  for (const j of jours) {
    const deja = parDate.get(j.date);
    if (!deja) parDate.set(j.date, { ton: j.ton, libelles: [j.libelle] });
    else {
      deja.libelles.push(j.libelle);
      if (PRIORITE.indexOf(j.ton) < PRIORITE.indexOf(deja.ton)) deja.ton = j.ton;
    }
  }

  const titre = (() => {
    const rendu = new Intl.DateTimeFormat(locale, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${mois}-01T00:00:00Z`));
    return rendu.charAt(0).toUpperCase() + rendu.slice(1);
  })();
  const nomDuJour = (iso: string, weekday: "narrow" | "long") =>
    new Intl.DateTimeFormat(locale, { weekday, timeZone: "UTC" }).format(
      new Date(`${iso}T00:00:00Z`),
    );

  const cases = casesDuMois(mois);
  const semaines = Array.from({ length: Math.ceil(cases.length / 7) }, (_, i) =>
    cases.slice(i * 7, i * 7 + 7),
  );

  return (
    <aside className="ec-cote" aria-labelledby="ec-cal-titre">
      <div className="ec-cal-tete">
        <h2 id="ec-cal-titre" aria-live="polite">
          {titre}
        </h2>
        <button
          type="button"
          aria-label={t("pme.echeances.moisPrecedent")}
          onClick={() => setMois((m) => moisDecale(m, 1))}
        >
          <svg viewBox="0 0 24 24" className="g" aria-hidden>
            <path d="M14.5 5.5L8 12l6.5 6.5" />
          </svg>
        </button>
        <button
          type="button"
          aria-label={t("pme.echeances.moisSuivant")}
          onClick={() => setMois((m) => moisDecale(m, -1))}
        >
          <svg viewBox="0 0 24 24" className="g" aria-hidden>
            <path d="M9.5 5.5L16 12l-6.5 6.5" />
          </svg>
        </button>
      </div>
      <table className="ec-cal">
        <thead>
          <tr>
            {unJourParColonne(mois).map((j) => (
              <th key={j} scope="col" abbr={nomDuJour(j, "long")}>
                {nomDuJour(j, "narrow")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {semaines.map((semaine) => (
            <tr key={semaine.find(Boolean) ?? ""}>
              {Array.from({ length: 7 }, (_, i) => {
                const jour = semaine[i] ?? null;
                if (jour === null) return <td key={i} />;
                const marque = parDate.get(jour);
                return (
                  <td
                    key={jour}
                    data-ton={marque ? marque.ton || "echeance" : undefined}
                    aria-current={jour === aujourdHui ? "date" : undefined}
                  >
                    {Number(jour.slice(8))}
                    {marque ? <span className="sr-only">{marque.libelles.join(", ")}</span> : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="ec-legende">
        <li data-ton="ve">{t("relation.echeances.retard")}</li>
        <li data-ton="am">{t("relation.echeances.semaine")}</li>
        <li data-ton="jour">{t("pme.home.ech.aujourdhui")}</li>
      </ul>
    </aside>
  );
}
