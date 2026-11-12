/**
 * Imprimer — un document, un dossier ou une sélection de la bibliothèque.
 *
 * `POST /impressions` rend UN PDF, composé à la demande (`impression-pdf.ts`)
 * et jamais gardé. Quatre règles le tiennent :
 *
 *   — DROITS. Les pièces se demandent à la base sous l'identité de l'appelant
 *     (`documentsAImprimer`) : on n'imprime que ce qu'on voit, jamais l'espace
 *     privé, et une seule pièce refusée refuse l'impression entière. Sous un
 *     cabinet, c'est la lecture de l'archive téléchargée : même mandat, même
 *     garde d'export, mêmes documents liés, même ordre.
 *   — VOLUME. Le seuil vient de la tour (`impression_reglages_lire`). Au-delà,
 *     la réponse est un avertissement (pages, taille) tant que la personne n'a
 *     pas confirmé ; au-delà du plafond, la composition est refusée — elle se
 *     fait dans la requête, pas encore en arrière-plan.
 *   — JOURNAL. L'impression s'inscrit (`impression_journaliser`) AVANT que le
 *     PDF ne parte : pas de PDF rendu sans sa ligne au journal.
 *   — RIEN D'AUTRE. Aucune lecture n'est demandée, aucun fichier n'est écrit.
 *
 * La composition se fait HORS transaction : elle dure plus qu'une connexion
 * ne doit rester prise. La première transaction lit ; la seconde journalise.
 */
import { readFile } from "node:fs/promises";

import type { Request, Response } from "express";
import { z } from "zod";

import { documentsAImprimer, fuseauDeLaPersonne } from "./bibliotheque.ts";
import { sousLAppelant } from "./cles-api.ts";
import type { Requete } from "./db.ts";
import {
  composerLImpression,
  ImpressionTropVolumineuse,
  pagesDeTete,
  saitEcrire,
  type Mentions,
  type SocieteAComposer,
} from "./impression-pdf.ts";
import { introuvableLisible, refusLisible } from "./refus.ts";
import { enTetesDuContenu, originauxDesPieces } from "./stockage.ts";

const Demande = z.object({
  pieces: z.array(z.string().uuid()).min(1).max(2000),
  /** Le cabinet qui imprime sous son mandat ; absent : la personne imprime ce qu'elle voit. */
  cabinetId: z.string().uuid().nullish(),
  portee: z.enum(["piece", "dossier", "selection"]),
  langue: z.enum(["fr", "en", "ar"]),
  /** La personne a lu l'avertissement de volume et imprime quand même. */
  confirme: z.boolean().optional(),
});
type Demande = z.infer<typeof Demande>;

/** Ce que la première transaction a lu : de quoi avertir, puis composer. */
interface Plan {
  societes: SocieteAComposer[];
  pieces: string[];
  chemins: Map<string, string>;
  mentions: Mentions;
  sens: "ltr" | "rtl";
  composeLe: string;
  pages: number;
  octets: number;
  reglages: { pagesSeuil: number; octetsSeuil: number; pagesMax: number };
}

/** « 2026-11-03 » → « 03/11/2026 » : des chiffres, qui se lisent dans les trois langues. */
const jour = (iso: string) => iso.split("-").reverse().join("/");

/** La période d'un lot : son mois, ou du premier au dernier (« 10/2026 – 11/2026 »). */
function periodeDe(dates: readonly string[]): string {
  const mois = [...new Set(dates.map((d) => d.slice(0, 7)))].sort();
  const lisible = (m: string) => m.split("-").reverse().join("/");
  if (mois.length === 0) return "—";
  return mois.length === 1 ? lisible(mois[0]!) : `${lisible(mois[0]!)} – ${lisible(mois.at(-1)!)}`;
}

async function preparer(db: Requete, demande: Demande): Promise<Plan> {
  const societes = await documentsAImprimer(db, demande.cabinetId ?? null, demande.pieces);
  const pieces = societes.flatMap((s) => s.documents.map((d) => d.id));
  const originaux = await originauxDesPieces(db, pieces);
  const { rows: reglage } = await db.query<{ r: Plan["reglages"] | null }>(
    `select public.impression_reglages_lire() as r`,
  );
  if (!reglage[0]?.r)
    throw Object.assign(new Error("réglage du volume d'impression absent"), { code: "22023" });

  const { rows: libelles } = await db.query<{
    ns: string;
    key: string;
    locale: string;
    value: string;
  }>(
    `select ns, key, locale, value from ref.labels
      where (ns = 'mention_d_impression' and locale = any($1::text[]))
         or (ns = 'document_type' and locale = any($1::text[]))`,
    [[demande.langue, "fr"]],
  );
  const dans = (ns: string, locale: string) =>
    Object.fromEntries(
      libelles.filter((l) => l.ns === ns && l.locale === locale).map((l) => [l.key, l.value]),
    );
  // Une langue que la machine ne sait pas dessiner s'écrirait en carrés vides :
  // les mentions passent alors au français (voir `impression-pdf.ts`).
  const voulues = dans("mention_d_impression", demande.langue);
  const langue = Object.values(voulues).every(saitEcrire) ? demande.langue : "fr";
  const mentions = dans("mention_d_impression", langue);
  const types = dans("document_type", langue);

  const fuseau = await fuseauDeLaPersonne(db);
  const { rows: instant } = await db.query<{ le: string }>(
    `select to_char(now() at time zone $1::text, 'DD/MM/YYYY HH24:MI') as le`,
    [fuseau],
  );

  const aComposer: SocieteAComposer[] = societes.map((s) => ({
    nom: s.nom,
    matricule: s.matricule,
    periode: periodeDe(s.documents.map((d) => d.dateDeClassement)),
    pieces: s.documents.map((d) => ({
      id: d.id,
      reference: d.reference,
      type: d.type ? (types[d.type] ?? d.type) : null,
      tiers: d.tiers,
      date: jour(d.dateDeClassement),
      montant: d.montant === null ? null : `${d.montant} ${d.devise}`,
      pages: originaux.get(d.id)?.pages ?? 1,
    })),
  }));
  return {
    societes: aComposer,
    pieces,
    chemins: new Map([...originaux].map(([id, o]) => [id, o.chemin])),
    mentions,
    sens: langue === "ar" ? "rtl" : "ltr",
    composeLe: instant[0]!.le,
    pages:
      aComposer.reduce((n, s) => n + pagesDeTete(s.pieces.length), 0) +
      [...originaux.values()].reduce((n, o) => n + o.pages, 0),
    octets: [...originaux.values()].reduce((n, o) => n + o.octets, 0),
    reglages: reglage[0].r,
  };
}

/**
 * `POST /impressions`. Répond le PDF (`application/pdf`), ou un constat en
 * JSON : `a_confirmer` (au-delà du seuil, avec les pages et la taille) ou
 * `trop_volumineuse` (au-delà du plafond).
 */
export async function imprimer(req: Request, res: Response): Promise<void> {
  const saisie = Demande.safeParse(req.body);
  if (!saisie.success) {
    res.status(400).json({ erreur: "refus.saisie.mal_formee" });
    return;
  }
  const demande = saisie.data;
  try {
    const plan = await sousLAppelant(req, (db) => preparer(db, demande));
    const volume = { pages: plan.pages, octets: plan.octets, ...plan.reglages };
    if (plan.pages > plan.reglages.pagesMax) {
      res.json({ etat: "trop_volumineuse", ...volume });
      return;
    }
    if (
      !demande.confirme &&
      (plan.pages > plan.reglages.pagesSeuil || plan.octets > plan.reglages.octetsSeuil)
    ) {
      res.json({ etat: "a_confirmer", ...volume });
      return;
    }

    let compose: { pdf: Buffer; pages: number };
    try {
      compose = await composerLImpression({
        societes: plan.societes,
        mentions: plan.mentions,
        sens: plan.sens,
        composeLe: plan.composeLe,
        pagesMax: plan.reglages.pagesMax,
        charger: (id) =>
          readFile(plan.chemins.get(id)!).then(
            (o) => new Uint8Array(o),
            () => null,
          ),
      });
    } catch (erreur) {
      // La base connaissait moins de pages que les originaux n'en portent.
      if (!(erreur instanceof ImpressionTropVolumineuse)) throw erreur;
      res.json({ etat: "trop_volumineuse", ...volume });
      return;
    }

    await sousLAppelant(req, (db) =>
      db.query(`select public.impression_journaliser($1::uuid[], $2, $3, $4)`, [
        plan.pieces,
        demande.portee,
        compose.pages,
        compose.pdf.length,
      ]),
    );
    enTetesDuContenu(res, "application/pdf", compose.pdf.length, null);
    res.setHeader("X-Malica-Pages", String(compose.pages));
    res.end(compose.pdf);
  } catch (erreur) {
    const absent = introuvableLisible(erreur);
    if (absent) {
      res.locals["refus"] = absent;
      res.status(404).json({ erreur: absent });
      return;
    }
    // Une règle qui refuse (un impayé suspend l'export) se dit par sa clé.
    const refus = refusLisible(erreur);
    if (refus) {
      res.locals["refus"] = refus;
      res.status(400).json({ erreur: refus });
      return;
    }
    throw erreur;
  }
}
