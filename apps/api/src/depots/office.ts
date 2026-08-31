/**
 * Le bureau — proposition, comptabilisation, lecture des écritures.
 *
 * Les deux gestes qui engagent — proposer et comptabiliser — restent des
 * fonctions PL/pgSQL. Elles portent l'équilibre, la numérotation et le refus
 * de mutation ; les déplacer en TypeScript les mettrait hors de la transaction
 * qui les protège.
 */

import type { Requete } from "../db.ts";
import { dec } from "./decimal.ts";

interface Ligne {
  ordinal: number;
  accountCode: string;
  libelle: string;
  debit: string;
  credit: string;
  taxCode: string | null;
}

/**
 * Les lignes arrivent à plat, groupées par écriture.
 *
 * L'adaptateur d'origine faisait deux requêtes puis regroupait en JavaScript.
 * On garde ce découpage : une jointure produirait l'entête autant de fois
 * qu'elle a de lignes, pour un gain nul à ces volumes.
 */
function parEcriture(lignes: Record<string, unknown>[]): Map<string, Ligne[]> {
  const carte = new Map<string, Ligne[]>();
  for (const l of lignes) {
    const cle = l["ecriture_id"] as string;
    const liste = carte.get(cle) ?? [];
    liste.push({
      ordinal: Number(l["ordinal"]),
      accountCode: l["account_code"] as string,
      libelle: (l["libelle"] as string) ?? "",
      debit: dec(l["debit"]),
      credit: dec(l["credit"]),
      taxCode: (l["tax_code"] as string | null) ?? null,
    });
    carte.set(cle, liste);
  }
  return carte;
}

async function lignesDe(db: Requete, ids: string[]): Promise<Map<string, Ligne[]>> {
  const { rows } = await db.query(
    `select ecriture_id, ordinal, account_code, libelle, debit, credit, tax_code
       from ecriture_lignes_v where ecriture_id = any($1::uuid[]) order by ordinal`,
    [ids],
  );
  return parEcriture(rows as Record<string, unknown>[]);
}

function versEcriture(r: Record<string, unknown>, lignes: Map<string, Ligne[]>) {
  return {
    id: r["id"] as string,
    pieceId: (r["piece_id"] as string | null) ?? null,
    journal: r["journal"] as string,
    dateEcriture: r["date_ecriture"] as string,
    devise: r["devise"] as string,
    libelle: (r["libelle"] as string) ?? "",
    status: r["status"] as string,
    packVersionId: r["pack_version_id"] as string,
    lines: lignes.get(r["id"] as string) ?? [],
  };
}

export const office = {
  async propose(
    db: Requete,
    input: {
      pieceId: string;
      journal: string;
      date: string;
      libelle: string;
      packVersionId: string;
      lignes: unknown;
      devise: string;
    },
  ): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `select public.socle_ecriture_propose($1, $2, $3, $4, $5, $6::jsonb, $7) as id`,
      [
        input.pieceId,
        input.journal,
        input.date,
        input.libelle,
        input.packVersionId,
        JSON.stringify(input.lignes),
        input.devise,
      ],
    );
    return rows[0]!.id;
  },

  async book(db: Requete, ecritureId: string): Promise<void> {
    await db.query(`select public.socle_ecriture_book($1)`, [ecritureId]);
  },

  async ecrituresByIds(db: Requete, ids: string[]) {
    if (ids.length === 0) return [];
    const { rows } = await db.query(
      `select id, piece_id, journal, date_ecriture, devise, libelle, status, pack_version_id
         from ecritures_v where id = any($1::uuid[]) order by date_ecriture desc`,
      [ids],
    );
    const lignes = await lignesDe(db, ids);
    return (rows as Record<string, unknown>[]).map((r) => versEcriture(r, lignes));
  },

  async ecrituresForPiece(db: Requete, pieceId: string) {
    const { rows } = await db.query(
      `select id, piece_id, journal, date_ecriture, devise, libelle, status, pack_version_id
         from ecritures_v where piece_id = $1 order by created_at desc`,
      [pieceId],
    );
    const ids = (rows as Record<string, unknown>[]).map((r) => r["id"] as string);
    if (ids.length === 0) return [];
    const lignes = await lignesDe(db, ids);
    return (rows as Record<string, unknown>[]).map((r) => versEcriture(r, lignes));
  },

  /**
   * Les lignes comptabilisées d'une période, par la fonction du Socle.
   *
   * On n'écrit pas la requête équivalente ici : `socle_periode_lignes` porte
   * la définition de « comptabilisé », et deux définitions concurrentes
   * finiraient par diverger — l'écran dirait un résultat, la balance un autre.
   */
  async periodeLignes(db: Requete, tenantId: string, from: string, to: string) {
    const { rows } = await db.query(
      `select date_ecriture, journal, account_code, debit, credit
         from public.socle_periode_lignes($1, $2, $3)`,
      [tenantId, from, to],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      dateEcriture: r["date_ecriture"] as string,
      journal: r["journal"] as string,
      accountCode: r["account_code"] as string,
      debit: dec(r["debit"]),
      credit: dec(r["credit"]),
    }));
  },

  async bookedExtracts(db: Requete, tenantId: string, from: string, to: string) {
    // Une seule requête là où l'adaptateur en faisait deux puis dédoublonnait
    // en JavaScript : `distinct on` rend la dernière extraction de chaque pièce,
    // ce que la boucle précédente reconstituait à la main.
    const { rows } = await db.query(
      `select distinct on (x.piece_id) x.piece_id, x.payload
         from extractions_v x
         join ecritures_v e on e.piece_id = x.piece_id
        where e.tenant_id = $1
          and e.status = 'booked'
          and e.date_ecriture between $2 and $3
          and x.contract = 'extract.v1'
        order by x.piece_id, x.created_at desc`,
      [tenantId, from, to],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      pieceId: r["piece_id"] as string,
      extract: r["payload"],
    }));
  },
};
