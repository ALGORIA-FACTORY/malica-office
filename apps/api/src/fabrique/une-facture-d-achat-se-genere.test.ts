/**
 * DEUX FACTURES DU MÊME FOURNISSEUR À LA MÊME PME FONT DEUX EXEMPLES.
 *
 *   node --experimental-strip-types --test src/fabrique/une-facture-d-achat-se-genere.test.ts
 *
 * ==================================================================== POURQUOI
 *
 * Le 20 octobre 2026, en écrivant le banc du générateur à timbre, j'ai trouvé
 * que les deux plans à timbre livrés la veille étaient comptés pour UN seul
 * exemple, et j'ai écrit que le générateur avait raison. **Il n'avait pas
 * raison, et la conséquence est le blocage le plus grave de la livraison.**
 *
 * Ce que Malica lit, c'est une facture d'ACHAT : le modèle de facture d'un
 * fournisseur — la papeterie, le grossiste — que la PME reçoit tous les mois.
 * Sur toutes ces factures, **le client est toujours la même PME**. Son nom est
 * du texte, il ne porte aucun chiffre, donc il entre dans l'empreinte de
 * signature ; et deux factures du même fournisseur à la même PME, où seuls les
 * montants, les dates et les numéros changent, ont la **même** empreinte.
 *
 * Le dirigeant ne reçoit pas la même mise en page de deux fournisseurs
 * différents. Dédupliquer sur l'empreinte de signature revenait donc à
 * interdire la génération **de tout format d'achat** — c'est-à-dire du seul cas
 * pour lequel ce produit existe.
 *
 * ======================================== L'EMPREINTE DE SIGNATURE DIT UN FORMAT
 *
 * Et c'est tout ce qu'elle dit. Elle a été conçue pour RECONNAÎTRE qu'un
 * document ressemble à un autre : ses clés d'ancre écartent délibérément tout
 * jeton portant un chiffre, parce qu'un montant ne décrit pas la forme du
 * papier. S'en servir pour REJETER un exemple lui fait dire autre chose : deux
 * documents de même empreinte sont le même **format**, jamais le même
 * **exemplaire**.
 *
 * Le critère juste est le PLAN DE JETONS lui-même, texte compris : deux
 * exemplaires du même document portent les mêmes mots dans le même ordre, deux
 * factures distinctes n'en portent pas. Ce n'est pas lire une valeur — c'est
 * constater que deux relevés sont le même relevé, et le module lit déjà tous
 * les textes du plan pour en tirer le vocabulaire commun.
 *
 * Module pur : aucune base, aucun réseau, aucun fournisseur payant.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PageToken, TokenRef } from "@malica/socle/ports/malica";

import {
  proposerUneRecette,
  type AppelDeGenerateur,
  type CodesDuReferentiel,
  type ExempleDApprentissage,
} from "./generateur.ts";
import { RECETTE_FACTURE_A } from "./interprete-recettes-synthetiques.ts";
import type { ExigencesDeValidation } from "./recette-validateur.ts";
import {
  FACTURE_A_TIMBRE,
  FACTURE_A_TIMBRE_AUTRES_VALEURS,
} from "./signature-plans-synthetiques.ts";
import { signerLePlan, type ParametresDeSignature } from "./signature.ts";

const PARAMETRES: ParametresDeSignature = {
  longueurMinimaleDAncre: 2,
  bandesParPage: 3,
  partMinimaleDuSens: 0.6,
  recouvrementDeLigne: 0.5,
  recouvrementDeColonne: 0.5,
  ancresEnRelationMax: 40,
};
const EXIGENCES: ExigencesDeValidation = {
  ancre_texte_min: 2,
  selecteurs_max: 200,
  champs_max: 50,
  jetons_max: 12,
  rang_max: 50,
};
/** Posés à la main : ce banc est pur. Ils n'autorisent rien (voir le générateur). */
const CODES: CodesDuReferentiel = { droits: [], taux: [] };

/** Le jeton du PIED qui porte ce texte — « 1180,000 » est imprimé deux fois. */
function dansLePied(plan: readonly PageToken[], texte: string): TokenRef {
  const t = plan.find((x) => x.text === texte && x.x0 >= 0.75);
  assert.ok(t, `le plan ne porte pas « ${texte} » dans son pied`);
  return { page: t.page, ordinal: t.ordinal };
}

function modeleQuiRend(recetteProposee: unknown): AppelDeGenerateur {
  return () =>
    Promise.resolve({
      recetteProposee,
      modele: "modele-simule",
      role: "generateur",
      tokensIn: 1200,
      tokensOut: 300,
      latenceMs: 42,
    });
}

/**
 * Les deux factures : même fournisseur, même PME cliente, autres valeurs.
 *
 * Ce sont les deux plans à timbre livrés le 19 octobre. Ils portent le même
 * client (« DREAM OPTIC »), les mêmes libellés d'articles, les mêmes en-têtes,
 * et ne diffèrent que par les montants, la date et le numéro de pièce. C'est
 * exactement la paire qu'une PME reçoit de son fournisseur deux mois de suite.
 */
function deuxFacturesDuMemeFournisseur(): ExempleDApprentissage[] {
  const lots = [
    { plan: FACTURE_A_TIMBRE(), ht: "1180,000" },
    { plan: FACTURE_A_TIMBRE_AUTRES_VALEURS(), ht: "3940,000" },
  ];
  return lots.map((lot, i) => ({
    pieceId: `facture-${String(i)}`,
    plan: lot.plan,
    attendu: { "totals.base_ht": dansLePied(lot.plan, lot.ht) },
    droitsAttendus: {},
    codesDeTaux: [],
  }));
}

describe("deux factures du même fournisseur à la même PME", () => {
  /*
   * ============================ ① LA CAUSE, MESURÉE ET NON RAISONNÉE
   */
  it("portent la MÊME empreinte de signature, et des plans de jetons DIFFÉRENTS", () => {
    const [a, b] = [FACTURE_A_TIMBRE(), FACTURE_A_TIMBRE_AUTRES_VALEURS()];
    assert.equal(
      signerLePlan(a, PARAMETRES).empreinte,
      signerLePlan(b, PARAMETRES).empreinte,
      "les empreintes diffèrent : le constat qui a motivé ce banc serait faux",
    );

    /*
     * Et pourtant ce ne sont pas les mêmes documents. La preuve est dans les
     * jetons : les montants, la date et le numéro diffèrent. L'empreinte de
     * signature ne les voit pas, par construction — elle écarte tout jeton
     * portant un chiffre, parce qu'un montant ne décrit pas la forme du papier.
     */
    const texte = (p: readonly PageToken[]) => p.map((t) => t.text).join("\u0000");
    assert.notEqual(
      texte(a),
      texte(b),
      "les deux plans portent les mêmes jetons : ce ne sont pas deux factures distinctes",
    );
  });

  /*
   * =================== ② ET ③ CE QUE LE GÉNÉRATEUR EN FAIT — LA MESURE QUI TRANCHE
   */
  it("font DEUX exemples, et le générateur propose une recette", async () => {
    const g = await proposerUneRecette(
      deuxFacturesDuMemeFournisseur(),
      EXIGENCES,
      PARAMETRES,
      CODES,
      modeleQuiRend(RECETTE_FACTURE_A),
    );
    assert.equal(
      g.ok,
      true,
      g.ok === false
        ? `${g.refus.code} : ${g.refus.detail}` +
            " — aucun format d'ACHAT ne peut alors être généré, et c'est le seul " +
            "cas pour lequel ce produit existe"
        : "",
    );
    if (!g.ok) return;
    assert.equal(
      g.provenance.pieces.length,
      2,
      "un des deux exemples a été écarté : la provenance ne dit pas sur quoi la recette a appris",
    );
  });

  /*
   * ============== ④ CE QUE LA DÉDUPLICATION FERMAIT RESTE FERMÉ
   *
   * C'est la condition de ce changement, et elle n'est pas négociable : deux
   * EXEMPLAIRES du même document ne doivent toujours pas faire deux exemples.
   * « L'intersection de quelque chose avec lui-même ne fait rien tomber », et
   * cela reste vrai — simplement, ce qui le dit n'est plus l'empreinte de
   * signature, c'est le plan de jetons.
   */
  it("deux EXEMPLAIRES du même document ne font toujours qu'un seul exemple", async () => {
    const plan = FACTURE_A_TIMBRE();
    const attendu = { "totals.base_ht": dansLePied(plan, "1180,000") };
    const g = await proposerUneRecette(
      [
        // Deux pièces, deux identifiants, le MÊME document : c'est le cas que
        // `pieceId` ne saurait pas voir, et c'est pourquoi le critère est le
        // plan et non l'identifiant.
        { pieceId: "a", plan, attendu, droitsAttendus: {}, codesDeTaux: [] },
        { pieceId: "b", plan: FACTURE_A_TIMBRE(), attendu, droitsAttendus: {}, codesDeTaux: [] },
      ],
      EXIGENCES,
      PARAMETRES,
      CODES,
      modeleQuiRend(RECETTE_FACTURE_A),
    );
    assert.equal(g.ok, false);
    assert.equal(g.ok === false && g.refus.code, "EXEMPLES_INSUFFISANTS");
    assert.match(
      g.ok === false ? g.refus.detail : "",
      /1 exemple\(s\) distinct\(s\) sur 2/,
      "la déduplication ne dit pas combien d'exemples étaient vraiment distincts",
    );
  });

  it("un jeton qui change d'un caractère suffit à faire deux exemplaires distincts", async () => {
    /*
     * La borne du critère, dite plutôt que supposée. Le plan est comparé mot
     * pour mot : deux relevés du même papier qui différeraient d'un seul jeton
     * — un accident d'OCR — compteraient pour deux.
     *
     * C'est le prix, et il est bien moins cher que l'inverse. Ce que la
     * déduplication protège est l'ossature, et l'ossature de deux relevés
     * presque identiques garde le nom du client — or ce nom est SANS
     * CONSÉQUENCE tant que la recette reste privée à l'organisation, puisque ce
     * client y est toujours le même. Le prix de l'erreur opposée, lui, est de
     * ne jamais générer un format d'achat.
     */
    const plan = FACTURE_A_TIMBRE();
    const presquePareil = FACTURE_A_TIMBRE().map((t, i) =>
      i === plan.length - 1 ? { ...t, text: `${t.text}.` } : t,
    );
    const attendu = { "totals.base_ht": dansLePied(plan, "1180,000") };
    const g = await proposerUneRecette(
      [
        { pieceId: "a", plan, attendu, droitsAttendus: {}, codesDeTaux: [] },
        { pieceId: "b", plan: presquePareil, attendu, droitsAttendus: {}, codesDeTaux: [] },
      ],
      EXIGENCES,
      PARAMETRES,
      CODES,
      modeleQuiRend(RECETTE_FACTURE_A),
    );
    assert.equal(g.ok, true, g.ok === false ? `${g.refus.code} : ${g.refus.detail}` : "");
  });
});
