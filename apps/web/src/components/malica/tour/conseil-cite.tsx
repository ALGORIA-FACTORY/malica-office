/**
 * Les réglages du conseil cité — la consigne et le choix des modèles (écran de la tour).
 *
 * Écran de l'opérateur ALGORIA, deux cartes : la consigne que Claude reçoit avant les
 * passages du corpus, versionnée en base (publier crée une version datée et motivée, la
 * précédente reste lisible), et le réglage des modèles avec la règle simple qui sépare les
 * questions courantes des difficiles. La base refuse un modèle sans tarif en vigueur (R8)
 * et toute valeur hors bornes. La consigne suit la règle R10 (versionnée en base).
 */
import type { EtatDuConseilCite } from "@malica/socle/ports/repositories";

import { useI18n } from "@/i18n";
import { office } from "@/verticals/malica-office/composition";

import { ENTIER, LaConsigne, LeReglageDesModeles, type Messages } from "./consigne-et-modeles";

const MESSAGES: Messages<"tour.conseilCite"> = {
  consigne: "tour.conseilCite.consigne",
  "consigne.aide": "tour.conseilCite.consigne.aide",
  "consigne.enVigueur": "tour.conseilCite.consigne.enVigueur",
  "consigne.borne": "tour.conseilCite.consigne.borne",
  publier: "tour.conseilCite.publier",
  reglage: "tour.conseilCite.reglage",
  "reglage.aide": "tour.conseilCite.reglage.aide",
  mois: "tour.conseilCite.mois",
  modeleCourant: "tour.conseilCite.modeleCourant",
  modeleDifficile: "tour.conseilCite.modeleDifficile",
  longueurDifficile: "tour.conseilCite.longueurDifficile",
  motsDifficiles: "tour.conseilCite.motsDifficiles",
  borne: "tour.conseilCite.borne",
};

const ECRAN = {
  messages: MESSAGES,
  cle: ["tour-conseil-cite"],
  lire: () => office().tour.conseilCiteEtat(),
} as const;

/**
 * La consigne du conseil cité — le prompt système que Claude reçoit avant les
 * passages du corpus. Elle vit en base, versionnée (R10) : publier en crée une
 * version nouvelle, datée et motivée ; la précédente reste lisible.
 */
export function LaConsigneDuConseil() {
  return (
    <LaConsigne
      {...ECRAN}
      lignes={16}
      publier={(texte, motif) => office().tour.publierConsigneDuConseil(texte, motif)}
    />
  );
}

const DISTANCE = /^[01](\.\d{1,4})?$/;

/** Les champs propres au conseil cité, tels que l'écran les saisit (en texte). */
const saisir = (r: NonNullable<EtatDuConseilCite["reglage"]>) => ({
  corpusDistinctsDifficile: String(r.corpus_distincts_difficile),
  passagesMax: String(r.passages_max),
  distanceMax: String(r.distance_max),
  distanceMaxMots: String(r.distance_max_mots),
  sortieMaxJetons: String(r.sortie_max_jetons),
});

/**
 * Le réglage du conseil cité : Haiku par défaut, Sonnet pour les questions
 * difficiles, et la règle simple qui les sépare. La base refuse un modèle
 * sans tarif en vigueur (R8).
 */
export function LeReglageDuConseil() {
  const { t } = useI18n();
  return (
    <LeReglageDesModeles
      {...ECRAN}
      saisir={saisir}
      valide={(s) =>
        [s.corpusDistinctsDifficile, s.passagesMax, s.sortieMaxJetons].every((v) =>
          ENTIER.test(v.trim()),
        ) &&
        DISTANCE.test(s.distanceMax.trim()) &&
        DISTANCE.test(s.distanceMaxMots.trim())
      }
      regler={(commun, v, motif) =>
        office().tour.reglerConseilCite(
          {
            ...commun,
            corpusDistinctsDifficile: Number(v.corpusDistinctsDifficile),
            passagesMax: Number(v.passagesMax),
            distanceMax: v.distanceMax.trim(),
            distanceMaxMots: v.distanceMaxMots.trim(),
            sortieMaxJetons: Number(v.sortieMaxJetons),
          },
          motif,
        )
      }
      propres={({ champ }) => (
        <>
          {champ("corpusDistinctsDifficile", t("tour.conseilCite.corpusDistincts"), "numeric")}
          {champ("passagesMax", t("tour.conseilCite.passagesMax"), "numeric")}
          {champ("distanceMax", t("tour.conseilCite.distanceMax"), "decimal")}
          {champ("distanceMaxMots", t("tour.conseilCite.distanceMaxMots"), "decimal")}
          {champ("sortieMaxJetons", t("tour.conseilCite.sortieMax"), "numeric")}
        </>
      )}
    />
  );
}
