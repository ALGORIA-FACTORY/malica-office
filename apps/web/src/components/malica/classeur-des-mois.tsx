/**
 * Le classeur des mois de l'exercice : une puce par mois, celle du mois regardé allumée,
 * les mois à venir éteints. Commun aux charges et à la TVA (pilote, 24 novembre 2026 : la
 * TVA n'avait pas de quoi changer de mois, les charges oui).
 *
 * Il ne choisit rien lui-même : il rend les mois que `useMoisDeLExercice` donne et dit
 * lequel est touché ; l'écran décide où le mois vit (un état, ou `?mois=`).
 */
import type { MoisDExercice } from "@/hooks/use-mois-de-l-exercice";
import { useI18n } from "@/i18n";

export function ClasseurDesMois({
  mois,
  periode,
  choisir,
  libelle,
}: {
  mois: readonly MoisDExercice[];
  periode: string;
  choisir: (periode: string) => void;
  /** Le nom du groupe pour un lecteur d'écran. */
  libelle: string;
}) {
  const { locale } = useI18n();
  const court = (p: string) =>
    new Intl.DateTimeFormat(locale, { month: "short", year: "2-digit", timeZone: "UTC" }).format(
      new Date(`${p}-01T00:00:00Z`),
    );
  return (
    <div className="mths" role="group" aria-label={libelle}>
      {mois.map((p) => (
        <button
          key={p.periode}
          type="button"
          className={p.periode === periode ? "on" : undefined}
          onClick={() => choisir(p.periode)}
          disabled={p.aVenir}
          aria-pressed={p.periode === periode}
        >
          {court(p.periode)}
        </button>
      ))}
    </div>
  );
}
