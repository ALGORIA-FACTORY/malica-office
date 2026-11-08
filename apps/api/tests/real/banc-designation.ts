/**
 * Le banc avec désignateur — ce que Claude (ou DeepSeek) apporte au Sudoku, mesuré.
 *
 * ================================================================= LE MODE MESURÉ
 *
 * « Sudoku d'abord » (précision du dirigeant, 8 novembre 2026 : le Sudoku existe pour
 * minimiser l'IA) :
 *
 *   1. le moteur seul lit TOUTES les pièces (le banc sans IA, même relevé, même contexte) ;
 *   2. le désignateur principal (`--designateur`, p. ex. Haiku) n'est appelé QUE sur les
 *      pièces que le moteur n'a pas prouvées ;
 *   3. le second avis (`--second-avis`, p. ex. Sonnet) QUE sur celles qui restent non
 *      prouvées après le principal ;
 *   4. un repli (`--repli`, p. ex. DeepSeek) se mesure à part, sur les mêmes pièces que
 *      le principal : c'est la comparaison « et si Claude tombait ».
 *
 * En option (`--aussi-prouvees`), le principal désigne AUSSI les pièces que le moteur a
 * prouvées : la comparaison secondaire « IA sur toutes les pièces » (combien sa
 * désignation brute s'accorde avec la preuve). Elle n'ajoute rien au taux de pièces
 * prouvées ; elle n'est faite que si le plafond de dépense le permet.
 *
 * ================================================================= LA VÉRIFICATION
 *
 * Le modèle ne voit jamais la pièce : il reçoit le plan de jetons (la même invite que la
 * production, `runVisionRead`) et rend des page/ordinal (R2). Ce qu'il désigne n'est
 * AFFIRMÉ que si le moteur le PROUVE : le moteur est rejoué sur le même relevé où seuls
 * les montants que le modèle a désignés gardent leur lecture de montant. Si
 * l'arithmétique de la pièce ferme sur ces montants-là, et sur eux seuls, la pièce est
 * prouvée « grâce au modèle » ; sinon rien de ce que le modèle a dit n'est affirmé — ses
 * valeurs brutes sont comptées à part (« proposées, non affirmées »), juste ou faux contre
 * la vérité, pour dire ce qu'il en coûterait de les afficher sans preuve.
 *
 * ================================================================= LA DÉPENSE
 *
 * Chaque appel est payé. Le PRIX DE GARDE d'un modèle est son tarif en base multiplié
 * par `--prudence` (3), jamais sous le plancher `--garde-prix-entree/sortie` (1 / 5 $
 * par million) : une garde qui ne dépend pas de l'exactitude du tarif. Avant le premier
 * appel, le banc ESTIME la dépense (l'invite, une sortie de `--sortie-estimee` jetons, au
 * prix de garde) et refuse de partir si elle dépasse `--plafond-dollars`. Pendant le
 * passage, il tient la dépense réelle au prix de garde, plus une sortie MAXIMALE pour
 * chaque appel en vol : le plafond atteint, plus aucun appel ne part (la pièce est dite
 * « non appelée : plafond »). Le coût RAPPORTÉ est
 * celui des jetons facturés au tarif de `agents.model_pricing` (R8 : le modèle et son prix
 * sont la même lecture) ; les noms des modèles viennent de la ligne de commande, jamais
 * du code.
 *
 *   OCR_URL=… DATABASE_URL_ADMIN=… ANTHROPIC_API_KEY=… \
 *   node --experimental-strip-types apps/api/tests/real/banc-designation.ts \
 *     --corpus algoria:outils/jeu-algoria --cache <relevés> \
 *     --designateur anthropic:claude-haiku-5-5 --second-avis anthropic:claude-sonnet-5-5 \
 *     [--repli deepseek:deepseek-chat] [--aussi-prouvees] --sortie mesures.json > bulletin.md
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import pg from "pg";
import { resoudre, type SortieDuSudoku } from "@malica/sudoku";

import {
  chargerLeCorpus,
  enUnites,
  JOUR_PAR_DEFAUT,
  mesurerLaPiece,
  mesurerLesChamps,
  type EtatDeLaPiece,
  type MesureDeLaPiece,
  type MesureDuChamp,
  type PieceDuBanc,
} from "../../src/malica/lecture/banc-sans-ia.ts";
import { chaineDeBanc, type Fournisseur } from "../../src/malica/lecture/designation.ts";
import { champsDeLaGrille, jetonsDuSudoku } from "../../src/malica/lecture/sudoku.ts";
import {
  runVisionRead,
  SYSTEM_SELECT,
  type VisionSelection,
} from "../../src/malica/lecture/vision.ts";

/* ============================================================== LES TYPES == */

interface Designateur {
  readonly fournisseur: Fournisseur;
  readonly modele: string;
}

interface Tarif {
  readonly entree: number;
  readonly sortie: number;
  readonly cache: number;
  readonly cacheEcriture: number;
}

interface PieceLue {
  readonly piece: PieceDuBanc;
  readonly mesure: MesureDeLaPiece;
  readonly etat: EtatDeLaPiece | null;
}

interface Compte {
  juste: number;
  faux: number;
  silence: number;
  invente: number;
  signale: number;
}

interface AppelMesure {
  readonly corpus: string;
  readonly id: string;
  readonly designateur: string;
  /** `ok`, `panne` (le fournisseur a échoué), `plafond` (non appelé : dépense atteinte). */
  readonly appel: "ok" | "panne" | "plafond";
  readonly erreur?: string;
  readonly issueMoteur: string;
  /** L'issue du moteur rejoué sur les seuls montants désignés. */
  readonly issueVerifiee: SortieDuSudoku["issue"] | null;
  readonly prouveeGraceAuModele: boolean;
  readonly jetons: {
    readonly entree: number;
    readonly sortie: number;
    readonly cacheLus: number;
    readonly cacheEcrits: number;
  };
  readonly coutUsd: number;
  readonly designationMs: number;
  readonly verificationMs: number;
  /** Les champs AFFIRMÉS quand la pièce est prouvée grâce au modèle. */
  readonly affirmes: Compte | null;
  readonly fauxAffirmes: readonly string[];
  /** Les totaux (HT, TVA, TTC) tels que le modèle les désigne, NON affirmés. */
  readonly proposes: { juste: number; faux: number; detail: readonly string[] };
}

/* ============================================================ LES OUTILS == */

const zero = (): Compte => ({ juste: 0, faux: 0, silence: 0, invente: 0, signale: 0 });
function compter(champs: readonly MesureDuChamp[]): Compte {
  const c = zero();
  for (const x of champs) c[x.issue]++;
  return c;
}

function lireDesignateur(spec: string | undefined): Designateur | null {
  if (!spec) return null;
  const [f, ...m] = spec.split(":");
  if ((f !== "anthropic" && f !== "deepseek") || m.length === 0)
    throw new Error(`désignateur illisible : ${spec} (attendu fournisseur:modele)`);
  return { fournisseur: f, modele: m.join(":") };
}
const nom = (d: Designateur) => `${d.fournisseur}:${d.modele}`;

/** Toutes les références (page, ordinal[, ordinalEnd]) d'une sélection. */
function referencesDe(selection: VisionSelection): Set<string> {
  const refs = new Set<string>();
  const marcher = (v: unknown): void => {
    if (v === null || typeof v !== "object") return;
    if (Array.isArray(v)) {
      v.forEach(marcher);
      return;
    }
    const o = v as Record<string, unknown>;
    if (typeof o["page"] === "number" && typeof o["ordinal"] === "number") {
      const fin = typeof o["ordinalEnd"] === "number" ? o["ordinalEnd"] : o["ordinal"];
      for (let i = o["ordinal"]; i <= fin; i++) refs.add(`${o["page"]}.${i}`);
      return;
    }
    Object.values(o).forEach(marcher);
  };
  marcher(selection);
  return refs;
}

/** La lecture de montant du jeton désigné : la forte d'abord. */
function montantDuJeton(
  jetons: ReturnType<typeof jetonsDuSudoku>,
  r: { page: number; ordinal: number } | null | undefined,
): number | null {
  if (!r) return null;
  const j = jetons.find((x) => x.page === r.page && x.ordinal === r.ordinal);
  if (!j || j.montants.length === 0) return null;
  return (j.montants.find((m) => m.forte) ?? j.montants[0]!).v;
}

/** La vérité d'un champ, par son code ou son jumeau confondu. */
function verite(piece: PieceDuBanc, code: string): unknown {
  if (Object.hasOwn(piece.concepts, code)) return piece.concepts[code];
  const c = piece.confondus[code];
  return c !== undefined && Object.hasOwn(piece.concepts, c) ? piece.concepts[c] : undefined;
}

/**
 * Les totaux que le modèle désigne (HT, TVA par taux, TTC), relus dans le plan et jugés
 * contre la vérité. Ils ne sont PAS affirmés : c'est ce que la pièce montrerait si l'on
 * affichait le modèle sans la preuve.
 */
function lesProposes(
  piece: PieceDuBanc,
  etat: EtatDeLaPiece,
  selection: VisionSelection,
): AppelMesure["proposes"] {
  const roles = champsDeLaGrille(etat.contexte.grille);
  const jetons = jetonsDuSudoku(etat.tokens, etat.devise, etat.contexte);
  const exp = etat.devise.decimales;
  const out = { juste: 0, faux: 0, detail: [] as string[] };
  const juger = (champ: string, lu: number | null, attendus: readonly unknown[]) => {
    const vrais = attendus.filter((a) => a !== undefined && a !== null && typeof a !== "object");
    if (lu === null || vrais.length === 0) return;
    const ok = vrais.some((a) => enUnites(a, exp) === BigInt(lu));
    if (ok) out.juste++;
    else {
      out.faux++;
      out.detail.push(`${champ} : lu ${lu}, attendu ${vrais.join(" | ")}`);
    }
  };
  if (roles.ht)
    juger(roles.ht, montantDuJeton(jetons, selection.totals.base_ht), [verite(piece, roles.ht)]);
  if (roles.tva) {
    // La TVA par taux : la vérité est { "19": "159.951" } ; un seul taux se juge sur le total.
    const att = verite(piece, roles.tva);
    if (att && typeof att === "object") {
      const vraies = Object.values(att as Record<string, unknown>);
      for (const l of selection.lines)
        juger(roles.tva, montantDuJeton(jetons, l.vat_amount), vraies);
    } else juger(roles.tva, montantDuJeton(jetons, selection.totals.vat), [att]);
  }
  if (roles.ttc.length > 0)
    juger(
      "ttc",
      montantDuJeton(jetons, selection.totals.ttc),
      roles.ttc.map((t) => verite(piece, t.champ)),
    );
  return out;
}

/**
 * Les champs affirmés d'une pièce prouvée grâce au modèle : ceux de la sortie vérifiée,
 * et, là où elle se tait, ceux que le moteur seul avait déjà affirmés sur la pièce.
 */
function fusionner(verifies: MesureDuChamp[], moteur: readonly MesureDuChamp[]): MesureDuChamp[] {
  const rang = new Map<string, number>();
  const cle = (c: MesureDuChamp) => {
    const n = rang.get(c.champ) ?? 0;
    rang.set(c.champ, n + 1);
    return `${c.champ}#${n}`;
  };
  const duMoteur = new Map(moteur.map((c) => [cle(c), c]));
  rang.clear();
  return verifies.map((c) => {
    const m = duMoteur.get(cle(c));
    return c.issue === "silence" && m && m.issue !== "silence" ? m : c;
  });
}

async function tarifDe(db: pg.Pool, modele: string, chat: string): Promise<Tarif | null> {
  const { rows } = await db.query<{ role: string; e: string; s: string }>(
    `select distinct on (role) role, price_in_per_mtok::text e, price_out_per_mtok::text s
       from agents.model_pricing where model = $1 and role = any($2)
        and effective_from <= current_date order by role, effective_from desc`,
    [modele, [chat, "cache", "cache_ecriture"]],
  );
  const r = (role: string) => rows.find((x) => x.role === role);
  const base = r(chat);
  if (!base) return null;
  return {
    entree: Number(base.e),
    sortie: Number(base.s),
    cache: Number(r("cache")?.e ?? base.e),
    cacheEcriture: Number(r("cache_ecriture")?.e ?? base.e),
  };
}

const quantile = (xs: readonly number[], q: number) => {
  const t = [...xs].sort((a, b) => a - b);
  return t.length ? t[Math.min(t.length - 1, Math.floor(q * t.length))]! : 0;
};
const moyenne = (xs: readonly number[]) =>
  xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)} %` : "—");
const usd = (x: number) => `${x.toFixed(4)} $`;

/* ============================================================ LE PASSAGE == */

async function principal(): Promise<void> {
  const { values } = parseArgs({
    options: {
      corpus: { type: "string", multiple: true },
      cache: { type: "string" },
      cas: { type: "string" },
      sortie: { type: "string" },
      designateur: { type: "string" },
      "second-avis": { type: "string" },
      repli: { type: "string" },
      "aussi-prouvees": { type: "boolean" },
      concurrence: { type: "string" },
      "plafond-dollars": { type: "string" },
      "garde-prix-entree": { type: "string" },
      "garde-prix-sortie": { type: "string" },
      prudence: { type: "string" },
      "sortie-estimee": { type: "string" },
    },
  });
  // Le relevé ne s'adresse jamais à un modèle de vision : sans OCR, une page échoue.
  for (const cle of ["QWEN_API_KEY", "QWEN_BASE_URL"]) Reflect.deleteProperty(process.env, cle);

  const principalD = lireDesignateur(values.designateur);
  if (!principalD) throw new Error("--designateur requis (fournisseur:modele)");
  const secondD = lireDesignateur(values["second-avis"]);
  let repliD = lireDesignateur(values.repli);
  const notes: string[] = [];
  if (repliD?.fournisseur === "deepseek" && !process.env["DEEPSEEK_API_KEY"]?.trim()) {
    notes.push(`Repli ${nom(repliD)} non mesuré : DEEPSEEK_API_KEY absente de l'environnement.`);
    repliD = null;
  }
  for (const d of [principalD, secondD, repliD])
    if (d?.fournisseur === "anthropic" && !process.env["ANTHROPIC_API_KEY"]?.trim())
      throw new Error("ANTHROPIC_API_KEY absente : le banc ne part pas");

  const concurrence = Number(values.concurrence ?? "4");
  const plafond = Number(values["plafond-dollars"] ?? "50");
  const plancherEntree = Number(values["garde-prix-entree"] ?? "1");
  const plancherSortie = Number(values["garde-prix-sortie"] ?? "5");
  const prudence = Number(values.prudence ?? "3");
  const sortieEstimee = Number(values["sortie-estimee"] ?? "4000");
  // La borne de sortie de la production (`claude.ts`, SORTIE_MAX_JETONS).
  const sortieMax = 8192;

  const base = process.env["DATABASE_URL_ADMIN"];
  if (!base) throw new Error("DATABASE_URL_ADMIN absente");
  const cache = resolve(values.cache ?? ".releves");
  mkdirSync(cache, { recursive: true });
  const voulus = values.cas ? new Set(values.cas.split(",")) : null;
  const db = new pg.Pool({ connectionString: base, max: 2 });
  try {
    const { rows: packs } = await db.query<{ id: string; currency: string }>(
      `select id, currency from ref_packs_v where jurisdiction = 'TN' and effective_from <= $1::date
        order by effective_from desc limit 1`,
      [JOUR_PAR_DEFAUT],
    );
    if (packs.length !== 1) throw new Error("aucun pack TN en vigueur");
    const packId = packs[0]!.id;
    // Les codes que la production donne au désignateur (`capture.ts`, `contexteDeLecture`).
    const { rows: taux } = await db.query<{ code: string; label: string | null; rate: string }>(
      `select code, label, rate::text from ref_tva_rates_v where pack_version_id = $1`,
      [packId],
    );
    const { rows: charges } = await db.query<{ code: string; label: string | null }>(
      `select code, label from ref_fiscal_charges_v where pack_version_id = $1`,
      [packId],
    );
    const taxCodes = taux.map((t) => ({
      code: t.code,
      label: t.label ?? t.code,
      rate: String(Number(t.rate)),
    }));
    const chargeCodes = [
      ...new Map(charges.map((c) => [c.code, { code: c.code, label: c.label ?? c.code }])).values(),
    ];

    /* ---------------------------------------------- 1. le moteur seul, partout */
    const pieces = (values.corpus ?? [])
      .flatMap((s) => chargerLeCorpus(s, cache, packs[0]!.currency, "paddle"))
      .filter((p) => !voulus || voulus.has(p.id));
    const lues: PieceLue[] = [];
    for (const p of pieces) {
      let etat: EtatDeLaPiece | null = null;
      const mesure = await mesurerLaPiece(db, packId, p, undefined, resoudre, false, (e) => {
        etat = e;
      });
      lues.push({ piece: p, mesure, etat });
      console.error(`moteur ${p.corpus} ${p.id} ${mesure.issue} ${mesure.releveMs ?? "-"} ms`);
    }
    const nonProuvees = lues.filter((l) => l.mesure.issue !== "prouvee" && l.etat);

    /* ---------------------------------------------- 2. l'estimation, avant tout appel */
    const tarifs = new Map<string, Tarif | null>();
    for (const d of [principalD, secondD, repliD])
      if (d) tarifs.set(nom(d), await tarifDe(db, d.modele, "chat"));
    const garde = (d: Designateur) => {
      const t = tarifs.get(nom(d));
      return {
        entree: Math.max(plancherEntree, (t?.entree ?? 0) * prudence),
        sortie: Math.max(plancherSortie, (t?.sortie ?? 0) * prudence),
      };
    };
    const longueurInvite = (l: PieceLue) =>
      SYSTEM_SELECT.length +
      2000 +
      (l.etat?.tokens.reduce((n, t) => n + t.text.length + 30, 0) ?? 0);
    // ~3 caractères par jeton (un plan à coordonnées : prudent).
    const jetonsInvite = (l: PieceLue) => Math.min(longueurInvite(l), 62_000) / 3;
    const estimer = (ls: readonly PieceLue[], d: Designateur | null) => {
      if (!d) return 0;
      const g = garde(d);
      return ls.reduce(
        (s, l) => s + (jetonsInvite(l) * g.entree + sortieEstimee * g.sortie) / 1e6,
        0,
      );
    };
    const prouvees = lues.filter((l) => l.mesure.issue === "prouvee" && l.etat);
    const estimation = {
      principal: estimer(nonProuvees, principalD),
      secondAvis: estimer(nonProuvees, secondD),
      repli: estimer(nonProuvees, repliD),
      toutes: values["aussi-prouvees"] ? estimer(prouvees, principalD) : 0,
    };
    const essentiel = estimation.principal + estimation.secondAvis + estimation.repli;
    console.error(
      `estimation au prix de garde (prudence ${prudence}, plancher ${plancherEntree} / ${plancherSortie} $ par million) : ` +
        `${JSON.stringify(estimation)} — plafond ${plafond} $`,
    );
    if (essentiel > plafond) {
      console.log(
        `## Banc non lancé\n\nL'estimation du mode « Sudoku d'abord » au prix de garde (${essentiel.toFixed(2)} $) dépasse le plafond (${plafond} $). Aucun appel n'est parti.`,
      );
      process.exitCode = 2;
      return;
    }
    let toutesPermises = Boolean(values["aussi-prouvees"]);
    if (toutesPermises && essentiel + estimation.toutes > plafond) {
      notes.push(
        `Comparaison « IA sur toutes les pièces » non faite : l'estimation (${(essentiel + estimation.toutes).toFixed(2)} $) dépasserait le plafond.`,
      );
      toutesPermises = false;
    }

    /* ---------------------------------------------- 3. les appels, sous plafond */
    // La dépense réelle au prix de garde, et la réserve des appels en vol (sortie maximale).
    let depenseDeGarde = 0;
    let reserve = 0;
    const tarif = async (d: Designateur) => tarifs.get(nom(d)) ?? null;

    const appeler = async (l: PieceLue, d: Designateur): Promise<AppelMesure> => {
      const etat = l.etat!;
      const commun = {
        corpus: l.piece.corpus,
        id: l.piece.id,
        designateur: nom(d),
        issueMoteur: l.mesure.issue,
      };
      const vide = {
        ...commun,
        issueVerifiee: null,
        prouveeGraceAuModele: false,
        jetons: { entree: 0, sortie: 0, cacheLus: 0, cacheEcrits: 0 },
        coutUsd: 0,
        designationMs: 0,
        verificationMs: 0,
        affirmes: null,
        fauxAffirmes: [],
        proposes: { juste: 0, faux: 0, detail: [] },
      };
      const g = garde(d);
      const pire = (jetonsInvite(l) * 2 * g.entree + sortieMax * g.sortie) / 1e6;
      if (depenseDeGarde + reserve + pire > plafond) return { ...vide, appel: "plafond" };
      reserve += pire;
      let lecture;
      try {
        lecture = await runVisionRead({
          dataUrl: "data:,",
          tokens: etat.tokens,
          releveur: l.mesure.lecteur ?? "fourni",
          taxCodes,
          chargeCodes,
          tiers: [],
          ...(l.piece.dossier
            ? {
                dossier: {
                  raisonSociale: l.piece.dossier.raison,
                  identifiantFiscal: l.piece.dossier.matricule,
                },
              }
            : {}),
          designation: { chaine: async () => chaineDeBanc(d.fournisseur, d.modele) },
        });
      } catch (e) {
        reserve -= pire;
        // Une panne peut avoir été facturée (un réessai) : on garde la réserve comme dépense.
        depenseDeGarde += pire;
        return {
          ...vide,
          appel: "panne",
          erreur: (e instanceof Error ? e.message : String(e)).slice(0, 200),
        };
      }
      const des = lecture.designation;
      const jetons = {
        entree: des.tokensIn ?? 0,
        sortie: des.tokensOut ?? 0,
        cacheLus: des.cache?.lus ?? 0,
        cacheEcrits: des.cache?.ecrits ?? 0,
      };
      reserve -= pire;
      depenseDeGarde +=
        ((jetons.entree + jetons.cacheLus + jetons.cacheEcrits) * g.entree +
          jetons.sortie * g.sortie) /
        1e6;
      const t = await tarif(d);
      const coutUsd = t
        ? (jetons.entree * t.entree +
            jetons.sortie * t.sortie +
            jetons.cacheLus * t.cache +
            jetons.cacheEcrits * t.cacheEcriture) /
          1e6
        : Number.NaN;

      // La vérification : seuls les montants désignés gardent leur lecture de montant.
      const t0 = performance.now();
      const refs = referencesDe(lecture.selection);
      const jetonsRestreints = jetonsDuSudoku(etat.tokens, etat.devise, etat.contexte).map((j) =>
        refs.has(`${j.page}.${j.ordinal}`)
          ? j
          : { ...j, montants: [], ...(j.decoupes ? { decoupes: [] } : {}) },
      );
      let sortieVerifiee: SortieDuSudoku | null = null;
      try {
        sortieVerifiee = etat.resoudre(jetonsRestreints);
      } catch (e) {
        console.error(`vérification ${l.piece.id} : ${e instanceof Error ? e.message : e}`);
      }
      const verificationMs = Math.round(performance.now() - t0);
      const grace = l.mesure.issue !== "prouvee" && sortieVerifiee?.issue === "prouvee";
      let affirmes: MesureDuChamp[] | null = null;
      if (grace)
        affirmes = fusionner(
          mesurerLesChamps(l.piece, etat.contexte, etat.devise.decimales, sortieVerifiee!),
          l.mesure.champs,
        );
      return {
        ...commun,
        appel: "ok",
        issueVerifiee: sortieVerifiee?.issue ?? null,
        prouveeGraceAuModele: grace,
        jetons,
        coutUsd,
        designationMs: des.latencyMs,
        verificationMs,
        affirmes: affirmes ? compter(affirmes) : null,
        fauxAffirmes: (affirmes ?? [])
          .filter((c) => c.issue === "faux" || c.issue === "invente")
          .map((c) => `${c.champ} : ${c.issue} (lu ${c.lu}, attendu ${JSON.stringify(c.attendu)})`),
        proposes: lesProposes(l.piece, etat, lecture.selection),
      };
    };

    const enParallele = async (ls: readonly PieceLue[], d: Designateur) => {
      const out: AppelMesure[] = new Array(ls.length);
      let i = 0;
      await Promise.all(
        Array.from({ length: Math.max(1, concurrence) }, async () => {
          while (i < ls.length) {
            const k = i++;
            out[k] = await appeler(ls[k]!, d);
            const a = out[k]!;
            console.error(
              `${a.designateur} ${a.corpus} ${a.id} ${a.appel} moteur=${a.issueMoteur} vérifiée=${a.issueVerifiee} ` +
                `${a.prouveeGraceAuModele ? "PROUVÉE GRÂCE AU MODÈLE " : ""}${a.designationMs} ms ${a.coutUsd.toFixed(5)} $ ${a.erreur ?? ""}`,
            );
          }
        }),
      );
      return out;
    };

    const parPrincipal = await enParallele(nonProuvees, principalD);
    const restantes = nonProuvees.filter((_, k) => !parPrincipal[k]!.prouveeGraceAuModele);
    const parSecond = secondD ? await enParallele(restantes, secondD) : [];
    const parRepli = repliD ? await enParallele(nonProuvees, repliD) : [];
    const surProuvees = toutesPermises ? await enParallele(prouvees, principalD) : [];

    /* ---------------------------------------------- 4. le bulletin */
    const total = lues.length;
    const moteurProuvees = lues.filter((l) => l.mesure.issue === "prouvee").length;
    const fauxDuMoteur = lues.reduce(
      (s, l) =>
        s +
        l.mesure.champs.filter((c) => c.issue === "faux" || c.issue === "invente").length +
        (l.mesure.sens.juste === false ? 1 : 0),
      0,
    );
    const msMoteur = lues.map((l) => ((l.mesure.releveMs ?? 0) + (l.mesure.sudokuMs ?? 0)) / 1000);
    const resume = (appels: readonly AppelMesure[]) => {
      const ok = appels.filter((a) => a.appel === "ok");
      const gagnees = appels.filter((a) => a.prouveeGraceAuModele);
      const cout = ok.reduce((s, a) => s + a.coutUsd, 0);
      const faux = appels.reduce((s, a) => s + a.fauxAffirmes.length, 0);
      const prop = appels.reduce(
        (s, a) => ({ juste: s.juste + a.proposes.juste, faux: s.faux + a.proposes.faux }),
        { juste: 0, faux: 0 },
      );
      const jet = ok.reduce(
        (s, a) => ({
          entree: s.entree + a.jetons.entree,
          sortie: s.sortie + a.jetons.sortie,
          cacheLus: s.cacheLus + a.jetons.cacheLus,
          cacheEcrits: s.cacheEcrits + a.jetons.cacheEcrits,
        }),
        { entree: 0, sortie: 0, cacheLus: 0, cacheEcrits: 0 },
      );
      return {
        appels: appels.length,
        reussis: ok.length,
        pannes: appels.filter((a) => a.appel === "panne").length,
        plafond: appels.filter((a) => a.appel === "plafond").length,
        gagnees: gagnees.length,
        faux,
        cout,
        jetons: jet,
        proposes: prop,
        secondes: ok.map((a) => (a.designationMs + a.verificationMs) / 1000),
      };
    };
    const rP = resume(parPrincipal);
    const rS = resume(parSecond);
    const rR = resume(parRepli);
    const rT = resume(surProuvees);

    const final = moteurProuvees + rP.gagnees + rS.gagnees;
    const coutFinal = rP.cout + rS.cout;
    const appelsIa = rP.reussis + rP.pannes + rS.reussis + rS.pannes;
    const evites = total - appelsIa;
    const ligne = (
      nomL: string,
      prouveesN: number,
      faux: number,
      appels: number,
      cout: number,
      secs: number,
    ) =>
      `| ${nomL} | ${prouveesN} / ${total} (${pct(prouveesN, total)}) | ${faux} | ${appels} | ${usd(cout / total)} | ${usd(cout)} | ${secs.toFixed(2)} s |`;
    const sMoyMoteur = moyenne(msMoteur);
    const parPieceAvec = (r: ReturnType<typeof resume>) =>
      sMoyMoteur + r.secondes.reduce((s, x) => s + x, 0) / total;

    const md: string[] = [
      `## Mesure « Sudoku d'abord » — ${new Date().toISOString().slice(0, 10)}`,
      "",
      `${total} pièces (${[...new Set(lues.map((l) => l.piece.corpus))].join(", ")}). Le moteur lit tout ; le modèle n'est appelé que sur les pièces que le moteur n'a pas prouvées. Une valeur du modèle n'est affirmée que si le moteur la prouve (rejoué sur les seuls montants désignés).`,
      "",
      "| Chaîne | Pièces prouvées | Faux affirmés | Appels IA | Coût par pièce (toutes) | Coût total | Secondes par pièce (moyenne) |",
      "|---|--:|--:|--:|--:|--:|--:|",
      ligne("Moteur seul", moteurProuvees, fauxDuMoteur, 0, 0, sMoyMoteur),
      ligne(
        `Moteur + ${principalD.modele}`,
        moteurProuvees + rP.gagnees,
        fauxDuMoteur + rP.faux,
        rP.reussis + rP.pannes,
        rP.cout,
        parPieceAvec(rP),
      ),
      ...(repliD
        ? [
            ligne(
              `Moteur + ${repliD.modele} (repli)`,
              moteurProuvees + rR.gagnees,
              fauxDuMoteur + rR.faux,
              rR.reussis + rR.pannes,
              rR.cout,
              parPieceAvec(rR),
            ),
          ]
        : []),
      ...(secondD
        ? [
            ligne(
              `Moteur + ${principalD.modele} + ${secondD.modele} (second avis)`,
              final,
              fauxDuMoteur + rP.faux + rS.faux,
              appelsIa,
              coutFinal,
              sMoyMoteur +
                (rP.secondes.reduce((s, x) => s + x, 0) + rS.secondes.reduce((s, x) => s + x, 0)) /
                  total,
            ),
          ]
        : []),
      "",
      `- **Taux final de pièces prouvées** (moteur, puis ${principalD.modele}${secondD ? `, puis ${secondD.modele}` : ""}) : **${final} / ${total} (${pct(final, total)})**.`,
      `- **Appels IA évités** : ${evites} sur ${total} pièces (${pct(evites, total)}) n'ont appelé aucun modèle.`,
      `- Gagnées par ${principalD.modele} : ${rP.gagnees} sur ${nonProuvees.length} non prouvées par le moteur ; par ${secondD?.modele ?? "—"} : ${rS.gagnees} sur ${restantes.length}.`,
      `- Pannes : ${principalD.modele} ${rP.pannes}, ${secondD?.modele ?? "—"} ${rS.pannes}${repliD ? `, ${repliD.modele} ${rR.pannes}` : ""} ; non appelées (plafond) : ${rP.plafond + rS.plafond + rR.plafond + rT.plafond}.`,
      `- Moteur seul : ${sMoyMoteur.toFixed(2)} s par pièce en moyenne (relevé OCR + moteur), médiane ${quantile(msMoteur, 0.5).toFixed(2)} s. Désignation ${principalD.modele} : médiane ${quantile(rP.secondes, 0.5).toFixed(2)} s, p95 ${quantile(rP.secondes, 0.95).toFixed(2)} s par appel.`,
      "",
      "### Les valeurs du modèle sans preuve (non affirmées)",
      "",
      "Sur les pièces que la preuve ne ferme pas, ce que le modèle désigne pour HT, TVA et TTC, jugé contre la vérité — ce que l'écran montrerait si l'on affichait le modèle sans le Sudoku :",
      "",
      "| Désignateur | justes | faux |",
      "|---|--:|--:|",
      `| ${principalD.modele} | ${rP.proposes.juste} | ${rP.proposes.faux} |`,
      ...(secondD ? [`| ${secondD.modele} | ${rS.proposes.juste} | ${rS.proposes.faux} |`] : []),
      ...(repliD ? [`| ${repliD.modele} | ${rR.proposes.juste} | ${rR.proposes.faux} |`] : []),
      ...(surProuvees.length
        ? [
            `| ${principalD.modele}, sur les pièces déjà prouvées (comparaison « IA partout ») | ${rT.proposes.juste} | ${rT.proposes.faux} |`,
          ]
        : []),
      "",
      "### Jetons et coût (tarif de `agents.model_pricing`)",
      "",
      "| Désignateur | appels | entrée | sortie | cache lu | cache écrit | coût |",
      "|---|--:|--:|--:|--:|--:|--:|",
      ...(
        [
          [principalD, rP],
          [secondD, rS],
          [repliD, rR],
        ] as const
      )
        .filter(([d]) => d)
        .map(
          ([d, r]) =>
            `| ${d!.modele} | ${r.reussis} | ${r.jetons.entree} | ${r.jetons.sortie} | ${r.jetons.cacheLus} | ${r.jetons.cacheEcrits} | ${usd(r.cout)} |`,
        ),
      ...(surProuvees.length
        ? [
            `| ${principalD.modele} (pièces déjà prouvées) | ${rT.reussis} | ${rT.jetons.entree} | ${rT.jetons.sortie} | ${rT.jetons.cacheLus} | ${rT.jetons.cacheEcrits} | ${usd(rT.cout)} |`,
          ]
        : []),
      "",
      `Dépense totale du passage, au tarif : **${usd(rP.cout + rS.cout + rR.cout + rT.cout)}** (dépense au prix de garde : ${depenseDeGarde.toFixed(2)} $ sur un plafond de ${plafond} $ ; estimation avant lancement : ${essentiel.toFixed(2)} $).`,
      ...(notes.length ? ["", ...notes.map((n) => `- ${n}`)] : []),
    ];
    const fautes = [...parPrincipal, ...parSecond, ...parRepli].flatMap((a) =>
      a.fauxAffirmes.map((f) => `${a.designateur} ${a.corpus} ${a.id} ${f}`),
    );
    if (fautes.length) md.push("", "### Faux affirmés", "", ...fautes.map((f) => `- ${f}`));
    const moteurPar = new Map<string, { n: number; p: number }>();
    for (const l of lues) {
      const x = moteurPar.get(l.piece.corpus) ?? { n: 0, p: 0 };
      x.n++;
      if (l.mesure.issue === "prouvee") x.p++;
      moteurPar.set(l.piece.corpus, x);
    }
    const gagneesPar = new Map<string, number>();
    for (const a of [...parPrincipal, ...parSecond])
      if (a.prouveeGraceAuModele) gagneesPar.set(a.corpus, (gagneesPar.get(a.corpus) ?? 0) + 1);
    const issues = new Map<string, number>();
    for (const l of nonProuvees) issues.set(l.mesure.issue, (issues.get(l.mesure.issue) ?? 0) + 1);
    md.push(
      "",
      "### Par corpus",
      "",
      "| Corpus | pièces | moteur seul | final |",
      "|---|--:|--:|--:|",
      ...[...moteurPar].map(
        ([c, x]) =>
          `| ${c} | ${x.n} | ${x.p} (${pct(x.p, x.n)}) | ${x.p + (gagneesPar.get(c) ?? 0)} (${pct(x.p + (gagneesPar.get(c) ?? 0), x.n)}) |`,
      ),
      "",
      `Issues du moteur sur les pièces non prouvées : ${[...issues].map(([k, v]) => `${k} ${v}`).join(", ")}. Un modèle ne peut faire prouver qu'une pièce dont le relevé porte les bons montants : il désigne, il ne lit pas.`,
    );
    console.log(md.join("\n"));
    if (values.sortie)
      writeFileSync(
        values.sortie,
        JSON.stringify(
          {
            date: new Date().toISOString(),
            pieces: total,
            moteur: lues.map((l) => ({
              corpus: l.piece.corpus,
              id: l.piece.id,
              issue: l.mesure.issue,
              releveMs: l.mesure.releveMs,
              sudokuMs: l.mesure.sudokuMs,
              champs: compter(l.mesure.champs),
            })),
            estimation,
            depenseDeGarde,
            principal: {
              designateur: nom(principalD),
              resume: { ...rP, secondes: undefined },
              appels: parPrincipal,
            },
            secondAvis: secondD
              ? {
                  designateur: nom(secondD),
                  resume: { ...rS, secondes: undefined },
                  appels: parSecond,
                }
              : null,
            repli: repliD
              ? {
                  designateur: nom(repliD),
                  resume: { ...rR, secondes: undefined },
                  appels: parRepli,
                }
              : null,
            iaPartout: surProuvees.length
              ? { resume: { ...rT, secondes: undefined }, appels: surProuvees }
              : null,
            final: {
              prouvees: final,
              appelsIa,
              evites,
              coutUsd: coutFinal,
              fauxAffirmes: fauxDuMoteur + rP.faux + rS.faux,
            },
            notes,
          },
          null,
          1,
        ),
      );
    if (fautes.length) process.exitCode = 1;
  } finally {
    await db.end();
  }
}

await principal();
