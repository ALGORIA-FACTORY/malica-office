/**
 * Le générateur de recettes, éprouvé — et aucun fournisseur payant appelé.
 *
 * Le modèle arrive par un port ; ici c'est un adaptateur SIMULÉ qui répond, et
 * c'est dit en toutes lettres pour qu'aucune mesure ne prenne ces épreuves
 * pour un relevé de qualité du modèle. Elles prouvent ce que le générateur
 * REFUSE, ce qu'il accepte, et sur quoi il se cale — pas que DeepSeek écrit
 * de bonnes recettes. Le vrai appel s'éprouve à la main
 * (`docs/fabrique-de-lecteurs/01-generer-une-recette.md`).
 *
 *   node --experimental-strip-types --env-file-if-exists=.env \
 *     --env-file-if-exists=.env.test --import ./src/garde-base-de-test.ts \
 *     --test src/fabrique/generateur.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PageToken, TokenRef } from "@malica/socle/ports/malica";

import {
  proposerUneRecette,
  VERSION_DU_GENERATEUR,
  type AppelDeGenerateur,
  type ExempleDApprentissage,
  type Generation,
  type InviteDeGeneration,
} from "./generateur.ts";
import type { ExigencesDeValidation } from "./recette-validateur.ts";
import { VERSION_DU_LANGAGE } from "./recette.ts";
import {
  FACTURE_A,
  FACTURE_A_AUTRE_CLIENT,
  FACTURE_A_AUTRES_VALEURS,
  FACTURE_A_SIX_LIGNES,
  FACTURE_ARABE,
} from "./signature-plans-synthetiques.ts";
import type { ParametresDeSignature } from "./signature.ts";

/**
 * Les réglages, posés à la main.
 *
 * En exécution ils viennent du référentiel, daté et surchargeable (R10) ; une
 * épreuve pure n'a pas de base, et les écrire ici ne les met pas dans le code
 * de production — c'est la même tenue que `signature.test.ts`.
 */
const PARAMETRES: ParametresDeSignature = {
  longueurMinimaleDAncre: 3,
  bandesParPage: 3,
  partMinimaleDuSens: 0.6,
  recouvrementDeLigne: 0.5,
  recouvrementDeColonne: 0.3,
  ancresEnRelationMax: 40,
};

/**
 * Les bornes du validateur, pour ce banc.
 *
 * `ancre_texte_min` vaut 2, comme au banc de l'interprète, et pour la même
 * raison : « HT » et « TTC » sont ce qui sépare les trois lignes du pied, qui
 * portent toutes le mot « Total ». Le défaut LIVRÉ vaut 3 et refuserait donc
 * la recette la plus ordinaire du produit ; l'épreuve qui suit le montre, et
 * le cabinet le change sans déploiement (R10).
 */
const EXIGENCES: ExigencesDeValidation = {
  ancre_texte_min: 2,
  selecteurs_max: 200,
  champs_max: 50,
  jetons_max: 12,
  rang_max: 50,
};

/**
 * Les codes que le pack rendrait, posés à la main.
 *
 * En exécution ils viennent de `ref.fiscal_charges` et `ref.tva_rates`, au
 * pack de l'organisation (`fabrique.codesDuReferentiel`). Les écrire ici ne
 * les met pas dans le code de production, et ce banc est pur — c'est la même
 * tenue que `PARAMETRES` et `EXIGENCES` juste au-dessus.
 *
 * Ils n'autorisent RIEN : ce sont les exemples qui bornent les codes d'une
 * proposition. Cette liste dit seulement au modèle dans quel ensemble fermé
 * ces codes vivent.
 */
const CODES_DU_PACK = { droits: ["DROIT_TIMBRE", "FODEC"], taux: ["TVA19", "TVA07"] };

/** Le jeton qui porte ce texte, dans ce plan — pour écrire un `attendu`. */
function ou(plan: readonly PageToken[], texte: string): TokenRef {
  const t = plan.find((x) => x.text === texte);
  assert.ok(t, `le plan synthétique ne porte pas « ${texte} »`);
  return { page: t.page, ordinal: t.ordinal };
}

/** Un adaptateur simulé : il rend toujours la même proposition. */
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

/** Garde la dernière invite reçue, pour éprouver ce que le modèle VOIT. */
function modeleQuiNote(recetteProposee: unknown): {
  appel: AppelDeGenerateur;
  vues: InviteDeGeneration[];
} {
  const vues: InviteDeGeneration[] = [];
  const rendre = modeleQuiRend(recetteProposee);
  return {
    vues,
    appel: (invite) => {
      vues.push(invite);
      return rendre(invite);
    },
  };
}

/**
 * Une recette juste pour le format A : le total HT, désigné par son libellé.
 *
 * « Total » est sur trois lignes du pied — HT, TVA, TTC —, donc l'ancre seule
 * ne suffit pas : c'est « HT » qui tranche, et le montant est le nombre qui
 * suit sur la même ligne.
 */
const RECETTE_HT = {
  version: VERSION_DU_LANGAGE,
  sens_de_lecture: "ltr",
  chiffres: "latins",
  ancres: {
    ht: {
      depuis: { genre: "ancre", motif: { genre: "exact", texte: "ht" } },
      prendre: { genre: "unique" },
    },
  },
  champs: {
    "totals.base_ht": {
      designation: {
        depuis: { genre: "voisin", de: "ht", direction: "apres" },
        ou: [{ genre: "forme", forme: "nombre" }],
        prendre: { genre: "premier" },
      },
      si_absent: "TOKEN_NOT_FOUND",
      si_ambigu: "DESIGNATION_AMBIGUE",
    },
  },
};

/**
 * La même recette, avec UNE chose changée — pour éprouver un refus précis.
 *
 * Un `structuredClone` typé sur le littéral refuserait d'ajouter une clé
 * absente de l'original, et c'est justement ce qu'une proposition fautive
 * fait. On descend donc le chemin à la main, sur une copie.
 */
function recetteAvec(chemin: readonly string[], valeur: unknown): unknown {
  const copie = structuredClone(RECETTE_HT) as Record<string, unknown>;
  let noeud: Record<string, unknown> = copie;
  for (const cle of chemin.slice(0, -1)) noeud = noeud[cle] as Record<string, unknown>;
  noeud[chemin[chemin.length - 1]!] = valeur;
  return copie;
}

/** Les exemples d'apprentissage du format A, avec leur désignation attendue. */
function exemplesDuFormatA(): ExempleDApprentissage[] {
  return [FACTURE_A(), FACTURE_A_AUTRE_CLIENT()].map((plan, i) => ({
    pieceId: `piece-${String(i)}`,
    plan,
    attendu: { "totals.base_ht": ou(plan, i === 0 ? "1180,000" : "708,000") },
  }));
}

async function generer(
  exemples: readonly ExempleDApprentissage[],
  proposition: unknown,
): Promise<Generation> {
  return proposerUneRecette(
    exemples,
    EXIGENCES,
    PARAMETRES,
    CODES_DU_PACK,
    modeleQuiRend(proposition),
  );
}

describe("le générateur de recettes", () => {
  /* ------------------------------------------- la reconnaissance en deux temps */

  it("refuse de travailler sur un exemple unique", async () => {
    const [un] = exemplesDuFormatA();
    const g = await generer([un!], RECETTE_HT);
    assert.equal(g.ok, false);
    assert.equal(g.ok === false && g.refus.code, "EXEMPLES_INSUFFISANTS");
  });

  it("deux exemplaires du MÊME document ne font pas deux exemples", async () => {
    /*
     * Le piège vaut d'être nommé : l'intersection de quelque chose avec
     * lui-même ne fait RIEN tomber. Deux copies d'une facture donnent une
     * « ossature » qui porte le nom du client, et le comptage naïf les
     * accepte.
     *
     * La déduplication porte sur l'empreinte de L'EXEMPLAIRE — le plan de
     * jetons, texte compris — et deux pièces différentes restent donc deux,
     * même quand elles ne diffèrent que par leurs montants.
     *
     * Ce commentaire a affirmé deux choses fausses en deux jours, et les deux
     * valent d'être nommées. Il a d'abord dit que la déduplication portait sur
     * l'empreinte de SIGNATURE et que « deux pièces différentes de même forme
     * restent deux » : c'était contradictoire, puisqu'une signature écarte tout
     * jeton portant un chiffre. Il a ensuite dit que le refus était juste et
     * qu'« il faut un autre client » : c'était pire, parce que sur une facture
     * d'ACHAT le client est toujours la même PME — aucun format d'achat
     * n'aurait jamais été généré. Le critère est le CONTENU du plan depuis le
     * 20 octobre 2026, et `une-facture-d-achat-se-genere.test.ts` mesure les
     * deux moitiés : la paire à client unique passe, les deux exemplaires du
     * même document ne passent pas.
     */
    const plan = FACTURE_A();
    const attendu = { "totals.base_ht": ou(plan, "1180,000") };
    const g = await generer(
      [
        { pieceId: "a", plan, attendu },
        { pieceId: "b", plan: FACTURE_A(), attendu },
      ],
      RECETTE_HT,
    );
    assert.equal(g.ok, false);
    assert.equal(g.ok === false && g.refus.code, "EXEMPLES_INSUFFISANTS");
    assert.match(
      g.ok === false ? g.refus.detail : "",
      /1 exemple\(s\) distinct\(s\) sur 2/,
      "la déduplication ne dit pas combien d'exemples étaient vraiment distincts",
    );
  });

  it("refuse deux exemples qui ne partagent aucune ancre", async () => {
    const fr = FACTURE_A();
    const ar = FACTURE_ARABE();
    const g = await generer(
      [
        { pieceId: "fr", plan: fr, attendu: { "totals.base_ht": ou(fr, "1180,000") } },
        { pieceId: "ar", plan: ar, attendu: { "totals.base_ht": { page: 1, ordinal: 0 } } },
      ],
      RECETTE_HT,
    );
    assert.equal(g.ok, false);
    assert.equal(g.ok === false && g.refus.code, "AUCUNE_OSSATURE");
  });

  it("refuse des exemples qui n'attendent rien, et un champ hors contrat", async () => {
    /*
     * Sans attente, il n'y a rien à apprendre — et surtout, l'épreuve de
     * reproduction (porte ④) passerait toute seule : zéro écart sur zéro
     * attente. Une recette qui ne désigne rien franchirait alors les quatre
     * portes et arriverait candidate.
     */
    const vides = exemplesDuFormatA().map((e) => ({ ...e, attendu: {} }));
    const rien = await generer(vides, RECETTE_HT);
    assert.equal(rien.ok === false && rien.refus.code, "AUCUNE_DESIGNATION_ATTENDUE");

    const hors = exemplesDuFormatA().map((e) => ({
      ...e,
      attendu: { inventé: e.attendu["totals.base_ht"]! },
    }));
    const g = await generer(hors, RECETTE_HT);
    assert.equal(g.ok === false && g.refus.code, "AUCUNE_DESIGNATION_ATTENDUE");
    assert.match(g.ok === false ? g.refus.detail : "", /hors du contrat/);
  });

  /* --------------------------------------------------- la barrière R3 */

  it("refuse un texte d'ancre qui n'est pas dans le vocabulaire commun", async () => {
    /*
     * C'est la barrière posée CÔTÉ GÉNÉRATION. « DREAM » est le nom du client
     * du premier exemple : il est sur la pièce, il a l'air d'une ancre, et il
     * n'est pas dans l'ossature puisque le second exemple ne le porte pas.
     * Une recette calée dessus ne reconnaîtrait plus jamais qu'une facture.
     */
    const propose = recetteAvec(["ancres", "ht"], {
      depuis: { genre: "ancre", motif: { genre: "exact", texte: "DREAM" } },
      prendre: { genre: "unique" },
    });
    const g = await generer(exemplesDuFormatA(), propose);
    assert.equal(g.ok, false);
    assert.equal(g.ok === false && g.refus.code, "ANCRE_HORS_VOCABULAIRE");
    assert.match(g.ok === false ? g.refus.detail : "", /DREAM/);
  });

  it("refuse un montant recopié dans la recette, où qu'il soit", async () => {
    /*
     * La faute que R3 vise vraiment : le modèle a LU « 1180,000 » et l'a
     * écrit dans la recette, dans une étendue plutôt que dans une ancre.
     * `cleDAncre` rend `null` dès qu'un texte porte un chiffre, donc ce cas
     * tombe avant même d'être comparé à l'ossature — et le parcours des
     * motifs ne se limite pas aux ancres de premier niveau.
     */
    const propose = recetteAvec(["champs", "totals.base_ht", "designation", "etendre"], {
      genre: "jusqu_a",
      motif: { genre: "exact", texte: "1180,000" },
    });
    const g = await generer(exemplesDuFormatA(), propose);
    assert.equal(g.ok, false);
    assert.equal(g.ok === false && g.refus.code, "ANCRE_HORS_VOCABULAIRE");
    assert.match(g.ok === false ? g.refus.detail : "", /1180,000/);
  });

  /* ------------------------------------------------- le validateur strict */

  it("appelle le validateur strict et rend ses refus tels quels", async () => {
    // Un champ hors du contrat de désignation : c'est le validateur qui parle.
    const propose = recetteAvec(
      ["champs", "totals.inventé"],
      structuredClone(RECETTE_HT.champs["totals.base_ht"]),
    );
    const g = await generer(exemplesDuFormatA(), propose);
    assert.equal(g.ok, false);
    assert.equal(g.ok === false && g.refus.code, "RECETTE_INVALIDE");
    assert.deepEqual(
      g.ok === false ? (g.refus.refusDuValidateur ?? []).map((r) => r.code) : [],
      ["CHAMP_INCONNU"],
      "le refus du validateur n'est pas rendu tel quel : on ne saurait pas quoi corriger",
    );
  });

  it("une borne d'ancre À 3 refuse « Total HT », et c'est pourquoi le défaut n'est plus 3", async () => {
    /*
     * Un constat, pas un défaut du générateur — et la borne passée ici est un
     * LITTÉRAL de banc, pas le défaut livré.
     *
     * `ancre_texte_min` était livré à 3 par `20261020090000`, qui le disait
     * lui-même « un point de départ à mesurer, pas un relevé ». Il a été
     * mesuré, et il est livré à **2** depuis `20261020200000` : la longueur ne
     * prédit pas ce qu'une ancre attrape — « HT » en `exact` attrape un jeton,
     * « Total » en attrape trois pour cinq caractères. La limite n° 4 de
     * `docs/fabrique-de-lecteurs/02-ce-qui-est-livre.md` porte le relevé.
     *
     * Ce que cette épreuve fige n'a pas changé : À 3, aucune recette ne peut
     * désigner le total hors taxe de ce format, parce que ce qui sépare les
     * trois lignes du pied — « HT », « TTC » — fait deux caractères. Elle dit
     * donc ce que le défaut déplaçait, et un cabinet qui remonterait sa borne
     * à 3 (R10) sait ce qu'il perdrait.
     */
    const g = await proposerUneRecette(
      exemplesDuFormatA(),
      { ...EXIGENCES, ancre_texte_min: 3 },
      PARAMETRES,
      CODES_DU_PACK,
      modeleQuiRend(RECETTE_HT),
    );
    assert.equal(g.ok, false);
    assert.deepEqual(g.ok === false ? (g.refus.refusDuValidateur ?? []).map((r) => r.code) : [], [
      "ANCRE_TROP_COURTE",
    ]);
  });

  it("une réponse qui n'est pas un objet JSON se dit, et garde son journal", async () => {
    const g = await generer(exemplesDuFormatA(), "pas un objet");
    assert.equal(g.ok, false);
    assert.equal(g.ok === false && g.refus.code, "REPONSE_ILLISIBLE");
    assert.equal(
      g.ok === false && g.journal?.modele,
      "modele-simule",
      "un appel refusé perd son journal : il a pourtant coûté",
    );
  });

  /* ------------------------------------- elle redonne ses propres exemples */

  it("refuse une recette qui ne redonne pas ce que ses exemples attendent", async () => {
    const exemples = exemplesDuFormatA();
    // On ment sur ce qui est attendu : la recette est juste, l'attente non.
    const faux = exemples.map((e) => ({
      ...e,
      attendu: { "totals.ttc": e.attendu["totals.base_ht"]! },
    }));
    const g = await generer(faux, RECETTE_HT);
    assert.equal(g.ok, false);
    assert.equal(g.ok === false && g.refus.code, "NE_REPRODUIT_PAS_SES_EXEMPLES");
  });

  /* ------------------------------------------------------- ce qui passe */

  it("accepte une recette juste, et en garde la provenance", async () => {
    const g = await generer(exemplesDuFormatA(), RECETTE_HT);
    assert.equal(g.ok, true, g.ok === false ? g.refus.detail : "");
    if (!g.ok) return;

    assert.match(g.empreinte, /^[0-9a-f]{64}$/, "l'empreinte n'a pas la forme que la base exige");
    assert.equal(g.provenance.generateur, VERSION_DU_GENERATEUR);
    assert.equal(g.provenance.langage, VERSION_DU_LANGAGE);
    assert.equal(g.provenance.modele, "modele-simule");
    assert.equal(g.provenance.role, "generateur");
    assert.deepEqual(g.provenance.pieces, ["piece-0", "piece-1"]);
    assert.ok(g.provenance.ossature.includes("total"), "l'ossature ne porte pas « total »");
    assert.ok(
      !g.provenance.ossature.includes("dream"),
      "le nom du client est dans l'ossature : les exemples ne le font pas tomber",
    );
  });

  it("une facture longue reste le même format : six lignes passent", async () => {
    /*
     * Le piège que l'un des prédécesseurs a trouvé : une facture de six lignes
     * refusée au client qui commande beaucoup. Ici, elle sert d'exemple
     * d'apprentissage à côté d'une facture de deux lignes, et la recette doit
     * tenir sur les deux — un pied qui descend n'est pas un autre format.
     */
    const court = FACTURE_A();
    const long = FACTURE_A_SIX_LIGNES();
    const g = await generer(
      [
        { pieceId: "court", plan: court, attendu: { "totals.base_ht": ou(court, "1180,000") } },
        { pieceId: "long", plan: long, attendu: { "totals.base_ht": ou(long, "6600,000") } },
      ],
      RECETTE_HT,
    );
    assert.equal(g.ok, true, g.ok === false ? g.refus.detail : "");
  });

  /* ------------------------------------------- ce que le modèle a le droit de voir */

  it("le modèle ne voit aucune valeur de la pièce", async () => {
    /*
     * R3, l'autre moitié : si une valeur entre dans l'invite, le modèle peut
     * la recopier de bonne foi, et le refus d'ossature ne serait plus qu'un
     * filet. On vérifie que les montants, dates et numéros des exemples
     * n'apparaissent nulle part dans ce qu'on lui envoie.
     */
    const { appel, vues } = modeleQuiNote(RECETTE_HT);
    await proposerUneRecette(exemplesDuFormatA(), EXIGENCES, PARAMETRES, CODES_DU_PACK, appel);
    const envoye = vues.map((v) => `${v.consigne}\n${v.observation}`).join("\n");
    for (const valeur of [
      "1180,000",
      "224,200",
      "1404,200",
      "FA-2026-118",
      "04/10/2026",
      "DREAM",
      "BARAKA",
    ]) {
      assert.ok(
        !envoye.includes(valeur),
        `l'invite porte la valeur « ${valeur} » : le modèle peut la recopier`,
      );
    }
    assert.ok(
      envoye.includes("total"),
      "l'invite ne porte pas l'ossature : il ne peut rien ancrer",
    );
  });

  it("l'ossature de deux factures du même client garde encore son nom", async () => {
    /*
     * CE QUE LE GÉNÉRATEUR NE PEUT PAS FAIRE, écrit comme une épreuve pour
     * qu'on ne l'oublie pas. Deux exemplaires DIFFÉRENTS mais du même client
     * partagent son nom : il reste dans l'ossature, et une recette calée
     * dessus passe toutes les portes. Le minimum de deux exemples fait tomber
     * ce qui VARIE entre eux, pas ce qui est constant par hasard.
     *
     * La conséquence est opérationnelle et elle est dite au rapport : le choix
     * des exemples est un acte d'expert, pas une formalité. Aucun code ne
     * remplace deux clients différents.
     */
    const a = FACTURE_A();
    const b = FACTURE_A_AUTRES_VALEURS();
    const avecClient = recetteAvec(["ancres", "client"], {
      depuis: { genre: "ancre", motif: { genre: "exact", texte: "DREAM" } },
      prendre: { genre: "premier" },
    }) as Record<string, Record<string, unknown>>;
    avecClient["ancres"]!["ht"] = {
      depuis: { genre: "ancre", motif: { genre: "exact", texte: "ht" } },
      ou: [{ genre: "meme_colonne", que: "client" }],
      prendre: { genre: "unique" },
    };
    const propose: unknown = avecClient;
    const g = await generer(
      [
        { pieceId: "a", plan: a, attendu: { "totals.base_ht": ou(a, "1180,000") } },
        { pieceId: "b", plan: b, attendu: { "totals.base_ht": ou(b, "3940,000") } },
      ],
      propose,
    );
    assert.notEqual(
      g.ok === false ? g.refus.code : null,
      "ANCRE_HORS_VOCABULAIRE",
      "le nom du client est tombé : l'épreuve ne décrit plus la limite qu'elle documente",
    );
  });
});
