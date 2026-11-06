/**
 * Un long texte, replié à quelques lignes, qui se lit en entier sur demande.
 *
 * Recette du 5 novembre 2026 : les réponses du Conseil et les briefings
 * d'affectation s'affichaient en entier — une page par carte, une cellule
 * de tableau de quinze lignes. Le texte ne se perd pas : il se replie.
 */
import { useState } from "react";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

/** En deçà, le texte tient : pas de bouton pour rien. */
const SEUIL_CARACTERES = 280;

export function TexteReplie({
  texte,
  lignes = 4,
  className,
}: {
  texte: string;
  /** Les lignes montrées repliées (3, 4 ou 6). */
  lignes?: 3 | 4 | 6;
  className?: string;
}) {
  const { t } = useI18n();
  const [ouvert, setOuvert] = useState(false);
  const long = texte.length > SEUIL_CARACTERES;
  const pince = { 3: "line-clamp-3", 4: "line-clamp-4", 6: "line-clamp-6" }[lignes];
  return (
    <div className={className}>
      <p className={cn("whitespace-pre-wrap", long && !ouvert && pince)}>{texte}</p>
      {long ? (
        <button
          type="button"
          onClick={() => setOuvert((o) => !o)}
          aria-expanded={ouvert}
          className="mt-1 text-[12px] font-medium underline underline-offset-4 hover:text-foreground"
        >
          {ouvert ? t("common.reduire") : t("common.lireLaSuite")}
        </button>
      ) : null}
    </div>
  );
}
