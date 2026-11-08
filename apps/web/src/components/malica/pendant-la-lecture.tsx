/**
 * Pendant la lecture — planche 11, approuvée le 7 novembre 2026.
 *
 * Avant : « Pièce non lue · en cours » pendant vingt à trente secondes. Malica
 * montre maintenant ce qu'elle fait : trouver le fournisseur, vérifier son
 * matricule, lire les lignes, recompter HT + TVA + timbre, comparer au montant
 * en lettres — avec un trait qui balaie la vignette.
 *
 * Ce qui est montré pendant la lecture est une ACTIVITÉ, jamais un résultat :
 * aucune coche tant que la pièce n'est pas lue. L'étape affichée avance avec
 * le temps écoulé depuis la demande (le même pour tout l'écran, d'un rendu à
 * l'autre). Les coches arrivent avec les VRAIES valeurs, une fois la pièce
 * lue : le fournisseur, la date, le total — ce que la base a enregistré.
 */
import { useEffect, useState } from "react";

import { useI18n } from "@/i18n";
import { ETAPES_DE_LECTURE, etapeMontree } from "@/lib/pendant-la-lecture";

/** Ce que fait Malica, sur la ligne d'une pièce en cours de lecture. */
export function LectureEnCours({ demandeLe }: { demandeLe: string | null }) {
  const { t } = useI18n();
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => {
    const h = window.setInterval(() => setMaintenant(Date.now()), 500);
    return () => window.clearInterval(h);
  }, []);
  const i = etapeMontree(demandeLe, maintenant);
  return (
    <span className="pl" aria-live="polite">
      <b key={i} className="pl-etape">
        <span>{t(ETAPES_DE_LECTURE[i]!)}</span>
      </b>
      <span className="pl-points" aria-hidden>
        {ETAPES_DE_LECTURE.map((cle, k) => (
          <i key={cle} className={k === i ? "cour" : undefined} />
        ))}
      </span>
    </span>
  );
}

/** Les valeurs trouvées, chacune avec sa coche, une fois la pièce lue. */
export function ValeursTrouvees({ valeurs }: { valeurs: Array<{ cle: string; v: string }> }) {
  if (valeurs.length === 0) return null;
  return (
    <ul className="pl-trouve">
      {valeurs.map((x, k) => (
        <li key={x.cle} style={{ animationDelay: `${k * 120}ms` }}>
          <span>{x.cle}</span>
          <b>{x.v}</b>
          <svg viewBox="0 0 24 24" className="pl-ok" aria-hidden>
            <path d="M5 12.5l4.5 4.5L19 7.5" style={{ animationDelay: `${k * 120 + 100}ms` }} />
          </svg>
        </li>
      ))}
    </ul>
  );
}
