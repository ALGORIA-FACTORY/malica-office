import { describe, expect, it } from "vitest";

import { LOCALES, MESSAGES } from "@malica/socle/messages";

/**
 * ============================================== LE DÉFAUT QUE CECI VERROUILLE
 *
 * L'écran des lecteurs spécialisés traduit six états de recette, quatre
 * provenances, cinq qualifications, deux jeux et quatre dérives. Ce sont les
 * valeurs des types de `fabrique.*_t`, et ce sont des énumérations de BASE :
 * une valeur s'y ajoute par migration, sans qu'aucun type TypeScript ne le
 * rappelle au moment du rendu.
 *
 * Sans cette épreuve, la valeur nouvelle afficherait sa CLÉ — « cab.lecteurs.
 * qualification.vacation » — sous les yeux d'un expert-comptable. Le même
 * défaut s'était produit sur `confirmee`, le septième statut de pièce, et
 * c'est exactement le genre d'écart qu'une relecture manque.
 *
 * Les listes ci-dessous sont celles des `create type` de
 * `20261020090000_une_recette_de_lecture_est_une_donnee_gouvernee.sql`. Si la
 * base en gagne une, cette épreuve tombe tant qu'elle n'a pas ses trois
 * traductions.
 */
const DE_LA_BASE: Record<string, readonly string[]> = {
  "cab.lecteurs.etat": ["candidate", "evaluee", "observation", "active", "suspendue", "retiree"],
  "cab.lecteurs.provenance": [
    "validation_humaine",
    "correction_humaine",
    "import_expert",
    "observation",
  ],
  "cab.lecteurs.qualification": [
    "reconnaissance_ocr",
    "designation_champ",
    "normalisation",
    "document_incomplet",
    "decision_comptable",
  ],
  "cab.lecteurs.usage": ["apprentissage", "evaluation"],
  "cab.lecteurs.derive": [
    "abstention_en_hausse",
    "montant_faux_accepte",
    "correction_humaine",
    "signature_changee",
  ],
};

/**
 * Les six états portent AUSSI une phrase, et pas seulement un mot.
 *
 * La couleur seule ne porte rien (langage visuel, interdit ③), et l'écran
 * donnait la phrase de l'observation à tout état qui n'était pas `active` :
 * une recette suspendue aurait lu « elle s'exécute et on compare », c'est-à-
 * dire l'inverse de ce qu'elle fait.
 */
const ETATS_AVEC_PHRASE = DE_LA_BASE["cab.lecteurs.etat"]!;

describe("la fabrique de lecteurs, vue par l'écran", () => {
  for (const langue of LOCALES) {
    const catalogue = MESSAGES[langue] as Record<string, string | undefined>;

    it(`chaque valeur de la base a son libellé en ${langue}`, () => {
      const manquants: string[] = [];
      for (const [prefixe, valeurs] of Object.entries(DE_LA_BASE)) {
        for (const v of valeurs) {
          const cle = `${prefixe}.${v}`;
          const libelle = catalogue[cle];
          if (!libelle || libelle.trim().length === 0 || libelle.startsWith("cab.")) {
            manquants.push(cle);
          }
        }
      }
      expect(manquants, `valeurs sans libellé en ${langue}`).toEqual([]);
    });

    it(`chaque état porte sa phrase, et pas seulement son mot, en ${langue}`, () => {
      const manquants = ETATS_AVEC_PHRASE.filter((e) => {
        const note = catalogue[`cab.lecteurs.etat.${e}.note`];
        return !note || note.trim().length === 0;
      });
      expect(manquants, `états sans phrase en ${langue}`).toEqual([]);
    });
  }
});
