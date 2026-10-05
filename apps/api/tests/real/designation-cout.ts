/**
 * Ce que coûte la désignation, et ce qu'elle vaut — modèle par modèle.
 *
 * ================================================================= POURQUOI
 *
 * Relevé le 5 octobre 2026 dans `agents.agent_runs` : la désignation par
 * `deepseek-reasoner` coûte 0,0182 $ et prend 36 472 ms par appel, parce que
 * le raisonneur produit 9 022 jetons de raisonnement pour rendre une vingtaine
 * de `page/ordinal`. Quatre fois le budget visé, et trente-six secondes
 * d'attente pour quelqu'un qui tient son téléphone.
 *
 * Changer de modèle sur une intuition de prix serait une faute : un modèle
 * moins cher qui désigne mal rend des montants faux, et un montant faux coûte
 * infiniment plus qu'un appel. Cette épreuve mesure donc les quatre grandeurs
 * ensemble, sur les MÊMES pièces, et la première est la justesse.
 *
 * ================================================= CE QU'ELLE MESURE, ET COMMENT
 *
 * Le jeu d'or porte, pour chaque pièce réelle, la désignation ATTENDUE —
 * champ par champ, avec sa plage de jetons. On compare donc la réponse du
 * modèle à cette attente, et non à une impression de qualité.
 *
 *   champs justes          la désignation vise le bon jeton, plage comprise
 *   ERREURS SILENCIEUSES   le modèle désigne un jeton qui existe, mais pas le
 *                          bon : la valeur relue sera nette, plausible, fausse
 *   champs manqués         le modèle rend null là où la pièce porte la valeur
 *   latence, coût          lus sur l'appel, au tarif de `agents.model_pricing`
 *
 * L'erreur silencieuse est la seule qui compte vraiment. C'est elle qui a
 * coûté le 4 octobre : « 2 800,000 » lu « 2,000 » n'a levé aucun drapeau,
 * parce qu'un montant tronqué n'est pas ambigu.
 *
 * ========================================================================= USAGE
 *
 *   node --experimental-strip-types --env-file=apps/api/.env \
 *     apps/api/tests/real/designation-cout.ts [modele...]
 *
 * Sans argument : `deepseek-reasoner` (ce qui tourne aujourd'hui) puis
 * `deepseek-chat` (le candidat sans raisonnement). Le modèle visé à terme est
 * `qwen3.8-flash`, qui voit l'image — il entrera ici quand son tarif sera en
 * base (R8) et que le client saura l'appeler.
 */

import { callDeepSeek, type DeepSeekRole } from "../../src/malica/conseil/deepseek.ts";
import { buildExtractFromTokenPlan } from "../../src/malica/lecture/read-piece.ts";
import { JEU_D_OR, type CasDOr } from "../../src/malica/lecture/jeu-d-or.ts";
import {
  parseJsonLoose,
  selectionDepuisReponse,
  SYSTEM_SELECT,
} from "../../src/malica/lecture/vision.ts";
import type { PageToken } from "../../src/malica/lecture/token-plan.ts";

/** Les tarifs, en dollars par million de jetons. Doivent refléter `agents.model_pricing`. */
const TARIFS: Record<string, { entree: number; sortie: number; role: DeepSeekRole }> = {
  "deepseek-reasoner": { entree: 0.56, sortie: 1.68, role: "reasoner" },
  "deepseek-chat": { entree: 0.27, sortie: 1.1, role: "chat" },
};

/*
 * Les DEUX orthographes de la borne de fin, et il faut les deux.
 *
 * Le modèle rend du JSON, donc `ordinal_end`. Le jeu d'or porte une
 * `VisionSelection` TypeScript, donc `ordinalEnd`. Ne lire que l'une faisait
 * perdre la plage du côté ATTENDU, et cette épreuve rapportait onze erreurs
 * silencieuses là où les modèles avaient raison.
 *
 * Mesurer avec un instrument faux est exactement le défaut que ce dépôt
 * cherche à éliminer, et il s'est produit ici, dans l'instrument même.
 */
interface Ref {
  page?: number;
  ordinal?: number;
  ordinal_end?: number | null;
  ordinalEnd?: number | null;
}

const finDe = (r: Ref): number | null => {
  const brut = typeof r.ordinal_end === "number" ? r.ordinal_end : r.ordinalEnd;
  return typeof brut === "number" && brut > (r.ordinal ?? 0) ? brut : null;
};

/** La désignation, aplatie en chemins, pour se comparer champ à champ. */
/*
 * Deux champs sont EXCLUS de la comparaison, et il faut dire pourquoi.
 *
 * `label` est du texte libre que le modèle recompose : « TVA 19 % » vaut
 * « TVA 19% », et exiger l'orthographe transformerait une épreuve de justesse
 * en épreuve de typographie.
 *
 * `overall_confidence` est la confiance que le modèle s'accorde. Tout ce dépôt
 * repose sur l'idée inverse : la confiance qui vaut est celle que donne
 * l'arithmétique de la facture, parce qu'elle est vérifiable. Comparer celle du
 * modèle à une valeur attendue n'aurait aucun sens.
 */
const HORS_MESURE = /(^|.)(label|overall_confidence)$/;

function aplatir(o: unknown, prefixe = ""): Map<string, Ref | null> {
  const sortie = new Map<string, Ref | null>();
  const visiter = (v: unknown, chemin: string): void => {
    if (v === null || v === undefined) {
      if (chemin) sortie.set(chemin, null);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((e, i) => visiter(e, `${chemin}[${i}]`));
      return;
    }
    if (typeof v === "object") {
      const obj = v as Record<string, unknown>;
      // Une référence de jeton, et non un objet à parcourir.
      if (typeof obj["ordinal"] === "number") {
        sortie.set(chemin, obj as Ref);
        return;
      }
      for (const [k, e] of Object.entries(obj)) visiter(e, chemin ? `${chemin}.${k}` : k);
      return;
    }
    /*
     * Les scalaires comptent aussi, et on les a d'abord ignorés.
     *
     * `document_kind` décide du SENS de la pièce : une facture d'achat lue
     * comme une vente inverse l'émetteur et le client, donc le contrôle du
     * destinataire compare la mauvaise partie. C'est la plus grave des erreurs
     * silencieuses, et l'instrument ne la voyait pas.
     */
    if (typeof v === "string" || typeof v === "number")
      sortie.set(chemin, { scalaire: v } as never);
  };
  visiter(o, prefixe);
  for (const chemin of [...sortie.keys()]) if (HORS_MESURE.test(chemin)) sortie.delete(chemin);
  return sortie;
}

const memeRef = (a: Ref | null, b: Ref | null): boolean => {
  if (a === null || b === null) return a === b;
  const sa = (a as { scalaire?: unknown }).scalaire;
  const sb = (b as { scalaire?: unknown }).scalaire;
  if (sa !== undefined || sb !== undefined) return sa === sb;
  return a.page === b.page && a.ordinal === b.ordinal && finDe(a) === finDe(b);
};

function planTexte(tokens: readonly PageToken[]): string {
  return tokens
    .map(
      (t) =>
        `${t.page}.${t.ordinal}\t${t.x0.toFixed(3)},${t.y0.toFixed(3)},${t.x1.toFixed(3)},${t.y1.toFixed(3)}\t${t.text}`,
    )
    .join("\n");
}

async function mesurer(cas: CasDOr, modele: string) {
  const tarif = TARIFS[modele];
  if (!tarif) throw new Error(`aucun tarif connu pour ${modele} — ajoutez-le, ne devinez pas`);

  const res = await callDeepSeek({
    apiKey: process.env["DEEPSEEK_API_KEY"] ?? "",
    role: tarif.role,
    signal: AbortSignal.timeout(300_000),
    messages: [
      { role: "system", content: SYSTEM_SELECT },
      {
        role: "user",
        content: `DOSSIER : ALGORIA FACTORY SUARL — matricule fiscal 1876543W/A/M/000.

Tiers déjà enregistrés pour ce dossier :
(aucun)

Codes de taux autorisés :
TVA19 — TVA 19 % (0.19)
TVA13 — TVA 13 % (0.13)
TVA7 — TVA 7 % (0.07)
TVA0 — Exonéré (0)

Codes de droits hors TVA autorisés :
DROIT_TIMBRE — Droit de timbre

Plan de tokens — une ligne par mot, colonnes séparées par une tabulation :
page.ordinal\tx0,y0,x1,y1\ttexte
Les coordonnées sont normalisées entre 0 et 1, l'origine en haut à gauche.

${planTexte(cas.tokens)}`,
      },
    ],
  });

  const rendu = aplatir(parseJsonLoose(res.answer));
  const attendu = aplatir(cas.designation);

  let justes = 0;
  const silencieuses: string[] = [];
  const manques: string[] = [];
  const enTrop: string[] = [];

  for (const [chemin, ref] of attendu) {
    const vu = rendu.get(chemin) ?? null;
    if (memeRef(ref, vu)) {
      justes++;
      continue;
    }
    if (ref !== null && vu === null) {
      manques.push(chemin);
    } else if (ref === null && vu !== null) {
      // La pièce ne porte pas ce champ, et le modèle a désigné quelque chose :
      // la valeur relue existera et sera fausse. C'est une erreur silencieuse.
      silencieuses.push(`${chemin} (la pièce ne le porte pas, désigné ${vu.ordinal})`);
    } else if (ref !== null && vu !== null) {
      silencieuses.push(
        (ref as { scalaire?: unknown }).scalaire !== undefined ||
          (vu as { scalaire?: unknown }).scalaire !== undefined
          ? `${chemin} : attendu ${JSON.stringify((ref as { scalaire?: unknown }).scalaire)}, rendu ${JSON.stringify((vu as { scalaire?: unknown }).scalaire)}`
          : `${chemin} : attendu ${ref.ordinal}${finDe(ref) ? `-${finDe(ref)}` : ""}, désigné ${vu.ordinal}${finDe(vu) ? `-${finDe(vu)}` : ""}`,
      );
    }
  }
  for (const chemin of rendu.keys()) if (!attendu.has(chemin)) enTrop.push(chemin);

  /*
   * ============ CE QUE LA CHAÎNE FAIT DE CETTE DÉSIGNATION
   *
   * Une erreur de désignation n'est SILENCIEUSE que si rien ne la signale. Ce
   * qui précède ne mesure que la désignation ; or la chaîne a un second filet,
   * posé le 5 octobre : le solveur évalue les équations de la facture et lève
   * `ARITHMETIQUE_INCOHERENTE` quand elles tombent.
   *
   * On fait donc traverser la vraie chaîne à la vraie réponse, et on sépare :
   *
   *   signalées  la désignation est fausse ET un drapeau se lève — une question
   *              à l'écran, pas une écriture fausse
   *   SILENCIEUSES  la désignation est fausse et RIEN ne se lève
   *
   * Sans cette distinction, l'épreuve condamnerait un modèle pour une faute que
   * le produit rattrape, ou en absoudrait un pour une faute qu'il ne rattrape pas.
   */
  let drapeaux: string[] = [];
  let valeursRendues: Record<string, unknown> = {};
  try {
    const lu = buildExtractFromTokenPlan({
      tokens: cas.tokens,
      selection: selectionDepuisReponse(parseJsonLoose(res.answer), "TND", cas.tokens),
      decimals: cas.decimales,
      matriculeDossier: cas.matriculeDossier,
    });
    drapeaux = lu.flags.map((f) => `${f.field} : ${f.code}`);
    valeursRendues = lu.extract;
  } catch (e) {
    drapeaux = [
      `la chaîne a refusé cette désignation : ${e instanceof Error ? e.message : String(e)}`,
    ];
  }

  /** Lit « articles[0].total_ht » dans l'extrait que la chaîne a produit. */
  const auChemin = (chemin: string): unknown =>
    chemin
      .split(/\.|\[|\]\.?/)
      .filter(Boolean)
      .reduce<unknown>((o, k) => {
        if (o === null || o === undefined) return undefined;
        return Array.isArray(o) ? o[Number(k)] : (o as Record<string, unknown>)[k];
      }, valeursRendues);

  const fausses = Object.entries(cas.attendu).filter(
    ([chemin, attendu]) => typeof attendu === "string" && auChemin(chemin) !== attendu,
  );

  const cout =
    ((res.tokensIn ?? 0) / 1e6) * tarif.entree + ((res.tokensOut ?? 0) / 1e6) * tarif.sortie;

  return {
    drapeaux,
    fausses: fausses.map(([c, a]) => `${c} : attendu ${a}`),
    modele: res.model,
    attendus: attendu.size,
    justes,
    silencieuses,
    manques,
    enTrop,
    latenceMs: res.latencyMs,
    jetonsIn: res.tokensIn ?? 0,
    jetonsOut: res.tokensOut ?? 0,
    cout,
  };
}

async function main() {
  /*
   * ============================ POURQUOI PLUSIEURS PASSAGES, ET NON UN SEUL
   *
   * Un modèle n'est pas déterministe. Sur cette facture, `deepseek-chat` a rendu
   * « facture_achat » à un passage et « facture_vente » au suivant, sans qu'une
   * ligne change. Décider d'une bascule sur un passage, c'est tirer au sort.
   *
   * Ce qui compte pour un produit comptable n'est pas la moyenne : c'est le PIRE
   * passage. Une pièce sur dix comptabilisée en vente au lieu d'achat n'est pas
   * « 90 % de réussite », c'est une anomalie dans les comptes du client.
   */
  const args = process.argv.slice(2);
  const nFois = Number(args.find((a) => /^\d+$/.test(a)) ?? 3);
  const modeles = args.filter((a) => !/^\d+$/.test(a));
  const aMesurer = modeles.length > 0 ? modeles : ["deepseek-reasoner", "deepseek-chat"];

  if (!process.env["DEEPSEEK_API_KEY"]) {
    throw new Error("DEEPSEEK_API_KEY absente : cette épreuve appelle le vrai modèle.");
  }

  for (const cas of JEU_D_OR) {
    console.log(`\n═══ ${cas.nom}`);
    console.log(`    ${cas.provenance}`);
    console.log(`    ${cas.tokens.length} jetons\n`);

    for (const modele of aMesurer) {
      const passages = [];
      for (let i = 0; i < nFois; i++) passages.push(await mesurer(cas, modele));
      // Le PIRE passage, pas la moyenne : c'est lui qui dit le risque.
      const r = passages.reduce((pire, p) =>
        p.fausses.length > pire.fausses.length ||
        (p.fausses.length === pire.fausses.length &&
          p.silencieuses.length > pire.silencieuses.length)
          ? p
          : pire,
      );
      const justesse = passages.map((p) => p.justes);
      const coutMoyen = passages.reduce((s, p) => s + p.cout, 0) / passages.length;
      const latenceMax = Math.max(...passages.map((p) => p.latenceMs));
      const sortieMax = Math.max(...passages.map((p) => p.jetonsOut));
      console.log(
        `   (${nFois} passages · champs justes ${Math.min(...justesse)} à ${Math.max(...justesse)} · ` +
          `coût moyen ${coutMoyen.toFixed(6)} $ · latence max ${latenceMax} ms · sortie max ${sortieMax} jetons)`,
      );
      const taux = ((r.justes / Math.max(r.attendus, 1)) * 100).toFixed(1);
      console.log(`── ${r.modele}`);
      console.log(`   champs justes        ${r.justes}/${r.attendus}  (${taux} %)`);
      console.log(`   désignations fausses ${r.silencieuses.length}`);
      for (const s of r.silencieuses) console.log(`      ${s}`);
      const muettes = r.fausses.filter(
        (f) => !r.drapeaux.some((d) => f.startsWith(d.split(" :")[0] ?? " ")),
      );
      console.log(
        `   VALEURS FAUSSES      ${r.fausses.length}` +
          (r.fausses.length === 0 ? "   ← aucune valeur fausse ne sort de la chaîne" : ""),
      );
      for (const f of r.fausses) console.log(`      ${f}`);
      console.log(
        `   dont SILENCIEUSES    ${muettes.length}` +
          (muettes.length === 0 && r.fausses.length > 0
            ? "   ← toutes signalées par un drapeau"
            : ""),
      );
      if (r.drapeaux.length > 0) console.log(`   drapeaux levés       ${r.drapeaux.join(" | ")}`);
      if (r.manques.length > 0) console.log(`   champs manqués       ${r.manques.join(", ")}`);
      if (r.enTrop.length > 0) console.log(`   champs en trop       ${r.enTrop.join(", ")}`);
      console.log(`   latence              ${r.latenceMs} ms`);
      console.log(`   jetons               ${r.jetonsIn} → ${r.jetonsOut}`);
      console.log(`   coût                 ${r.cout.toFixed(6)} $\n`);
    }
  }

  console.log(
    "Rappel : un modèle moins cher qui désigne mal rend des montants faux, et\n" +
      "un montant faux coûte infiniment plus qu'un appel. La justesse d'abord.",
  );
}

await main();
