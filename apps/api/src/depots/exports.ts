/**
 * Les exports du cabinet — FEC et CSV.
 *
 * ============================================================== POURQUOI
 *
 * Un cabinet qui ne peut pas partir n'est pas un client, c'est un otage. Ce
 * dépôt sort les écritures COMPTABILISÉES telles que la base les tient : la
 * fonction `export_lignes_lire` porte la définition de « comptabilisé », le
 * numéro d'écriture, les libellés de journal et de compte. Ici on ne décide
 * rien : on met en forme, on mesure, on empreint, on journalise.
 *
 * Les trois formats sont des affaires de fichier, pas de droit : le FEC
 * aligne dix-huit colonnes séparées par des barres, les CSV portent une
 * marque d'ordre d'octets pour qu'un tableur les ouvre en UTF-8. Les montants
 * sortent avec la précision du pack — jamais une décimale posée ici.
 *
 * Les fonctions de mise en forme sont pures et exportées : elles se prouvent
 * sans base ni réseau (voir `exports.test.ts`).
 */

import { createHash } from "node:crypto";

import type { Requete } from "../db.ts";
import { dec } from "./decimal.ts";
import { referentiel } from "./referentiel.ts";

/** Les formats que ce dépôt sait produire. Le libellé humain vit dans l'écran. */
const FORMATS_EXPORT = ["fec", "csv_ecritures", "csv_plan"] as const;
type FormatExport = (typeof FORMATS_EXPORT)[number];

/** Les dix-huit colonnes du fichier des écritures comptables, dans l'ordre du format. */
export const COLONNES_FEC = [
  "JournalCode",
  "JournalLib",
  "EcritureNum",
  "EcritureDate",
  "CompteNum",
  "CompteLib",
  "CompAuxNum",
  "CompAuxLib",
  "PieceRef",
  "PieceDate",
  "EcritureLib",
  "Debit",
  "Credit",
  "EcritureLet",
  "DateLet",
  "ValidDate",
  "Montantdevise",
  "Idevise",
] as const;

/** Les colonnes du CSV des écritures — un grand livre à plat. */
export const COLONNES_CSV_ECRITURES = [
  "dossier",
  "journal",
  "journal_libelle",
  "numero",
  "date",
  "compte",
  "compte_libelle",
  "libelle",
  "debit",
  "credit",
  "code_taxe",
  "devise",
  "piece",
  "date_piece",
  "comptabilisee_le",
] as const;

/** Les colonnes du CSV du plan comptable. */
const COLONNES_CSV_PLAN = ["compte", "libelle", "parent", "classe", "origine"] as const;

/** Une ligne comptabilisée, telle que la base la rend pour un fichier. */
export interface LigneExport {
  clientTenantId: string;
  clientNom: string;
  clientLegalId: string | null;
  ecritureId: string;
  numero: number;
  journal: string;
  journalLibelle: string;
  dateEcriture: string;
  ordinal: number;
  compte: string;
  compteLibelle: string;
  pieceRef: string | null;
  pieceDate: string;
  ecritureLibelle: string;
  ligneLibelle: string;
  debit: string;
  credit: string;
  taxCode: string | null;
  valideLe: string;
  devise: string;
}

/** Un compte du plan, tel qu'il sort : le pack livré, puis ce que le cabinet a ouvert. */
interface CompteExport {
  compte: string;
  libelle: string;
  parent: string | null;
  classe: string;
  origine: string;
}

/** La marque d'ordre d'octets : sans elle, un tableur ouvre l'UTF-8 en charabia. */
const BOM = "\uFEFF";
const FIN_DE_LIGNE = "\r\n";
const SEPARATEUR_CSV = ";";
const SEPARATEUR_FEC = "|";

/** AAAAMMJJ, depuis une date ISO. */
export function dateFec(iso: string): string {
  return iso.slice(0, 10).replaceAll("-", "");
}

/** Un champ FEC ne contient ni barre ni saut de ligne : ils deviennent des espaces. */
function champFec(v: string | null | undefined): string {
  return (v ?? "")
    .replace(/[|\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Un champ CSV : entouré de guillemets dès qu'il porte un séparateur, un guillemet ou un saut de ligne. */
function champCsv(v: string | null | undefined): string {
  const s = v ?? "";
  return /[;"\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/**
 * Le FEC, dix-huit colonnes séparées par des barres.
 *
 * Le montant en devise et son code ne sont renseignés que si l'écriture est
 * tenue dans une autre devise que celle du pack : sinon les deux colonnes
 * restent vides, comme le format le demande. Les colonnes de tiers et de
 * lettrage restent vides : le Socle ne porte pas encore ces deux notions
 * sur la ligne, et un fichier légal n'invente pas ce qu'il n'a pas.
 *
 * `EcritureLib` nomme l'ÉCRITURE — « Facture VERRES DE TUNISIE 2026-114 » —,
 * pas la ligne : le libellé d'une ligne est, dans ce produit, celui du
 * compte importé du plan, et `CompteLib` le porte déjà. Le libellé de ligne
 * ne sert que de repli, pour une écriture qui n'en aurait pas.
 */
function libelleDEcriture(l: LigneExport): string {
  return l.ecritureLibelle || l.ligneLibelle;
}
export function formaterFec(
  lignes: LigneExport[],
  decimales: number,
  deviseDuPack: string,
): string {
  const sortie = [COLONNES_FEC.join(SEPARATEUR_FEC)];
  for (const l of lignes) {
    const autreDevise = l.devise !== deviseDuPack;
    const montant = Number(l.debit) !== 0 ? l.debit : l.credit;
    sortie.push(
      [
        champFec(l.journal),
        champFec(l.journalLibelle),
        String(l.numero),
        dateFec(l.dateEcriture),
        champFec(l.compte),
        champFec(l.compteLibelle),
        "",
        "",
        champFec(l.pieceRef),
        dateFec(l.pieceDate),
        champFec(libelleDEcriture(l)),
        dec(l.debit, decimales),
        dec(l.credit, decimales),
        "",
        "",
        dateFec(l.valideLe),
        autreDevise ? dec(montant, decimales) : "",
        autreDevise ? champFec(l.devise) : "",
      ].join(SEPARATEUR_FEC),
    );
  }
  return sortie.join(FIN_DE_LIGNE) + FIN_DE_LIGNE;
}

/** Un CSV : marque d'ordre d'octets, en-tête, lignes. */
function formaterCsv(entete: readonly string[], lignes: string[][]): string {
  const sortie = [entete.join(SEPARATEUR_CSV)];
  for (const l of lignes) sortie.push(l.map(champCsv).join(SEPARATEUR_CSV));
  return BOM + sortie.join(FIN_DE_LIGNE) + FIN_DE_LIGNE;
}

export function formaterCsvEcritures(lignes: LigneExport[], decimales: number): string {
  return formaterCsv(
    COLONNES_CSV_ECRITURES,
    lignes.map((l) => [
      l.clientNom,
      l.journal,
      l.journalLibelle,
      String(l.numero),
      l.dateEcriture,
      l.compte,
      l.compteLibelle,
      libelleDEcriture(l),
      dec(l.debit, decimales),
      dec(l.credit, decimales),
      l.taxCode ?? "",
      l.devise,
      l.pieceRef ?? "",
      l.pieceDate,
      l.valideLe,
    ]),
  );
}

function formaterCsvPlan(comptes: CompteExport[]): string {
  return formaterCsv(
    COLONNES_CSV_PLAN,
    comptes.map((c) => [c.compte, c.libelle, c.parent ?? "", c.classe, c.origine]),
  );
}

/** SHA-256 du contenu, en hexadécimal — l'empreinte que le journal garde. */
export function empreinte(contenu: string): string {
  return createHash("sha256").update(contenu, "utf8").digest("hex");
}

export function tailleEnOctets(contenu: string): number {
  return Buffer.byteLength(contenu, "utf8");
}

/** Un nom de fichier ne garde que lettres et chiffres du nom qu'on lui donne. */
function radical(nom: string): string {
  return nom.normalize("NFD").replace(/[^A-Za-z0-9]+/g, "") || "export";
}

function estFormat(v: string): v is FormatExport {
  return (FORMATS_EXPORT as readonly string[]).includes(v);
}

/**
 * Un refus rédigé pour l'appelant.
 *
 * Il porte le code d'un refus — le même que nos déclencheurs — sans nom de
 * table ni de contrainte : `refusLisible` le reconnaît, et la route le rend
 * en 400 avec sa phrase. Un `Error` nu sortirait en « erreur interne », et
 * l'écran n'aurait rien à dire de plus.
 */
class RefusExport extends Error {
  readonly code = "22023";
}

function versLigne(r: Record<string, unknown>): LigneExport {
  return {
    clientTenantId: r["client_tenant_id"] as string,
    clientNom: (r["client_nom"] as string) ?? "",
    clientLegalId: (r["client_legal_id"] as string | null) ?? null,
    ecritureId: r["ecriture_id"] as string,
    numero: Number(r["numero"]),
    journal: r["journal"] as string,
    journalLibelle: (r["journal_libelle"] as string) ?? "",
    dateEcriture: r["date_ecriture"] as string,
    ordinal: Number(r["ordinal"]),
    compte: r["compte"] as string,
    compteLibelle: (r["compte_libelle"] as string) ?? "",
    pieceRef: (r["piece_ref"] as string | null) ?? null,
    pieceDate: r["piece_date"] as string,
    ecritureLibelle: (r["ecriture_libelle"] as string) ?? "",
    ligneLibelle: (r["ligne_libelle"] as string) ?? "",
    debit: String(r["debit"] ?? "0"),
    credit: String(r["credit"] ?? "0"),
    taxCode: (r["tax_code"] as string | null) ?? null,
    valideLe: r["valide_le"] as string,
    devise: r["devise"] as string,
  };
}

/** Ce qu'un export construit avant d'être journalisé — ou seulement mesuré. */
interface Construit {
  contenu: string;
  lignes: number;
  nomDeFichier: string;
  typeMime: string;
  packId: string;
}

async function lignesDe(
  db: Requete,
  cabinetTenantId: string,
  clientTenantId: string | null,
  du: string,
  au: string,
): Promise<LigneExport[]> {
  const { rows } = await db.query(
    `select client_tenant_id, client_nom, client_legal_id, ecriture_id, numero, journal,
            journal_libelle, date_ecriture, ordinal, compte, compte_libelle, piece_ref,
            piece_date, ecriture_libelle, ligne_libelle, debit, credit, tax_code, valide_le,
            devise
       from public.export_lignes_lire($1, $2, $3, $4)`,
    [cabinetTenantId, clientTenantId, du, au],
  );
  return (rows as Record<string, unknown>[]).map(versLigne);
}

async function planDe(
  db: Requete,
  cabinetTenantId: string,
  packId: string,
): Promise<CompteExport[]> {
  const { rows } = await db.query(
    `select account_code, label, parent_code, account_class, 'pack' as origine
       from ref_accounts_v where pack_version_id = $2
     union all
     select account_code, label, parent_code, account_class, origine
       from plan_comptable_v where tenant_id = $1
     order by 1`,
    [cabinetTenantId, packId],
  );
  return (rows as Record<string, unknown>[]).map((r) => ({
    compte: r["account_code"] as string,
    libelle: (r["label"] as string) ?? "",
    parent: (r["parent_code"] as string | null) ?? null,
    classe: String(r["account_class"] ?? ""),
    origine: r["origine"] as string,
  }));
}

/**
 * Construit le fichier. Le pack en vigueur pour la juridiction du cabinet
 * donne la précision monétaire et la devise de référence ; sans pack, on
 * lève — un export sans précision connue serait un chiffre inventé.
 */
async function construire(
  db: Requete,
  cabinetTenantId: string,
  clientTenantId: string | null,
  du: string,
  au: string,
  format: string,
): Promise<Construit> {
  if (!estFormat(format)) throw new RefusExport("ce format d'export n'existe pas");
  if (format === "fec" && !clientTenantId) {
    throw new RefusExport("le FEC se produit dossier par dossier : choisissez un client");
  }
  if (du > au) throw new RefusExport("la période est à l'envers : le début suit la fin");

  const { rows: orgs } = await db.query(
    `select id, name, legal_id, jurisdiction from organizations_v where id = any($1::uuid[])`,
    [clientTenantId ? [cabinetTenantId, clientTenantId] : [cabinetTenantId]],
  );
  const cabinet = (orgs as Record<string, unknown>[]).find((o) => o["id"] === cabinetTenantId);
  if (!cabinet) throw new RefusExport("cabinet introuvable ou non autorisé");
  const client = clientTenantId
    ? ((orgs as Record<string, unknown>[]).find((o) => o["id"] === clientTenantId) ?? null)
    : null;
  if (clientTenantId && !client) throw new RefusExport("dossier introuvable ou non mandaté");

  const pack = await referentiel.activePack(db, cabinet["jurisdiction"] as string);
  if (!pack) throw new RefusExport("aucun pack en vigueur pour la juridiction du cabinet");
  const params = await referentiel.socleParams(db, pack.id);
  const decimales = params.moneyDecimals;

  const perimetre = client ?? cabinet;
  const nomDuPerimetre = radical(
    (perimetre["legal_id"] as string | null) ?? (perimetre["name"] as string),
  );

  if (format === "csv_plan") {
    const comptes = await planDe(db, cabinetTenantId, pack.id);
    return {
      contenu: formaterCsvPlan(comptes),
      lignes: comptes.length,
      nomDeFichier: `plan-comptable-${radical(cabinet["name"] as string)}-${dateFec(au)}.csv`,
      typeMime: "text/csv;charset=utf-8",
      packId: pack.id,
    };
  }

  const lignes = await lignesDe(db, cabinetTenantId, clientTenantId, du, au);
  if (format === "fec") {
    return {
      contenu: formaterFec(lignes, decimales, pack.currency),
      lignes: lignes.length,
      nomDeFichier: `${nomDuPerimetre}FEC${dateFec(au)}.txt`,
      typeMime: "text/plain;charset=utf-8",
      packId: pack.id,
    };
  }
  return {
    contenu: formaterCsvEcritures(lignes, decimales),
    lignes: lignes.length,
    nomDeFichier: `ecritures-${nomDuPerimetre}-${dateFec(du)}-${dateFec(au)}.csv`,
    typeMime: "text/csv;charset=utf-8",
    packId: pack.id,
  };
}

export const exports = {
  /**
   * Les exercices exportables : ceux qui portent des écritures, plus celui
   * en cours. Les bornes viennent de la clôture inscrite sur la fiche du
   * dossier ; à défaut, l'année civile — et le drapeau le dit.
   */
  async exercices(db: Requete, cabinetTenantId: string, clientTenantId: string | null) {
    const { rows } = await db.query<{
      r: Array<{
        exercice: number;
        du: string;
        au: string;
        clos: boolean;
        clotureConnue: boolean;
        ecritures: number | string;
      }>;
    }>(`select public.export_exercices_lire($1, $2) as r`, [cabinetTenantId, clientTenantId]);
    return (rows[0]?.r ?? []).map((e) => ({
      exercice: Number(e.exercice),
      du: e.du,
      au: e.au,
      clos: Boolean(e.clos),
      clotureConnue: Boolean(e.clotureConnue),
      ecritures: Number(e.ecritures),
    }));
  },

  /** La taille réelle du fichier qui serait produit — calculée sur le contenu, rien d'estimé. */
  async estimer(
    db: Requete,
    cabinetTenantId: string,
    clientTenantId: string | null,
    du: string,
    au: string,
    format: string,
  ): Promise<{ lignes: number; taille: number }> {
    const c = await construire(db, cabinetTenantId, clientTenantId, du, au, format);
    return { lignes: c.lignes, taille: tailleEnOctets(c.contenu) };
  },

  /**
   * Produit le fichier, le journalise (table append-only et journal d'audit)
   * et rend son contenu : le navigateur en fait un téléchargement.
   */
  async generer(
    db: Requete,
    cabinetTenantId: string,
    clientTenantId: string | null,
    du: string,
    au: string,
    format: string,
  ) {
    const c = await construire(db, cabinetTenantId, clientTenantId, du, au, format);
    const taille = tailleEnOctets(c.contenu);
    const sha = empreinte(c.contenu);
    const { rows } = await db.query<{ id: string }>(
      `select public.export_journaliser($1, $2, $3, $4, $5, $6, $7, $8, $9) as id`,
      [cabinetTenantId, clientTenantId, format, du, au, c.lignes, taille, sha, c.packId],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error("export.non_journalise");
    return {
      id,
      contenu: c.contenu,
      nomDeFichier: c.nomDeFichier,
      typeMime: c.typeMime,
      taille,
      lignes: c.lignes,
      empreinte: sha,
    };
  },

  /** Les derniers exports du cabinet, avec le dossier et l'auteur. */
  async historique(db: Requete, cabinetTenantId: string) {
    const { rows } = await db.query(
      `select x.id, x.client_tenant_id, o.name as client_nom, x.format, x.du, x.au, x.lignes,
              x.taille_octets, x.empreinte, x.created_at, m.email as auteur
         from exports_v x
         left join organizations_v o on o.id = x.client_tenant_id
         left join cabinet_members_v m on m.user_id = x.created_by and m.tenant_id = x.tenant_id
        where x.tenant_id = $1
        order by x.created_at desc
        limit 20`,
      [cabinetTenantId],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      id: r["id"] as string,
      clientTenantId: (r["client_tenant_id"] as string | null) ?? null,
      clientNom: (r["client_nom"] as string | null) ?? null,
      format: r["format"] as FormatExport,
      du: r["du"] as string,
      au: r["au"] as string,
      lignes: Number(r["lignes"]),
      taille: Number(r["taille_octets"]),
      empreinte: r["empreinte"] as string,
      auteur: (r["auteur"] as string | null) ?? null,
      createdAt: r["created_at"] as string,
    }));
  },
};
