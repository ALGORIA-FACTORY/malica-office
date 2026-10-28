/**
 * Le journal du jour du comptable, et ses exports numérotés.
 *
 * ============================================================== POURQUOI
 *
 * Spec « Malica sans blocage », section 4 : le comptable finit sa journée sur
 * un journal — ce qu'il a validé, ce qu'il a forcé, ce qu'il a contre-passé —
 * rangé par journal, contrôlé débit = crédit, qu'il exporte en Excel ou en
 * CSV. Chaque export est numéroté et gardé ; le suivant dit ce qui a changé.
 *
 * La base porte les définitions : ce qui est « inscrit ce jour-là » et
 * l'origine d'une écriture vivent dans `journal_du_jour_lire`, le numéro et
 * la trace dans `journal_export_journaliser`. Ici on range, on additionne
 * (en entiers, `sommeDecimale`), on compare deux exports, on met en forme
 * avec le moteur des exports — mêmes séparateurs, même encodage, mêmes
 * montants cadrés sans flottant.
 *
 * Le journal reste modifiable au sens comptable (R7) : une correction est une
 * contre-passation et une écriture nouvelle ; toutes deux y paraissent le
 * jour où elles sont inscrites. Rien ici n'écrit une écriture.
 */

import type {
  EcartDepuisLExport,
  EcritureAuJournal,
  FormatDuJournal,
  JournalAuJour,
  JournalDuJour,
  JournalExporte,
  OrigineAuJournal,
  SoldeDuJournal,
} from "@malica/socle/ports/repositories";
import { sommeDecimale } from "@malica/socle/somme-decimale";

import type { Requete } from "../db.ts";
import { classeurXlsx, TYPE_MIME_XLSX, type Cellule } from "../xlsx.ts";
import { dec } from "./decimal.ts";
import {
  contexteDExport,
  dateFec,
  empreinte,
  formaterCsv,
  RefusExport,
  tailleEnOctets,
  TYPE_MIME_CSV,
  type FormatDuJournalExporte,
} from "./exports.ts";

/** Les colonnes du fichier, les mêmes en CSV et en Excel. */
export const COLONNES_JOURNAL_DU_JOUR = [
  "dossier",
  "journal",
  "journal_libelle",
  "ecriture",
  "heure",
  "libelle",
  "compte",
  "compte_libelle",
  "debit",
  "credit",
  "devise",
  "origine",
  "par",
  "changement",
] as const;

const INDICE_DEBIT = COLONNES_JOURNAL_DU_JOUR.indexOf("debit");
const INDICE_CREDIT = COLONNES_JOURNAL_DU_JOUR.indexOf("credit");
const INDICE_DEVISE = COLONNES_JOURNAL_DU_JOUR.indexOf("devise");

/** Ce qu'un export a figé : ses écritures, et celles qui y étaient déjà contre-passées. */
export interface InstantaneDuJournal {
  ecritures: readonly string[];
  contrePassees: readonly string[];
}

/** Ce qui a changé entre deux instantanés du même journal. */
export function ecartEntre(
  precedent: InstantaneDuJournal,
  courant: InstantaneDuJournal,
): EcartDepuisLExport {
  const avant = new Set(precedent.ecritures);
  const maintenant = new Set(courant.ecritures);
  const dejaContrePassees = new Set(precedent.contrePassees);
  return {
    ajoutees: courant.ecritures.filter((id) => !avant.has(id)).length,
    contrePassees: courant.contrePassees.filter((id) => avant.has(id) && !dejaContrePassees.has(id))
      .length,
    retirees: precedent.ecritures.filter((id) => !maintenant.has(id)).length,
  };
}

/** Le changement d'une écriture depuis l'export précédent, tel que le fichier l'écrit. */
function changementDe(
  e: EcritureAuJournal,
  precedent: InstantaneDuJournal | null,
): "" | "ajoutee" | "contre_passee" {
  if (!precedent) return "";
  if (!precedent.ecritures.includes(e.id)) return "ajoutee";
  if (e.contrePasseeLe && !precedent.contrePassees.includes(e.id)) return "contre_passee";
  return "";
}

/** Toutes les écritures du jour, journal après journal. */
function toutesLesEcritures(journaux: readonly JournalAuJour[]): EcritureAuJournal[] {
  return journaux.flatMap((j) => j.ecritures);
}

/** L'instantané du journal tel qu'il est. */
export function instantaneDe(journaux: readonly JournalAuJour[]): InstantaneDuJournal {
  const ecritures = toutesLesEcritures(journaux);
  return {
    ecritures: ecritures.map((e) => e.id),
    contrePassees: ecritures.filter((e) => e.contrePasseeLe).map((e) => e.id),
  };
}

/** Les totaux par devise, additionnés en entiers. */
function soldesDe(ecritures: readonly EcritureAuJournal[], decimales: number): SoldeDuJournal[] {
  const parDevise = new Map<string, EcritureAuJournal[]>();
  for (const e of ecritures) parDevise.set(e.devise, [...(parDevise.get(e.devise) ?? []), e]);
  return [...parDevise.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([devise, liste]) => {
      const debit = sommeDecimale(
        liste.map((e) => e.debit),
        decimales,
      );
      const credit = sommeDecimale(
        liste.map((e) => e.credit),
        decimales,
      );
      return { devise, debit, credit, equilibre: debit === credit };
    });
}

/** Une ligne du journal telle que la base la rend. */
interface LigneLue {
  client_tenant_id: string;
  client_nom: string;
  ecriture_id: string;
  journal: string;
  journal_libelle: string;
  piece_id: string | null;
  ecriture_libelle: string;
  ordinal: number;
  compte: string;
  compte_libelle: string;
  debit: string;
  credit: string;
  devise: string;
  origine: OrigineAuJournal;
  inscrite_le: Date;
  heure: string;
  par: string | null;
  reverses_id: string | null;
  contre_passee_le: Date | null;
}

/**
 * Range les lignes lues en journaux, puis en écritures, dans l'ordre de la
 * base (le rang du journal, puis l'heure). Pur : se prouve sans base.
 */
export function rangerLeJournal(lignes: readonly LigneLue[], decimales: number): JournalAuJour[] {
  const journaux = new Map<
    string,
    { libelle: string; ecritures: Map<string, EcritureAuJournal> }
  >();
  for (const l of lignes) {
    let j = journaux.get(l.journal);
    if (!j) {
      j = { libelle: l.journal_libelle, ecritures: new Map() };
      journaux.set(l.journal, j);
    }
    let e = j.ecritures.get(l.ecriture_id);
    if (!e) {
      e = {
        id: l.ecriture_id,
        clientTenantId: l.client_tenant_id,
        clientNom: l.client_nom,
        pieceId: l.piece_id,
        libelle: l.ecriture_libelle,
        devise: l.devise,
        origine: l.origine,
        inscriteLe: new Date(l.inscrite_le).toISOString(),
        heure: l.heure,
        par: l.par,
        contrePasse: l.reverses_id,
        contrePasseeLe: l.contre_passee_le ? new Date(l.contre_passee_le).toISOString() : null,
        debit: "0",
        credit: "0",
        lignes: [],
      };
      j.ecritures.set(l.ecriture_id, e);
    }
    e.lignes.push({
      ordinal: Number(l.ordinal),
      compte: l.compte,
      compteLibelle: l.compte_libelle,
      debit: dec(l.debit, decimales),
      credit: dec(l.credit, decimales),
    });
  }
  return [...journaux.entries()].map(([code, j]) => {
    const ecritures = [...j.ecritures.values()].map((e) => ({
      ...e,
      debit: sommeDecimale(
        e.lignes.map((l) => l.debit),
        decimales,
      ),
      credit: sommeDecimale(
        e.lignes.map((l) => l.credit),
        decimales,
      ),
    }));
    return { code, libelle: j.libelle, ecritures, soldes: soldesDe(ecritures, decimales) };
  });
}

/** Les lignes du fichier : une par ligne d'écriture, journal après journal. */
function rangeesDuFichier(
  journaux: readonly JournalAuJour[],
  precedent: InstantaneDuJournal | null,
): Cellule[][] {
  return journaux.flatMap((j) =>
    j.ecritures.flatMap((e) => {
      const changement = changementDe(e, precedent);
      return e.lignes.map((l) => [
        { texte: e.clientNom },
        { texte: j.code },
        { texte: j.libelle },
        { texte: e.id },
        { texte: e.heure },
        { texte: e.libelle },
        { texte: l.compte },
        { texte: l.compteLibelle },
        { montant: l.debit },
        { montant: l.credit },
        { texte: e.devise },
        { texte: e.origine },
        { texte: e.par ?? "" },
        { texte: changement },
      ]);
    }),
  );
}

/** Le texte d'une cellule, tel qu'un CSV l'écrit. */
function texteDe(c: Cellule): string {
  return "montant" in c ? c.montant : c.texte;
}

/** Les lignes de total d'un classeur : une par devise, montants sous leurs colonnes. */
function totauxDuClasseur(soldes: readonly SoldeDuJournal[]): Cellule[][] {
  return soldes.map((s) =>
    COLONNES_JOURNAL_DU_JOUR.map((_, i): Cellule => {
      if (i === 0) return { texte: "total" };
      if (i === INDICE_DEBIT) return { montant: s.debit };
      if (i === INDICE_CREDIT) return { montant: s.credit };
      if (i === INDICE_DEVISE) return { texte: s.devise };
      return { texte: "" };
    }),
  );
}

interface DernierExportLu extends InstantaneDuJournal {
  numero: number;
  format: FormatDuJournalExporte;
  createdAt: string;
  auteur: string | null;
}

/** Le dernier export du journal de ce jour, pour ce périmètre. Sous RLS : le cabinet seul le lit. */
async function dernierExport(
  db: Requete,
  cabinetTenantId: string,
  clientTenantId: string | null,
  jour: string,
): Promise<DernierExportLu | null> {
  const { rows } = await db.query(
    `select x.numero, x.format, x.created_at, x.ecritures::text[] as ecritures,
            x.contre_passees::text[] as contre_passees, m.email as auteur
       from exports_v x
       left join cabinet_members_v m on m.user_id = x.created_by and m.tenant_id = x.tenant_id
      where x.tenant_id = $1
        and x.client_tenant_id is not distinct from $2::uuid
        and x.du = $3::date
        and x.numero is not null
      order by x.numero desc
      limit 1`,
    [cabinetTenantId, clientTenantId, jour],
  );
  const r = (rows as Record<string, unknown>[])[0];
  if (!r) return null;
  return {
    numero: Number(r["numero"]),
    format: r["format"] as FormatDuJournalExporte,
    createdAt: new Date(r["created_at"] as string).toISOString(),
    auteur: (r["auteur"] as string | null) ?? null,
    ecritures: (r["ecritures"] as string[]) ?? [],
    contrePassees: (r["contre_passees"] as string[]) ?? [],
  };
}

async function lireLeJournal(
  db: Requete,
  cabinetTenantId: string,
  clientTenantId: string | null,
  jour: string,
  fuseau: string,
  locale: string,
  decimales: number,
): Promise<JournalAuJour[]> {
  const { rows } = await db.query<LigneLue>(
    `select client_tenant_id, client_nom, ecriture_id, journal, journal_libelle, piece_id,
            ecriture_libelle, ordinal, compte, compte_libelle, debit::text as debit,
            credit::text as credit, devise, origine, inscrite_le, heure, par, reverses_id,
            contre_passee_le
       from public.journal_du_jour_lire($1, $2, $3::date, $4, $5)`,
    [cabinetTenantId, clientTenantId, jour, fuseau, locale],
  );
  return rangerLeJournal(rows, decimales);
}

const FORMATS: Record<FormatDuJournal, FormatDuJournalExporte> = {
  csv: "journal_csv",
  xlsx: "journal_xlsx",
};
const FORMAT_LU: Record<FormatDuJournalExporte, FormatDuJournal> = {
  journal_csv: "csv",
  journal_xlsx: "xlsx",
};

function estFormat(v: string): v is FormatDuJournal {
  return Object.hasOwn(FORMATS, v);
}

/** Un jour s'écrit AAAA-MM-JJ : la base refuserait le reste, on le dit avant. */
function verifierLeJour(jour: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(jour)) throw new RefusExport("le jour s'écrit AAAA-MM-JJ");
}

export const journalDuJour = {
  async lire(
    db: Requete,
    cabinetTenantId: string,
    clientTenantId: string | null,
    jour: string,
    fuseau: string,
    locale: string,
  ): Promise<JournalDuJour> {
    verifierLeJour(jour);
    const ctx = await contexteDExport(db, cabinetTenantId, clientTenantId);
    const journaux = await lireLeJournal(
      db,
      cabinetTenantId,
      clientTenantId,
      jour,
      fuseau,
      locale,
      ctx.decimales,
    );
    const ecritures = toutesLesEcritures(journaux);
    const compte = (o: OrigineAuJournal) => ecritures.filter((e) => e.origine === o).length;
    const dernier = await dernierExport(db, cabinetTenantId, clientTenantId, jour);
    return {
      jour,
      journaux,
      totaux: {
        ecritures: ecritures.length,
        validees: compte("validee"),
        forcees: compte("forcee"),
        contrePassations: compte("contre_passation"),
        soldes: soldesDe(ecritures, ctx.decimales),
      },
      dernierExport: dernier
        ? {
            numero: dernier.numero,
            format: FORMAT_LU[dernier.format],
            createdAt: dernier.createdAt,
            auteur: dernier.auteur,
            ecart: ecartEntre(dernier, instantaneDe(journaux)),
          }
        : null,
    };
  },

  /**
   * Produit le fichier, le numérote, le journalise, et rend son contenu.
   *
   * Le numéro est dans le fichier, l'empreinte porte le fichier : il faut
   * donc connaître le numéro AVANT d'écrire. Un verrou de transaction, propre
   * au cabinet, au dossier et au jour, sérialise deux exports simultanés ; la
   * base vérifie encore que le numéro suit le dernier, et l'index unique
   * tranche en dernier recours.
   */
  async exporter(
    db: Requete,
    cabinetTenantId: string,
    clientTenantId: string | null,
    jour: string,
    fuseau: string,
    locale: string,
    format: string,
  ): Promise<JournalExporte> {
    if (!estFormat(format)) throw new RefusExport("ce format d'export n'existe pas");
    verifierLeJour(jour);
    const ctx = await contexteDExport(db, cabinetTenantId, clientTenantId);

    await db.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [
      `journal-du-jour:${cabinetTenantId}:${clientTenantId ?? "*"}:${jour}`,
    ]);
    const precedent = await dernierExport(db, cabinetTenantId, clientTenantId, jour);
    const journaux = await lireLeJournal(
      db,
      cabinetTenantId,
      clientTenantId,
      jour,
      fuseau,
      locale,
      ctx.decimales,
    );
    const numero = (precedent?.numero ?? 0) + 1;
    const instantane = instantaneDe(journaux);
    const ecart = precedent
      ? ecartEntre(precedent, instantane)
      : { ajoutees: 0, contrePassees: 0, retirees: 0 };
    const rangees = rangeesDuFichier(journaux, precedent);
    const nom = `journal-${ctx.nomDuPerimetre}-${dateFec(jour)}-n${numero}.${format}`;

    let octets: string | Uint8Array;
    let typeMime: string;
    if (format === "xlsx") {
      octets = classeurXlsx(
        {
          nom: dateFec(jour),
          entete: COLONNES_JOURNAL_DU_JOUR,
          lignes: rangees,
          totaux: totauxDuClasseur(soldesDe(toutesLesEcritures(journaux), ctx.decimales)),
          droiteAGauche: locale === "ar",
        },
        ctx.decimales,
        // Les entrées de l'archive sont datées du jour exporté : même contenu,
        // mêmes octets.
        new Date(`${jour}T12:00:00`),
      );
      typeMime = TYPE_MIME_XLSX;
    } else {
      octets = formaterCsv(
        COLONNES_JOURNAL_DU_JOUR,
        rangees.map((r) => r.map(texteDe)),
      );
      typeMime = TYPE_MIME_CSV;
    }

    const taille = tailleEnOctets(octets);
    const sha = empreinte(octets);
    const { rows } = await db.query<{ id: string }>(
      `select public.journal_export_journaliser($1, $2, $3::date, $4, $5, $6, $7, $8, $9,
                                                $10::uuid[], $11::uuid[], $12::jsonb) as id`,
      [
        cabinetTenantId,
        clientTenantId,
        jour,
        FORMATS[format],
        numero,
        rangees.length,
        taille,
        sha,
        ctx.packId,
        instantane.ecritures,
        instantane.contrePassees,
        JSON.stringify({ precedent: precedent?.numero ?? null, ...ecart, fuseau }),
      ],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error("journal_du_jour.non_journalise");
    return {
      id,
      numero,
      nomDeFichier: nom,
      typeMime,
      contenu: typeof octets === "string" ? octets : Buffer.from(octets).toString("base64"),
      encodage: typeof octets === "string" ? "utf8" : "base64",
      taille,
      lignes: rangees.length,
      empreinte: sha,
      precedent: precedent?.numero ?? null,
      ecart,
    };
  },
};
