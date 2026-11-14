/**
 * Exporter la bibliothèque — les pièces d'une société à un comptable extérieur.
 *
 * `POST /exports/bibliotheque` prépare UN ZIP des originaux, rangés par
 * dossier, et/ou UN Excel d'une ligne par pièce, puis les GARDE : le fichier
 * se relit par `GET /exports/:id/contenu`, sous la même RLS que les exports du
 * journal (`stockage.ts`). Le geste est celui d'« Imprimer » (`impression.ts`) :
 * mêmes pièces (`documentsAImprimer`), même réglage lu à la base, même refus.
 *
 *   — DROITS. On n'exporte que ce qu'on voit, d'une société dont on est
 *     membre : une pièce de l'espace privé ou d'une autre société fait refuser
 *     l'export entier. La base le redit à l'inscription (la porte).
 *   — R3. Aucun calcul : les montants sont ceux de la lecture, en chaînes
 *     décimales, sans total. Un fichier de plusieurs sociétés range un dossier
 *     (ZIP) et une feuille (Excel) par société, sans rien additionner.
 *   — LIMITES. La taille, la conservation et le nombre de préparations
 *     simultanées viennent de la base (`export_reglages_lire`), jamais du code.
 *   — RIEN D'ÉCRIT SANS PORTE. Le fichier n'est gardé qu'après son inscription,
 *     dans la même transaction : si l'écriture des octets échoue, rien n'est
 *     inscrit.
 *
 * La préparation se fait HORS transaction (elle dure plus qu'une connexion ne
 * doit rester prise) : la première lit, la seconde inscrit et garde.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { zipSync } from "fflate";
import type { Request, Response } from "express";
import { z } from "zod";

import { documentsAImprimer } from "./bibliotheque.ts";
import { sousLAppelant } from "./cles-api.ts";
import type { Requete } from "./db.ts";
import { introuvableLisible, refusLisible } from "./refus.ts";
import { garderUnExport, originauxDesPieces, retirerLesExportsExpires } from "./stockage.ts";
import { classeurXlsx, TYPE_MIME_XLSX, type Cellule, type Feuille } from "./xlsx.ts";

const Demande = z
  .object({
    pieces: z.array(z.string().uuid()).min(1).max(2000),
    langue: z.enum(["fr", "en", "ar"]),
    /** Les originaux, rangés par dossier. */
    zip: z.boolean(),
    /** Une ligne par pièce. */
    excel: z.boolean(),
  })
  .refine((d) => d.zip || d.excel);
type Demande = z.infer<typeof Demande>;

interface Reglages {
  octetsMax: number;
  conservationJours: number;
  simultanesMax: number;
}

interface PieceAExporter {
  id: string;
  reference: string | null;
  type: string | null;
  tiers: string | null;
  date: string;
  montant: string | null;
  devise: string;
  dossier: string | null;
  extension: string;
  chemin: string;
  octets: number;
}

interface SocieteAExporter {
  id: string;
  nom: string;
  pieces: PieceAExporter[];
}

interface Plan {
  societes: SocieteAExporter[];
  pieces: string[];
  mentions: Record<string, string>;
  types: Record<string, string>;
  dossiers: Record<string, string>;
  octets: number;
  reglages: Reglages;
  instant: Date;
}

/** Ce que l'extension d'un original dit de son contenu ; sans correspondance, `bin`. */
const EXTENSION_DU_TYPE: Readonly<Record<string, string>> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

/** Un nom que tout système de fichiers et tout tableur acceptent. */
function nomSur(brut: string, max = 80): string {
  const net = brut
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\\/:*?"<>|[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, max)
    .trim();
  return net === "" ? "—" : net;
}

const jour = (iso: string) => iso.split("-").reverse().join("/");

async function preparer(db: Requete, demande: Demande): Promise<Plan> {
  const societes = await documentsAImprimer(db, null, demande.pieces);
  // Une société dont on n'est pas membre se lisait sous mandat : l'export, lui,
  // est celui des MEMBRES de la société (la base le redit à l'inscription).
  const { rows: miennes } = await db.query<{ id: string }>(
    `select id from unnest($1::uuid[]) as s(id) where id in (select app.member_orgs())`,
    [societes.map((s) => s.tenantId)],
  );
  if (miennes.length !== societes.length)
    throw Object.assign(new Error("refus.introuvable.dossier"), { code: "42501" });

  const pieces = societes.flatMap((s) => s.documents.map((d) => d.id));
  const originaux = await originauxDesPieces(db, pieces);
  const { rows: reglage } = await db.query<{ r: Reglages | null }>(
    `select public.export_reglages_lire() as r`,
  );
  if (!reglage[0]?.r)
    throw Object.assign(new Error("réglage des limites d'export absent"), { code: "22023" });

  // Le contenu technique et le dossier de chaque pièce : le dossier est celui de
  // son type, ou celui de la vente quand la lecture a lu une vente (`ref.document_types`).
  const { rows: details } = await db.query<{
    id: string;
    content_type: string | null;
    dossier: string | null;
  }>(
    `select p.id, p.content_type,
            coalesce(case when dt.dossier_si_vente is not null
                           and x.payload ->> 'document_kind' = 'facture_vente'
                          then dt.dossier_si_vente end, dt.dossier) as dossier
       from pieces_v p
       left join ref.document_types dt on dt.code = p.document_kind
       left join lateral (select payload from extractions_v x
                           where x.piece_id = p.id
                           order by created_at desc, id desc limit 1) x on true
      where p.id = any($1::uuid[])`,
    [pieces],
  );
  const detail = new Map(details.map((d) => [d.id, d]));

  const { rows: libelles } = await db.query<{
    ns: string;
    key: string;
    locale: string;
    value: string;
  }>(
    `select ns, key, locale, value from ref.labels
      where ns in ('export_bibliotheque', 'document_type', 'dossier')
        and locale = any($1::text[])`,
    [[demande.langue, "fr"]],
  );
  // La langue demandée, à défaut le français : un libellé jamais en carrés vides ni absent.
  const dans = (ns: string) => {
    const choisis: Record<string, string> = {};
    for (const l of libelles.filter((x) => x.ns === ns && x.locale === "fr"))
      choisis[l.key] = l.value;
    for (const l of libelles.filter((x) => x.ns === ns && x.locale === demande.langue))
      choisis[l.key] = l.value;
    return choisis;
  };

  const { rows: instant } = await db.query<{ le: Date }>(`select now() as le`);
  const aExporter: SocieteAExporter[] = societes.map((s) => ({
    id: s.tenantId,
    nom: s.nom,
    pieces: s.documents.map((d) => {
      const o = originaux.get(d.id);
      const t = detail.get(d.id);
      return {
        id: d.id,
        reference: d.reference,
        type: d.type,
        tiers: d.tiers,
        date: d.dateDeClassement,
        montant: d.montant,
        devise: d.devise,
        dossier: t?.dossier ?? null,
        extension: EXTENSION_DU_TYPE[t?.content_type ?? ""] ?? "bin",
        chemin: o?.chemin ?? "",
        octets: o?.octets ?? 0,
      };
    }),
  }));
  return {
    societes: aExporter,
    pieces,
    mentions: dans("export_bibliotheque"),
    types: dans("document_type"),
    dossiers: dans("dossier"),
    octets: aExporter.reduce((n, s) => n + s.pieces.reduce((m, p) => m + p.octets, 0), 0),
    reglages: reglage[0].r,
    instant: instant[0]!.le,
  };
}

/** « 2026-11 » ou « 2026-10_2026-11 » : la période d'un lot, pour nommer le fichier. */
function periodeDuNom(dates: readonly string[]): string {
  const mois = [...new Set(dates.map((d) => d.slice(0, 7)))].sort();
  if (mois.length === 0) return "";
  return mois.length === 1 ? mois[0]! : `${mois[0]!}_${mois.at(-1)!}`;
}

/** Le nom d'une pièce dans le ZIP : date, tiers ou type, puis de quoi la retrouver. */
function nomDansLeZip(p: PieceAExporter, plan: Plan): string {
  const libre = p.tiers ?? (p.type ? (plan.types[p.type] ?? p.type) : null) ?? "";
  const base = [p.date, libre === "" ? null : nomSur(libre, 40), p.id.slice(0, 8)]
    .filter((x): x is string => x !== null)
    .join("_");
  return `${base}.${p.extension}`;
}

/** Le dossier d'une pièce, dit dans la langue demandée. */
function dossierDe(p: PieceAExporter, plan: Plan): string {
  if (p.dossier === null) return plan.mentions["sans_dossier"] ?? "—";
  return nomSur(plan.dossiers[p.dossier] ?? p.dossier);
}

/** Les chemins dans le ZIP : un dossier par société quand il y en a plusieurs. */
function cheminsDuZip(plan: Plan): Map<string, string> {
  const plusieurs = plan.societes.length > 1;
  const chemins = new Map<string, string>();
  const pris = new Set<string>();
  for (const s of plan.societes) {
    for (const p of s.pieces) {
      const parts = [plusieurs ? nomSur(s.nom) : null, dossierDe(p, plan), nomDansLeZip(p, plan)];
      let chemin = parts.filter((x): x is string => x !== null).join("/");
      // Deux pièces au même nom (huit caractères d'identifiant communs) ne s'écrasent pas.
      while (pris.has(chemin)) chemin = chemin.replace(/(\.[^./]+)$/, "_$1");
      pris.add(chemin);
      chemins.set(p.id, chemin);
    }
  }
  return chemins;
}

async function composerLeZip(
  plan: Plan,
  chemins: Map<string, string>,
): Promise<{ octets: Uint8Array; absents: Set<string> }> {
  const entrees: Record<string, Uint8Array> = {};
  const absents = new Set<string>();
  for (const s of plan.societes) {
    for (const p of s.pieces) {
      const octets = p.chemin
        ? await readFile(p.chemin).then(
            (o) => new Uint8Array(o),
            () => null,
          )
        : null;
      // Un original absent ne se devine pas : la ligne de l'Excel le dit.
      if (octets) entrees[chemins.get(p.id)!] = octets;
      else absents.add(p.id);
    }
  }
  // Les photos et les PDF sont déjà compressés : on range sans recompresser.
  return { octets: zipSync(entrees, { level: 0, mtime: plan.instant }), absents };
}

function composerLExcel(
  plan: Plan,
  langue: Demande["langue"],
  avecZip: boolean,
  chemins: Map<string, string>,
  absents: ReadonlySet<string>,
): Uint8Array {
  const m = plan.mentions;
  const entete = [
    m["date"],
    m["tiers"],
    m["type"],
    m["montant"],
    m["devise"],
    m["dossier"],
    m["reference"],
    ...(avecZip ? [m["fichier"]] : []),
  ].map((x) => x ?? "—");
  const texte = (t: string | null): Cellule => ({ texte: t ?? "" });
  const noms = new Set<string>();
  const feuilles: Feuille[] = plan.societes.map((s) => {
    // Une feuille par société quand il y en a plusieurs ; une seule se nomme « Pièces ».
    let nom = plan.societes.length > 1 ? nomSur(s.nom, 31) : (m["feuille_pieces"] ?? "—");
    for (let i = 2; noms.has(nom.toLowerCase()); i++) nom = `${nomSur(s.nom, 27)} ${i}`;
    noms.add(nom.toLowerCase());
    return {
      nom,
      entete,
      droiteAGauche: langue === "ar",
      lignes: s.pieces.map((p) => [
        texte(jour(p.date)),
        texte(p.tiers),
        texte(p.type ? (plan.types[p.type] ?? p.type) : null),
        // Le montant tel que lu : une chaîne décimale, jamais un flottant.
        p.montant === null ? texte(null) : { montant: p.montant },
        texte(p.montant === null ? null : p.devise),
        texte(dossierDe(p, plan)),
        texte(p.reference),
        ...(avecZip
          ? [texte(absents.has(p.id) ? (m["original_absent"] ?? "—") : chemins.get(p.id)!)]
          : []),
      ]),
    };
  });
  return classeurXlsx(feuilles, plan.instant);
}

const empreinte = (octets: Uint8Array) => createHash("sha256").update(octets).digest("hex");

/**
 * Combien de préparations en cours, par société. Au-delà du réglage de la base,
 * la demande est refusée plutôt que de mettre l'API à genoux : la personne
 * réessaie, rien n'est inscrit.
 */
export const preparationsEnCours = new Map<string, number>();

/**
 * `POST /exports/bibliotheque`. Répond les fichiers gardés (leur identifiant,
 * à relire par `/exports/:id/contenu`), ou un constat : `trop_volumineuse`
 * (au-delà de la taille maximale), ou 429 `refus.export.trop_de_demandes`.
 */
export async function exporterLaBibliotheque(req: Request, res: Response): Promise<void> {
  const saisie = Demande.safeParse(req.body);
  if (!saisie.success) {
    res.status(400).json({ erreur: "refus.saisie.mal_formee" });
    return;
  }
  const demande = saisie.data;
  let ancre: string | null = null;
  try {
    const plan = await sousLAppelant(req, (db) => preparer(db, demande));
    ancre = plan.societes[0]!.id;
    if (plan.octets > plan.reglages.octetsMax) {
      res.json({
        etat: "trop_volumineuse",
        octets: plan.octets,
        octetsMax: plan.reglages.octetsMax,
      });
      return;
    }
    if ((preparationsEnCours.get(ancre) ?? 0) >= plan.reglages.simultanesMax) {
      res.locals["refus"] = "refus.export.trop_de_demandes";
      res.status(429).json({ erreur: "refus.export.trop_de_demandes" });
      return;
    }
    preparationsEnCours.set(ancre, (preparationsEnCours.get(ancre) ?? 0) + 1);
    try {
      const chemins = cheminsDuZip(plan);
      const dates = plan.societes.flatMap((s) => s.pieces.map((p) => p.date)).sort();
      const nomDeBase = [
        nomSur(plan.societes.length > 1 ? "" : plan.societes[0]!.nom, 60),
        periodeDuNom(dates),
      ]
        .filter((x) => x !== "" && x !== "—")
        .join("_");

      const fichiers: Array<{
        format: "bibliotheque_zip" | "bibliotheque_xlsx";
        nom: string;
        typeMime: string;
        octets: Uint8Array;
      }> = [];
      let absents = new Set<string>();
      if (demande.zip) {
        const zip = await composerLeZip(plan, chemins);
        absents = zip.absents;
        fichiers.push({
          format: "bibliotheque_zip",
          nom: `${nomDeBase || "export"}.zip`,
          typeMime: "application/zip",
          octets: zip.octets,
        });
      }
      if (demande.excel)
        fichiers.push({
          format: "bibliotheque_xlsx",
          nom: `${nomDeBase || "export"}.xlsx`,
          typeMime: TYPE_MIME_XLSX,
          octets: composerLExcel(plan, demande.langue, demande.zip, chemins, absents),
        });

      const du = dates[0]!;
      const au = dates.at(-1)!;
      const gardes = await sousLAppelant(req, async (db) => {
        const sortie: Array<{
          id: string;
          format: string;
          nomDeFichier: string;
          taille: number;
          expireLe: string;
        }> = [];
        for (const f of fichiers) {
          const { rows } = await db.query<{ r: { id: string; expireLe: string } }>(
            `select public.export_bibliotheque_inscrire($1, $2::uuid[], $3, $4, $5, $6, $7, $8,
                                                        $9::date, $10::date) as r`,
            [
              ancre,
              plan.pieces,
              f.format,
              plan.pieces.length,
              f.octets.length,
              empreinte(f.octets),
              f.nom,
              f.typeMime,
              du,
              au,
            ],
          );
          const inscrit = rows[0]!.r;
          // Dans la transaction : si les octets ne s'écrivent pas, rien n'est inscrit.
          await garderUnExport(ancre!, inscrit.id, f.octets);
          sortie.push({
            id: inscrit.id,
            format: f.format,
            nomDeFichier: f.nom,
            taille: f.octets.length,
            expireLe: inscrit.expireLe,
          });
        }
        return sortie;
      });
      // La conservation : ce qui a expiré se retire à l'occasion d'un nouvel export.
      await sousLAppelant(req, (db) => retirerLesExportsExpires(db)).catch(() => undefined);
      res.json({ etat: "pret", fichiers: gardes, pieces: plan.pieces.length });
    } finally {
      const n = (preparationsEnCours.get(ancre) ?? 1) - 1;
      if (n <= 0) preparationsEnCours.delete(ancre);
      else preparationsEnCours.set(ancre, n);
    }
  } catch (erreur) {
    const absent = introuvableLisible(erreur);
    if (absent) {
      res.locals["refus"] = absent;
      res.status(404).json({ erreur: absent });
      return;
    }
    const refus = refusLisible(erreur);
    if (refus) {
      res.locals["refus"] = refus;
      res.status(400).json({ erreur: refus });
      return;
    }
    throw erreur;
  }
}
