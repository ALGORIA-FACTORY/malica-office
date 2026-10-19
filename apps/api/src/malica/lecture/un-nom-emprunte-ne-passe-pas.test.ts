import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { REFERENCES_QUI_TRANCHENT_LE_SENS } from "../../fabrique/recette.ts";
import { buildExtractFromTokenPlan } from "./read-piece.ts";
import type { PageToken } from "./token-plan.ts";
import type { VisionSelection } from "./vision.ts";

/**
 * ============================== UN NOM QUI RESSEMBLE N'EST PAS UN NOM
 *
 * `read-piece.ts` déduit le sens de la pièce — achat ou vente — de la
 * POSITION du matricule du dossier : côté émetteur, c'est une vente ; côté
 * client, un achat. Cette déduction a REMPLACÉ, le 5 octobre 2026, une
 * confiance au modèle qui s'était trompée : « vente » sur un achat, les deux
 * matricules inversés, faux et cohérent dans son inversion, donc invisible au
 * contrôle du destinataire.
 *
 * Elle lit ces deux matricules dans `references`, sous deux noms que l'invite
 * IMPOSE au modèle et ne VÉRIFIE pas. Un modèle qui rend « mf » désigne le bon
 * jeton, la citation pointe le bon endroit, la lecture est juste — et le sens
 * se perd en silence. Le dirigeant se voit reposer « achat ou vente ? » sur
 * une facture parfaitement lue, sans qu'aucun drapeau n'explique pourquoi.
 *
 * C'est la SIXIÈME fois dans ce dépôt qu'un nom composé librement casse un
 * appariement muet, après le rôle écrit en dur dans le journal (dix jours de
 * mesures perdues), le suffixe `+pdf-scan` collé au nom d'un modèle, un couple
 * de tarif introuvable, un tarif daté du lendemain et un champ de relations
 * renommé. À chaque fois : ça marche, et une mesure disparaît.
 *
 * ================================================= CE QUE CE BANC VERROUILLE
 *
 *   ① la NON-RÉGRESSION d'abord : une réponse correcte rend exactement ce
 *      qu'elle rendait — sens déduit, références gardées, aucun drapeau ;
 *   ② un nom emprunté au vocabulaire réservé ne passe plus en silence : il
 *      est REFUSÉ, pas renommé, et `SENS_A_CONFIRMER` dit lequel et pourquoi ;
 *   ③ une référence libre reste libre : « bon_de_commande » n'est pas refusé.
 *
 * Rien ici ne devine ce que le modèle voulait dire, et c'est le point : une
 * désignation qu'on retiendrait « puisqu'elle pointe le bon jeton » est
 * exactement la déduction au jugé que le produit a arrêté de faire.
 *
 * ======================================= ET LE NOM LUI-MÊME NE SE DÉPLACE PAS
 *
 * Les deux noms ne sont écrits nulle part dans ce fichier : ils viennent de
 * `REFERENCES_QUI_TRANCHENT_LE_SENS`, la même constante que `read-piece.ts`
 * importe désormais au lieu de ses deux littéraux. Les renommer d'un côté
 * casse la compilation, au lieu de casser un appariement.
 */

const [NOM_EMETTEUR, NOM_CLIENT] = REFERENCES_QUI_TRANCHENT_LE_SENS;

/** Le dossier, et son fournisseur. Deux matricules tunisiens complets. */
const MATRICULE_DOSSIER = "1876543W/A/M/000";
const MATRICULE_FOURNISSEUR = "0914089J/A/M/000";

const jeton = (ordinal: number, text: string): PageToken => ({
  page: 1,
  ordinal,
  text,
  x0: 0.1,
  y0: 0.1 + ordinal * 0.02,
  x1: 0.3,
  y1: 0.114 + ordinal * 0.02,
});

/**
 * Une pièce minimale : le matricule du FOURNISSEUR côté émetteur, celui du
 * DOSSIER côté client. La déduction doit donc dire « facture_achat ».
 */
const TOKENS: PageToken[] = [jeton(0, MATRICULE_FOURNISSEUR), jeton(1, MATRICULE_DOSSIER)];

const lire = (references: Record<string, { page: number; ordinal: number } | null>) =>
  buildExtractFromTokenPlan({
    tokens: TOKENS,
    selection: {
      issuer: null,
      document_date: null,
      currency: "TND",
      // Le modèle propose « vente ». Il a tort, et la déduction le sait quand
      // elle dispose des deux matricules : c'est elle qui tranche.
      document_kind: "facture_vente",
      lines: [],
      articles: [],
      other_charges: [],
      totals: { base_ht: null, vat: null, ttc: null },
      references,
      overall_confidence: 0.5,
    } as unknown as VisionSelection,
    decimals: 3,
    matriculeDossier: MATRICULE_DOSSIER,
  });

const EMETTEUR = { page: 1, ordinal: 0 };
const CLIENT = { page: 1, ordinal: 1 };

const sensAConfirmer = (r: ReturnType<typeof buildExtractFromTokenPlan>) =>
  r.flags.filter((f) => f.code === "SENS_A_CONFIRMER");

const references = (r: ReturnType<typeof buildExtractFromTokenPlan>) =>
  r.extract["references"] as Record<string, string>;

describe("① la non-régression : une réponse correcte ne change pas d'un cheveu", () => {
  const r = lire({ [NOM_EMETTEUR]: EMETTEUR, [NOM_CLIENT]: CLIENT });

  it("le sens est déduit, et il contredit le modèle", () => {
    assert.equal(r.extract["document_kind"], "facture_achat");
  });

  it("le drapeau dit la contradiction du modèle, pas un nom emprunté", () => {
    const sens = sensAConfirmer(r);
    assert.equal(sens.length, 1);
    assert.match(String(sens[0]?.detail), /c'est le matricule qui tranche/);
  });

  it("les deux références sont relues et gardées", () => {
    assert.equal(references(r)[NOM_EMETTEUR], MATRICULE_FOURNISSEUR);
    assert.equal(references(r)[NOM_CLIENT], MATRICULE_DOSSIER);
  });
});

describe("② un nom emprunté au vocabulaire réservé est refusé, et il se dit", () => {
  /*
   * « mf » est le sigle de « matricule_fiscal » ; « matricule_client » est un
   * sous-ensemble de « matricule_fiscal_client ». Aucun des deux n'est écrit
   * à la main nulle part : la règle les dérive des noms réservés.
   */
  const r = lire({ mf: EMETTEUR, matricule_client: CLIENT });

  it("le sens N'EST PAS déduit : rien ne remplace le matricule manquant", () => {
    assert.equal(r.extract["document_kind"], null);
  });

  it("chaque nom emprunté porte son propre SENS_A_CONFIRMER, avec son motif", () => {
    const motifs = sensAConfirmer(r).map((f) => String(f.detail));
    assert.equal(motifs.length, 3, motifs.join(" | "));
    assert.ok(
      motifs.some((m) => m.includes("« mf »")),
      motifs.join(" | "),
    );
    assert.ok(
      motifs.some((m) => m.includes("« matricule_client »")),
      motifs.join(" | "),
    );
  });

  it("le motif NOMME le nom attendu : qui écrit l'invite sait quoi corriger", () => {
    const motifs = sensAConfirmer(r).map((f) => String(f.detail));
    assert.ok(
      motifs.some((m) => m.includes(NOM_EMETTEUR)),
      motifs.join(" | "),
    );
  });

  it("la désignation n'est PAS retenue : on ne la renomme pas à la place du modèle", () => {
    assert.deepEqual(references(r), {});
  });

  it("la pièce est partielle : rien ne peut s'écrire sur un sens inconnu", () => {
    assert.equal(r.valid, false);
  });
});

describe("③ une référence libre reste libre", () => {
  const r = lire({
    [NOM_EMETTEUR]: EMETTEUR,
    [NOM_CLIENT]: CLIENT,
    bon_de_commande: EMETTEUR,
  });

  it("« bon_de_commande » passe, et sa valeur est relue au plan", () => {
    assert.equal(references(r)["bon_de_commande"], MATRICULE_FOURNISSEUR);
  });

  it("aucun drapeau d'emprunt n'est levé pour elle", () => {
    const motifs = sensAConfirmer(r).map((f) => String(f.detail));
    assert.ok(!motifs.some((m) => m.includes("bon_de_commande")), motifs.join(" | "));
  });

  it("le sens reste déduit malgré la référence libre", () => {
    assert.equal(r.extract["document_kind"], "facture_achat");
  });
});
