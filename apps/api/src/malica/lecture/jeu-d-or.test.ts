import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { repairArticles } from "./article-repair.ts";
import { JEU_D_OR, type CasDOr } from "./jeu-d-or.ts";
import { buildExtractFromTokenPlan } from "./read-piece.ts";
import { recollerLesMilliers } from "./recoller-les-milliers.ts";

/**
 * Le banc du jeu d'or — la relecture, sur de vraies pièces.
 *
 * ================================================================= POURQUOI
 *
 * Trois seuils ont été fixés le 5 octobre 2026, et ce fichier les tient :
 *
 *   — 98 % des montants clés justes ;
 *   — 100 % des incohérences signalées ;
 *   — ZÉRO montant amputé.
 *
 * Le troisième est le plus important, et c'est le seul des trois qu'aucun test
 * du dépôt ne couvrait. Un montant amputé — « 2 800,000 » lu « 2,000 » — a
 * toutes les apparences d'un montant : il est net, il a une seule lecture, il
 * franchit tous les gardes conçus contre l'ambiguïté. Il ne se voit qu'en
 * comparant à ce que le papier IMPRIME, donc ici, et nulle part ailleurs.
 *
 * ========================================================== CE QU'IL PROUVE
 *
 * Ce banc joue la désignation ENREGISTRÉE et vérifie les valeurs relues. Il
 * prouve donc la relecture, pas la désignation : il est pur, sans modèle, et
 * tourne dans `npm test`. Que le modèle émette bien cette désignation est une
 * garantie distincte, mesurée par l'épreuve réelle contre le vrai modèle.
 *
 * Les deux sont nécessaires. Une relecture juste sur une désignation fausse
 * rend un montant faux, et c'est exactement ce qui s'est produit le 4 octobre.
 */

/** Lit un chemin « articles[0].total_ht » dans l'extrait rendu. */
function auChemin(extrait: Record<string, unknown>, chemin: string): unknown {
  let courant: unknown = extrait;
  for (const bout of chemin.split(".")) {
    const indexe = bout.match(/^([A-Za-z_]+)\[(\d+)\]$/);
    if (indexe) {
      const tableau = (courant as Record<string, unknown>)?.[indexe[1]!];
      courant = Array.isArray(tableau) ? tableau[Number(indexe[2])] : undefined;
    } else {
      courant = (courant as Record<string, unknown>)?.[bout];
    }
    if (courant === undefined || courant === null) return courant ?? null;
  }
  return courant;
}

/**
 * Un montant est-il l'amputation d'un autre ?
 *
 * Un montant coupé par l'espace des milliers a DEUX moitiés, et le
 * désignateur peut citer l'une ou l'autre. Les deux formes ont été mesurées,
 * et il a fallu six semaines pour que la seconde se voie :
 *
 *   PRÉFIXE   « 2 800,000 » cité « 2 »       → 2.000  pour 2800.000
 *             4 octobre 2026, facture de loyer. La partie entière lue est un
 *             préfixe strict de l'attendue, et les décimales sont nulles —
 *             le premier jeton, remis à l'échelle de la devise.
 *
 *   SUFFIXE   « 5 650,000 » cité « 650,000 » → 650.000 pour 5650.000
 *             18 octobre 2026, facture arabe. La partie entière lue est un
 *             suffixe strict de l'attendue, et les décimales sont INTACTES —
 *             ce sont celles du dernier jeton, qui les porte.
 *
 * Le détecteur ne connaissait que la première : « 5650 ».startsWith(« 650 »)
 * est faux, donc le défaut du 18 octobre aurait été rapporté « montant faux »
 * et non « montant amputé ». Le banc aurait dit le quoi, pas le pourquoi.
 *
 * On ne se contente pas de « la valeur diffère » : nommer l'amputation permet
 * au banc de dire QUEL défaut il a trouvé, et c'est ce qui distingue un échec
 * exploitable d'un échec à instruire.
 */
function estAmpute(lu: string, attendu: string): boolean {
  const [eLu = "", dLu = ""] = lu.split(".");
  const [eAttendu = "", dAttendu = ""] = attendu.split(".");
  if (lu === attendu || eLu === eAttendu || eLu.length === 0) return false;
  // Le premier jeton : il perd les décimales du dernier, donc les siennes
  // sont nulles. Sans cette condition, « 2.800 » — l'autre lecture du
  // séparateur, qui relève de l'ambiguïté — serait appelé une coupure.
  if (eAttendu.startsWith(eLu) && /^0*$/.test(dLu)) return true;
  // Le dernier jeton : il emporte les décimales du montant avec lui.
  return eAttendu.endsWith(eLu) && dLu === dAttendu;
}

const estUnMontant = (chemin: string): boolean =>
  /total_ht|unit_price|base_ht|vat|ttc|amount|quantity/.test(chemin);

function jouer(cas: CasDOr) {
  return buildExtractFromTokenPlan({
    tokens: cas.tokens,
    selection: cas.designation,
    decimals: cas.decimales,
    matriculeDossier: cas.matriculeDossier,
  });
}

for (const cas of JEU_D_OR) {
  describe(`jeu d'or — ${cas.nom}`, () => {
    const lu = jouer(cas);
    const montants = Object.keys(cas.attendu).filter(estUnMontant);

    it("provenance nommée : un cas d'or sans original n'est pas vérifiable", () => {
      assert.match(cas.provenance, /\S/);
      assert.ok(cas.tokens.length > 0, "un cas d'or porte le plan de jetons réel");
    });

    it("aucun montant amputé — le défaut du 4 octobre 2026", () => {
      const amputes = montants
        .map((chemin) => ({
          chemin,
          lu: auChemin(lu.extract, chemin),
          attendu: cas.attendu[chemin],
        }))
        .filter(
          (m) =>
            typeof m.lu === "string" && typeof m.attendu === "string" && estAmpute(m.lu, m.attendu),
        )
        .map((m) => `${m.chemin} : lu ${m.lu}, imprimé ${cas.imprime[m.chemin] ?? m.attendu}`);
      assert.deepEqual(amputes, [], `montants amputés :\n  ${amputes.join("\n  ")}`);
    });

    it("tous les montants clés sont justes", () => {
      const faux = montants
        .map((chemin) => ({
          chemin,
          lu: auChemin(lu.extract, chemin),
          attendu: cas.attendu[chemin],
        }))
        .filter((m) => m.lu !== m.attendu)
        .map(
          (m) => `${m.chemin} : lu ${JSON.stringify(m.lu)}, attendu ${JSON.stringify(m.attendu)}`,
        );
      assert.deepEqual(faux, [], `montants faux :\n  ${faux.join("\n  ")}`);
    });

    it("les champs non chiffrés aussi — la date en lettres comprise", () => {
      for (const chemin of Object.keys(cas.attendu).filter((c) => !estUnMontant(c))) {
        assert.equal(
          auChemin(lu.extract, chemin),
          cas.attendu[chemin],
          `${chemin} — imprimé « ${cas.imprime[chemin] ?? "?"} »`,
        );
      }
    });

    it("une facture qui boucle ne porte aucune incohérence arithmétique", () => {
      /*
       * Ce cas boucle au millime, timbre compris. S'il remontait une
       * incohérence, ce serait l'équation du produit qui serait fausse — et
       * c'était le cas : « TTC = HT + TVA » oubliait les droits hors TVA, donc
       * toute facture tunisienne portant un timbre violait la contrainte.
       *
       * Un garde qui crie sur une pièce valide est pire qu'un garde muet : on
       * apprend à l'ignorer.
       */
      const incoherences = lu.flags.filter((f) => f.code === "ARITHMETIQUE_INCOHERENTE");
      assert.deepEqual(
        incoherences.map((f) => `${f.field} : ${f.detail ?? ""}`),
        [],
      );
    });

    it("la lecture est retenue : une pièce d'or ne sort pas invalide", () => {
      assert.equal(lu.valid, true, `drapeaux : ${JSON.stringify(lu.flags)}`);
    });
  });
}

/**
 * ============== LE DÉSIGNATEUR N'A CITÉ QUE LES DÉSIGNATIONS, ET APRÈS ?
 *
 * 19 octobre 2026. Sur une facture de quatre lignes photographiée par le
 * dirigeant, l'écran « ce que j'ai lu, ligne par ligne » rendait les quatre
 * désignations et rien d'autre : ni quantité, ni prix unitaire, ni montant de
 * ligne — le pied de facture, lui, était juste.
 *
 * La cause est mesurée, et elle n'est pas dans l'écran. Les pièces réelles de
 * la base portent, pour chacune de ces colonnes, le drapeau
 * `MISSING_CITATION` : le désignateur a rendu `null`. La consigne les demande
 * pourtant, et impose même la méthode (« repère d'abord la ligne d'ENTÊTES »).
 * C'est donc une désobéissance du modèle — et c'est exactement le cas que
 * `article-repair.ts` existe pour rattraper, à partir du plan de jetons et de
 * la géométrie du tableau imprimé.
 *
 * Il ne rattrapait rien. Ce banc le tient désormais sur une pièce RÉELLE.
 *
 * L'ordre joué est celui de la production : `relever()` recolle les milliers
 * AVANT de désigner, donc le plan que la réparation voit porte « 2 800,000 »
 * d'un seul jeton. Jouer le plan brut ferait mesurer une chaîne qui n'existe
 * pas.
 */
for (const cas of JEU_D_OR) {
  describe(`jeu d'or — ${cas.nom} — colonnes d'articles non citées`, () => {
    const plan = recollerLesMilliers(cas.tokens);
    const sansColonnes = cas.designation.articles.map((a) => ({
      designation: a.designation,
      quantity: null,
      unit_price_ht: null,
      unit_price_ttc: null,
      total_ht: null,
      tax_code: a.tax_code,
    }));
    const lu = buildExtractFromTokenPlan({
      tokens: plan,
      selection: { ...cas.designation, articles: repairArticles(plan, sansColonnes) },
      decimals: cas.decimales,
      matriculeDossier: cas.matriculeDossier,
    });

    it("les colonnes du tableau reviennent du plan de jetons, et sont justes", () => {
      const cherches = Object.keys(cas.attendu).filter((c) => c.startsWith("articles["));
      assert.ok(cherches.length > 0, "le cas doit attendre au moins une colonne d'article");
      const faux = cherches
        .map((chemin) => ({
          chemin,
          lu: auChemin(lu.extract, chemin),
          attendu: cas.attendu[chemin],
        }))
        .filter((m) => m.lu !== m.attendu)
        .map(
          (m) =>
            `${m.chemin} : lu ${JSON.stringify(m.lu)}, imprimé « ${cas.imprime[m.chemin] ?? m.attendu} »`,
        );
      assert.deepEqual(faux, [], `colonnes perdues ou fausses :\n  ${faux.join("\n  ")}`);
    });

    it("et aucune colonne que la pièce n'imprime pas n'est inventée (R2)", () => {
      // La facture de loyer ne porte pas de colonne « P.U. TTC » : elle doit
      // rester vide. Une réparation qui remplirait tout serait pire que rien.
      const articles = (lu.extract as { articles: Array<Record<string, string | null>> }).articles;
      for (const [i, a] of articles.entries()) {
        assert.equal(a["unit_price_ttc"], null, `articles[${i}].unit_price_ttc inventé`);
      }
    });
  });
}

describe("le banc du jeu d'or reconnaît ce qu'il cherche", () => {
  /*
   * Un banc qui ne sait pas échouer ne prouve rien. On exerce donc le
   * détecteur d'amputation sur les valeurs exactes du 4 octobre.
   */
  it("« 2.000 » est l'amputation de « 2800.000 »", () => {
    assert.equal(estAmpute("2.000", "2800.000"), true);
  });

  it("« 3.000 » est l'amputation de « 3020.000 »", () => {
    assert.equal(estAmpute("3.000", "3020.000"), true);
  });

  it("un montant juste n'est pas une amputation", () => {
    assert.equal(estAmpute("220.000", "220.000"), false);
    assert.equal(estAmpute("573.800", "573.800"), false);
  });

  it("un montant simplement FAUX n'est pas appelé amputation", () => {
    // 2 900 au lieu de 2 800 est une erreur de lecture, pas une troncature :
    // confondre les deux ferait dire au banc n'importe quoi dans son rapport.
    assert.equal(estAmpute("2900.000", "2800.000"), false);
  });

  it("« 650.000 » est l'amputation de « 5650.000 » — la forme SUFFIXE", () => {
    // Mesuré le 18 octobre 2026 sur la facture arabe, trois totaux sur trois.
    assert.equal(estAmpute("650.000", "5650.000"), true);
    assert.equal(estAmpute("73.500", "1073.500"), true);
    assert.equal(estAmpute("724.500", "6724.500"), true);
  });

  it("un suffixe dont les décimales diffèrent n'est pas une amputation", () => {
    // Le dernier jeton emporte les décimales du montant : si elles ne sont
    // pas celles du papier, c'est une autre faute, et il faut le dire.
    assert.equal(estAmpute("650.100", "5650.000"), false);
  });

  it("une amputation qui garderait des décimales n'en est pas une", () => {
    // « 2.800 » n'est pas le premier jeton de « 2 800,000 » : c'est l'autre
    // lecture du séparateur, qui relève de l'ambiguïté et non de la coupure.
    assert.equal(estAmpute("2.800", "2800.000"), false);
  });
});
