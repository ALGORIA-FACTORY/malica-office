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
 * La base porte les définitions : ce qui est « pris en charge ce jour-là »,
 * l'origine d'une écriture et le fuseau du cabinet vivent dans
 * `journal_du_jour_lire` ; le numéro et la trace dans
 * `journal_export_journaliser`. Ici on range, on additionne (en entiers,
 * `sommeDecimale`, à la précision de CHAQUE devise lue dans `ref.devises`),
 * on compare deux exports, on met en forme avec le moteur des exports.
 *
 * Le jour est celui du cabinet, pas celui de l'écran ni du serveur : le
 * fuseau est un réglage du cabinet, au défaut de sa juridiction (décision du
 * dirigeant, 29 octobre 2026).
 *
 * Le journal reste modifiable au sens comptable (R7) : une correction est une
 * contre-passation et une écriture nouvelle ; toutes deux y paraissent le
 * jour où elles sont inscrites. Un jour passé ne change pas après coup : il
 * se lit dans des faits gelés (inscription, piste d'audit).
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

/**
 * Les colonnes du fichier, les mêmes en CSV et en Excel.
 *
 * Décision (revue de #129) : les en-têtes et les valeurs codées (`validee`,
 * `forcee`, `equilibre`, `ajoutee`…) restent des codes français STABLES, dans
 * toutes les langues de l'écran. Le fichier est fait pour être importé : un
 * logiciel lit un code, pas une traduction, et un même export ne doit pas
 * changer de colonnes selon la langue de celui qui l'a produit.
 */
const COLONNES_JOURNAL_DU_JOUR = [
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
  // Une ligne convertie d'une pièce en devise (31 octobre 2026), en fin de
  // ligne : un import qui lit les colonnes précédentes n'en est pas dérangé.
  "devise_origine",
  "montant_origine",
  "taux_de_change",
  "date_du_cours",
  "source_du_cours",
  // L'origine du cours (`ref.rangs_des_cours` : import, saisie, dérogation),
  // en code stable, et le motif d'une dérogation ou d'une correction (revue
  // de #148 : un cours saisi ne se lisait que « BCT », comme l'officiel).
  "origine_du_cours",
  "motif_du_cours",
] as const;
type Colonne = (typeof COLONNES_JOURNAL_DU_JOUR)[number];

/** Le contrôle débit = crédit, tel que le fichier l'écrit sur ses lignes de total. */
const CONTROLE = { tient: "equilibre", netientpas: "desequilibre" } as const;

/** La précision de chaque devise, en décimales, lue dans `ref.devises`. */
export type Exposants = ReadonlyMap<string, number>;

function exposantDe(exposants: Exposants, devise: string): number {
  const n = exposants.get(devise);
  // Aucun repli (R4) : une devise absent du référentiel n'a pas de précision connue.
  if (n === undefined) throw new RefusExport(`devise inconnue du référentiel : ${devise}`);
  return n;
}

/**
 * Ce qu'un export a figé : ses écritures, celles qui y étaient déjà
 * contre-passées, et le fuseau dans lequel le jour a été coupé (nul pour un
 * export d'avant qu'on le garde).
 */
export interface InstantaneDuJournal {
  ecritures: readonly string[];
  contrePassees: readonly string[];
  fuseau: string | null;
}

/** Les deux instantanés ne coupent pas le même jour : le fuseau du cabinet a changé. */
function fuseauChange(precedent: InstantaneDuJournal, courant: InstantaneDuJournal): boolean {
  return precedent.fuseau !== null && precedent.fuseau !== courant.fuseau;
}

/**
 * Ce qui a changé entre deux instantanés du même journal. Un fuseau changé
 * recoupe le jour : comparer les écritures fabriquerait des ajouts et des
 * retraits qui n'en sont pas — on le dit, et on ne compte rien.
 */
export function ecartEntre(
  precedent: InstantaneDuJournal,
  courant: InstantaneDuJournal,
): EcartDepuisLExport {
  if (fuseauChange(precedent, courant)) {
    return { ajoutees: 0, contrePassees: 0, retirees: 0, fuseauChange: true };
  }
  const avant = new Set(precedent.ecritures);
  const maintenant = new Set(courant.ecritures);
  const dejaContrePassees = new Set(precedent.contrePassees);
  return {
    ajoutees: courant.ecritures.filter((id) => !avant.has(id)).length,
    contrePassees: courant.contrePassees.filter((id) => avant.has(id) && !dejaContrePassees.has(id))
      .length,
    retirees: precedent.ecritures.filter((id) => !maintenant.has(id)).length,
    fuseauChange: false,
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
function instantaneDe(journaux: readonly JournalAuJour[], fuseau: string): InstantaneDuJournal {
  const ecritures = toutesLesEcritures(journaux);
  return {
    ecritures: ecritures.map((e) => e.id),
    contrePassees: ecritures.filter((e) => e.contrePasseeLe).map((e) => e.id),
    fuseau,
  };
}

/** Les totaux par devise, additionnés en entiers à la précision de la devise. */
function soldesDe(ecritures: readonly EcritureAuJournal[], exposants: Exposants): SoldeDuJournal[] {
  const parDevise = new Map<string, EcritureAuJournal[]>();
  for (const e of ecritures) parDevise.set(e.devise, [...(parDevise.get(e.devise) ?? []), e]);
  return [...parDevise.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([devise, liste]) => {
      const n = exposantDe(exposants, devise);
      const debit = sommeDecimale(
        liste.map((e) => e.debit),
        n,
      );
      const credit = sommeDecimale(
        liste.map((e) => e.credit),
        n,
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
  devise_origine: string | null;
  montant_origine: string | null;
  taux_de_change: string | null;
  date_du_cours: string | null;
  source_du_cours: string | null;
  origine_du_cours: string | null;
  libelle_origine_du_cours: string | null;
  motif_du_cours: string | null;
}

/**
 * Range les lignes lues en journaux, puis en écritures, dans l'ordre de la
 * base (le rang du journal, puis l'heure). Pur : se prouve sans base.
 */
export function rangerLeJournal(
  lignes: readonly LigneLue[],
  exposants: Exposants,
): JournalAuJour[] {
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
    const n = exposantDe(exposants, l.devise);
    e.lignes.push({
      ordinal: Number(l.ordinal),
      compte: l.compte,
      compteLibelle: l.compte_libelle,
      debit: dec(l.debit, n),
      credit: dec(l.credit, n),
      origine:
        l.devise_origine === null
          ? null
          : {
              devise: l.devise_origine,
              montant: dec(l.montant_origine, exposantDe(exposants, l.devise_origine)),
              taux: l.taux_de_change ?? "",
              dateDuCours: l.date_du_cours ?? "",
              source: l.source_du_cours ?? "",
              origineDuCours: l.origine_du_cours ?? "",
              libelleOrigineDuCours: l.libelle_origine_du_cours ?? l.origine_du_cours ?? "",
              motifDuCours: l.motif_du_cours,
            },
    });
  }
  return [...journaux.entries()].map(([code, j]) => {
    const ecritures = [...j.ecritures.values()].map((e) => {
      const n = exposantDe(exposants, e.devise);
      return {
        ...e,
        debit: sommeDecimale(
          e.lignes.map((l) => l.debit),
          n,
        ),
        credit: sommeDecimale(
          e.lignes.map((l) => l.credit),
          n,
        ),
      };
    });
    return { code, libelle: j.libelle, ecritures, soldes: soldesDe(ecritures, exposants) };
  });
}

/** Une rangée du fichier, colonne par colonne ; ce qui n'est pas nommé reste vide. */
function rangee(valeurs: Partial<Record<Colonne, Cellule>>): Cellule[] {
  return COLONNES_JOURNAL_DU_JOUR.map((c) => valeurs[c] ?? { texte: "" });
}

/** Une ligne de total : le contrôle débit = crédit écrit dans le fichier lui-même. */
function rangeeDeTotal(s: SoldeDuJournal, journal: { code: string; libelle: string } | null) {
  return rangee({
    journal: { texte: journal?.code ?? "" },
    journal_libelle: { texte: journal?.libelle ?? "" },
    ecriture: { texte: "total" },
    debit: { montant: s.debit },
    credit: { montant: s.credit },
    devise: { texte: s.devise },
    origine: { texte: s.equilibre ? CONTROLE.tient : CONTROLE.netientpas },
  });
}

/**
 * Le contenu du fichier : une rangée par ligne d'écriture, journal après
 * journal ; puis le total de chaque journal et le total général, devise par
 * devise, chacun avec son contrôle. Pur : se prouve sans base.
 */
export function contenuDuFichier(
  journaux: readonly JournalAuJour[],
  precedent: InstantaneDuJournal | null,
  exposants: Exposants,
): { entete: readonly string[]; lignes: Cellule[][]; totaux: Cellule[][] } {
  const lignes = journaux.flatMap((j) =>
    j.ecritures.flatMap((e) => {
      const changement = changementDe(e, precedent);
      return e.lignes.map((l) =>
        rangee({
          dossier: { texte: e.clientNom },
          journal: { texte: j.code },
          journal_libelle: { texte: j.libelle },
          ecriture: { texte: e.id },
          heure: { texte: e.heure },
          libelle: { texte: e.libelle },
          compte: { texte: l.compte },
          compte_libelle: { texte: l.compteLibelle },
          debit: { montant: l.debit },
          credit: { montant: l.credit },
          devise: { texte: e.devise },
          origine: { texte: e.origine },
          par: { texte: e.par ?? "" },
          changement: { texte: changement },
          ...(l.origine
            ? {
                devise_origine: { texte: l.origine.devise },
                montant_origine: { montant: l.origine.montant },
                taux_de_change: { texte: l.origine.taux },
                date_du_cours: { texte: l.origine.dateDuCours },
                source_du_cours: { texte: l.origine.source },
                origine_du_cours: { texte: l.origine.origineDuCours },
                motif_du_cours: { texte: l.origine.motifDuCours ?? "" },
              }
            : {}),
        }),
      );
    }),
  );
  const totaux = [
    ...journaux.flatMap((j) => j.soldes.map((s) => rangeeDeTotal(s, j))),
    ...soldesDe(toutesLesEcritures(journaux), exposants).map((s) => rangeeDeTotal(s, null)),
  ];
  return { entete: COLONNES_JOURNAL_DU_JOUR, lignes, totaux };
}

/** Le texte d'une cellule, tel qu'un CSV l'écrit. */
function texteDe(c: Cellule): string {
  return "montant" in c ? c.montant : c.texte;
}

interface ExportLu extends InstantaneDuJournal {
  id: string;
  numero: number;
  format: FormatDuJournalExporte;
  createdAt: string;
  auteur: string | null;
  nomDeFichier: string | null;
}

/**
 * Les exports du journal de ce jour, pour ce périmètre, du premier au dernier.
 * Sous RLS : le cabinet seul les lit.
 */
async function exportsDuJour(
  db: Requete,
  cabinetTenantId: string,
  clientTenantId: string | null,
  jour: string,
): Promise<ExportLu[]> {
  const { rows } = await db.query(
    `select x.id, x.numero, x.format, x.created_at, x.ecritures::text[] as ecritures,
            x.contre_passees::text[] as contre_passees, x.fuseau, x.nom_de_fichier,
            m.email as auteur
       from exports_v x
       left join cabinet_members_v m on m.user_id = x.created_by and m.tenant_id = x.tenant_id
      where x.tenant_id = $1
        and x.client_tenant_id is not distinct from $2::uuid
        and x.du = $3::date
        and x.numero is not null
      order by x.numero`,
    [cabinetTenantId, clientTenantId, jour],
  );
  return (rows as Record<string, unknown>[]).map((r) => ({
    id: r["id"] as string,
    numero: Number(r["numero"]),
    format: r["format"] as FormatDuJournalExporte,
    createdAt: new Date(r["created_at"] as string).toISOString(),
    auteur: (r["auteur"] as string | null) ?? null,
    nomDeFichier: (r["nom_de_fichier"] as string | null) ?? null,
    ecritures: (r["ecritures"] as string[]) ?? [],
    contrePassees: (r["contre_passees"] as string[]) ?? [],
    fuseau: (r["fuseau"] as string | null) ?? null,
  }));
}

/** Le fuseau du cabinet et son « aujourd'hui », tels que la base les résout. */
async function calendrierDuCabinet(
  db: Requete,
  cabinetTenantId: string,
): Promise<{ fuseau: string; aujourdhui: string }> {
  const { rows } = await db.query<{ r: { fuseau: string | null; aujourdhui: string | null } }>(
    `select public.cabinet_fuseau_lire($1) as r`,
    [cabinetTenantId],
  );
  const r = rows[0]?.r;
  if (!r?.fuseau || !r.aujourdhui) {
    throw new RefusExport(
      "le fuseau horaire du cabinet n'est pas défini : réglez-le dans les réglages du cabinet",
    );
  }
  return { fuseau: r.fuseau, aujourdhui: r.aujourdhui };
}

async function lireLeJournal(
  db: Requete,
  cabinetTenantId: string,
  clientTenantId: string | null,
  jour: string,
  locale: string,
): Promise<{ journaux: JournalAuJour[]; exposants: Exposants }> {
  // Le libellé du journal dans la langue de l'écran, le français à défaut
  // (R4 : du référentiel, jamais du code). L'ordre est celui de la base.
  const { rows } = await db.query<LigneLue>(
    `select f.client_tenant_id, f.client_nom, f.ecriture_id, f.journal,
            coalesce(demandee.value, francais.value, f.journal_libelle) as journal_libelle,
            f.piece_id, f.ecriture_libelle, f.ordinal, f.compte, f.compte_libelle,
            f.debit::text as debit, f.credit::text as credit, f.devise, f.origine,
            f.inscrite_le, f.heure, f.par, f.reverses_id, f.contre_passee_le,
            f.devise_origine, f.montant_origine::text as montant_origine,
            f.taux_de_change::text as taux_de_change,
            to_char(f.date_du_cours, 'YYYY-MM-DD') as date_du_cours, f.source_du_cours,
            f.origine_du_cours,
            coalesce(cours_demande.value, cours_fr.value, f.origine_du_cours)
              as libelle_origine_du_cours,
            f.motif_du_cours
       from public.journal_du_jour_lire($1, $2, $3::date) with ordinality as f
       left join ref_labels_v demandee
         on demandee.ns = 'journal' and demandee.key = f.journal and demandee.locale = $4
       left join ref_labels_v francais
         on francais.ns = 'journal' and francais.key = f.journal and francais.locale = 'fr'
       left join ref_labels_v cours_demande
         on cours_demande.ns = 'origine_du_cours' and cours_demande.key = f.origine_du_cours
        and cours_demande.locale = $4
       left join ref_labels_v cours_fr
         on cours_fr.ns = 'origine_du_cours' and cours_fr.key = f.origine_du_cours
        and cours_fr.locale = 'fr'
      order by f.ordinality`,
    [cabinetTenantId, clientTenantId, jour, locale],
  );
  const { rows: devises } = await db.query<{ code: string; exposant: number }>(
    `select code, exposant from ref.devises where code = any($1::text[])`,
    // Les devises des écritures, et celles d'origine des lignes converties.
    [
      [
        ...new Set(
          rows.flatMap((r) => [r.devise, ...(r.devise_origine ? [r.devise_origine] : [])]),
        ),
      ],
    ],
  );
  const exposants: Exposants = new Map(devises.map((d) => [d.code, Number(d.exposant)]));
  return { journaux: rangerLeJournal(rows, exposants), exposants };
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
  /** Le journal d'un jour du cabinet ; sans jour, celui d'aujourd'hui dans son fuseau. */
  async lire(
    db: Requete,
    cabinetTenantId: string,
    clientTenantId: string | null,
    jourDemande: string | null,
    locale: string,
  ): Promise<JournalDuJour> {
    if (jourDemande !== null) verifierLeJour(jourDemande);
    await contexteDExport(db, cabinetTenantId, clientTenantId);
    const { fuseau, aujourdhui } = await calendrierDuCabinet(db, cabinetTenantId);
    const jour = jourDemande ?? aujourdhui;
    const { journaux, exposants } = await lireLeJournal(
      db,
      cabinetTenantId,
      clientTenantId,
      jour,
      locale,
    );
    const ecritures = toutesLesEcritures(journaux);
    const compte = (o: OrigineAuJournal) => ecritures.filter((e) => e.origine === o).length;
    const exports = await exportsDuJour(db, cabinetTenantId, clientTenantId, jour);
    const dernier = exports.at(-1);
    return {
      jour,
      aujourdhui,
      fuseau,
      journaux,
      totaux: {
        ecritures: ecritures.length,
        validees: compte("validee"),
        forcees: compte("forcee"),
        contrePassations: compte("contre_passation"),
        soldes: soldesDe(ecritures, exposants),
      },
      dernierExport: dernier
        ? {
            numero: dernier.numero,
            format: FORMAT_LU[dernier.format],
            createdAt: dernier.createdAt,
            auteur: dernier.auteur,
            ecart: ecartEntre(dernier, instantaneDe(journaux, fuseau)),
          }
        : null,
      // Chaque export numéroté du jour, à retélécharger : ceux d'avant qu'on
      // garde les fichiers (sans nom de fichier) n'en ont pas.
      exports: exports
        .filter((x) => x.nomDeFichier !== null)
        .map((x) => ({
          id: x.id,
          numero: x.numero,
          format: FORMAT_LU[x.format],
          createdAt: x.createdAt,
          auteur: x.auteur,
          nomDeFichier: x.nomDeFichier!,
        })),
    };
  },

  /**
   * Produit le fichier, le numérote, le journalise et le GARDE ; rend de quoi
   * le télécharger (`/exports/:id/contenu`), maintenant ou plus tard.
   *
   * Le numéro est dans le fichier, l'empreinte porte le fichier : il faut
   * donc connaître le numéro AVANT d'écrire. Un verrou de transaction, propre
   * au cabinet, au dossier et au jour, sérialise deux exports simultanés ; la
   * base vérifie encore que le numéro suit le dernier, et l'index unique
   * tranche en dernier recours. Le fichier s'écrit dans la même transaction :
   * s'il ne s'écrit pas, rien n'est numéroté.
   */
  async exporter(
    db: Requete,
    cabinetTenantId: string,
    clientTenantId: string | null,
    jour: string,
    locale: string,
    format: string,
  ): Promise<JournalExporte> {
    if (!estFormat(format)) throw new RefusExport("ce format d'export n'existe pas");
    verifierLeJour(jour);
    const ctx = await contexteDExport(db, cabinetTenantId, clientTenantId);
    const { fuseau, aujourdhui } = await calendrierDuCabinet(db, cabinetTenantId);
    // Un jour à venir n'a pas de journal : il ne prend pas de numéro.
    if (jour > aujourdhui) {
      throw new RefusExport("ce jour est à venir : il n'a pas encore de journal à exporter");
    }

    await db.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [
      `journal-du-jour:${cabinetTenantId}:${clientTenantId ?? "*"}:${jour}`,
    ]);
    const precedent =
      (await exportsDuJour(db, cabinetTenantId, clientTenantId, jour)).at(-1) ?? null;
    const { journaux, exposants } = await lireLeJournal(
      db,
      cabinetTenantId,
      clientTenantId,
      jour,
      locale,
    );
    const numero = (precedent?.numero ?? 0) + 1;
    const instantane = instantaneDe(journaux, fuseau);
    const ecart = precedent
      ? ecartEntre(precedent, instantane)
      : { ajoutees: 0, contrePassees: 0, retirees: 0, fuseauChange: false };
    // Un fuseau changé recoupe le jour : aucune ligne ne se dit « ajoutée ».
    const fichier = contenuDuFichier(
      journaux,
      precedent && !ecart.fuseauChange ? precedent : null,
      exposants,
    );
    const nom = `journal-${ctx.nomDuPerimetre}-${dateFec(jour)}-n${numero}.${format}`;

    let octets: string | Uint8Array;
    let typeMime: string;
    if (format === "xlsx") {
      octets = classeurXlsx(
        {
          nom: dateFec(jour),
          entete: fichier.entete,
          lignes: fichier.lignes,
          totaux: fichier.totaux,
          droiteAGauche: locale === "ar",
        },
        // Les entrées de l'archive sont datées du jour exporté, en UTC : même
        // contenu, mêmes octets, quel que soit le fuseau du serveur.
        new Date(`${jour}T12:00:00Z`),
      );
      typeMime = TYPE_MIME_XLSX;
    } else {
      octets = formaterCsv(
        fichier.entete,
        [...fichier.lignes, ...fichier.totaux].map((r) => r.map(texteDe)),
      );
      typeMime = TYPE_MIME_CSV;
    }

    const taille = tailleEnOctets(octets);
    const sha = empreinte(octets);
    const { rows } = await db.query<{ id: string }>(
      `select public.journal_export_journaliser($1, $2, $3::date, $4, $5, $6, $7, $8, $9,
                                                $10::uuid[], $11::uuid[], $12::jsonb,
                                                $13, $14, $15) as id`,
      [
        cabinetTenantId,
        clientTenantId,
        jour,
        FORMATS[format],
        numero,
        fichier.lignes.length,
        taille,
        sha,
        ctx.packId,
        instantane.ecritures,
        instantane.contrePassees,
        JSON.stringify({ precedent: precedent?.numero ?? null, ...ecart }),
        fuseau,
        nom,
        typeMime,
      ],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error("journal_du_jour.non_journalise");
    // Import à l'appel : `stockage.ts` sert aussi les routes (sous l'appelant,
    // via `cles-api.ts` → `rpc.ts`), qui importent ce dépôt — un import en tête
    // fermerait le cycle avant que ce module soit initialisé.
    const { garderUnExport } = await import("../stockage.ts");
    await garderUnExport(cabinetTenantId, id, octets);
    return {
      id,
      numero,
      nomDeFichier: nom,
      typeMime,
      taille,
      lignes: fichier.lignes.length,
      empreinte: sha,
      precedent: precedent?.numero ?? null,
      ecart,
    };
  },
};
