/**
 * Le bureau — proposition, comptabilisation, lecture des écritures.
 *
 * Les deux gestes qui engagent — proposer et comptabiliser — restent des
 * fonctions PL/pgSQL. Elles portent l'équilibre, la numérotation et le refus
 * de mutation ; les déplacer en TypeScript les mettrait hors de la transaction
 * qui les protège.
 */

import type { Requete } from "../db.ts";
import { propositionDePiece } from "../scan/proposition.ts";
import { propositionDeReglement } from "../scan/reglement.ts";

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
  /**
   * La proposition d'écriture d'une pièce, calculée par le SERVEUR (3B-6) :
   * depuis les montants imprimés et normalisés, seulement si le verdict la
   * déclare comptabilisable. `dateSaisie` complète une date non lue — elle ne
   * remplace jamais une date lue.
   */
  async propositionDePiece(db: Requete, pieceId: string, dateSaisie: string | null = null) {
    return propositionDePiece(db, pieceId, dateSaisie);
  },

  /**
   * Enregistre la proposition que le serveur calcule : aucune ligne ne vient
   * du client. Refuse, avec le motif, ce que `propositionDePiece` refuse.
   */
  async proposerDepuisPiece(
    db: Requete,
    pieceId: string,
    dateSaisie: string | null = null,
  ): Promise<string> {
    const r = await propositionDePiece(db, pieceId, dateSaisie);
    if (!r.ok) throw Object.assign(new Error(r.raison), { code: "22023" });
    return office.propose(db, {
      pieceId,
      journal: r.proposition.journal,
      date: r.proposition.pivot.entry_date,
      libelle: r.proposition.libelle,
      packVersionId: r.packVersionId,
      devise: r.proposition.pivot.currency,
      lignes: r.proposition.lignes,
    });
  },

  /**
   * Ce que le moyen de paiement engage : l'ecriture du reglement.
   *
   * La facture constate une dette ; le reglement l'eteint. Ce sont DEUX
   * faits, a deux dates, et les confondre empeche tout rapprochement
   * bancaire — une facture de septembre payee en octobre touche la
   * tresorerie en octobre.
   */
  async propositionDeReglement(db: Requete, paiementId: string) {
    const r = await propositionDeReglement(db, paiementId);
    if (!r.ok) return r;
    // Déjà inscrit ? L'écran le dit et retire le bouton (ANO-006) : la base,
    // elle, rend la même écriture si on redemande.
    const { rows } = await db.query<{ id: string }>(
      `select id from ecritures_v
        where paiement_id = $1 and nature = 'reglement' and app.ecriture_vivante(id)
        limit 1`,
      [paiementId],
    );
    return { ...r, inscrite: rows[0] ? { ecritureId: rows[0].id } : null };
  },

  /**
   * Inscrire le reglement propose. Rend l'identifiant de l'ecriture.
   *
   * Aucune ligne ne transite par le client : le serveur compose depuis ce
   * qu'il a lui-meme lu, et refuse avec le motif ce que la proposition
   * refuse.
   */
  async proposerLeReglement(db: Requete, paiementId: string): Promise<string> {
    const r = await propositionDeReglement(db, paiementId);
    if (!r.ok) throw Object.assign(new Error(r.raison), { code: "22023" });
    return office.propose(db, {
      pieceId: r.pieceId,
      journal: r.ecriture.journal,
      date: r.ecriture.dateEcriture,
      libelle: r.ecriture.libelle,
      packVersionId: r.packVersionId,
      devise: r.ecriture.devise,
      lignes: r.ecriture.lignes,
      paiementId,
    });
  },

  /**
   * Inscrire le règlement : proposer PUIS comptabiliser, en une transaction
   * (ANO-006, 21 octobre 2026). L'écran n'appelait que la proposition :
   * l'écriture restait « proposée », n'atteignait jamais le FEC, et chaque
   * clic en ajoutait une. Redemander rend l'écriture déjà inscrite.
   */
  async inscrireLeReglement(db: Requete, paiementId: string): Promise<string> {
    const id = await office.proposerLeReglement(db, paiementId);
    const { rows } = await db.query<{ status: string }>(
      `select status from ecritures_v where id = $1`,
      [id],
    );
    if (rows[0]?.status === "proposee") await office.book(db, id);
    return id;
  },

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
      /** Le paiement qu'un règlement inscrit ; absent pour la facture. */
      paiementId?: string | null;
    },
  ): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `select public.socle_ecriture_propose($1, $2, $3, $4, $5, $6::jsonb, $7, $8) as id`,
      [
        input.pieceId,
        input.journal,
        input.date,
        input.libelle,
        input.packVersionId,
        JSON.stringify(input.lignes),
        input.devise,
        input.paiementId ?? null,
      ],
    );
    return rows[0]!.id;
  },

  /**
   * Forcer l'imputation : contre-passer, réimputer, comptabiliser — EN UNE
   * transaction (20 octobre 2026).
   *
   * L'écran enchaînait trois appels. Le premier passait, le deuxième était
   * refusé, et la facture restait contre-passée sans réimputation : sortie des
   * livres. Une seule requête, donc une seule transaction : tout passe, ou
   * rien n'est écrit. Le journal, la date, le pack et la devise viennent de
   * l'écriture remplacée, lue ici — pas de ce que l'écran affirme.
   */
  async corrigerLImputation(
    db: Requete,
    input: {
      ecritureId: string;
      motifId: string;
      note: string | null;
      libelle: string;
      lignes: unknown;
    },
  ): Promise<string> {
    const { rows } = await db.query<{
      piece_id: string;
      journal: string;
      date_ecriture: string;
      devise: string;
      pack_version_id: string;
    }>(
      `select piece_id, journal, date_ecriture::text as date_ecriture, devise, pack_version_id
         from ecritures_v where id = $1`,
      [input.ecritureId],
    );
    const remplacee = rows[0];
    if (!remplacee) throw Object.assign(new Error("écriture introuvable"), { code: "22023" });
    await db.query(`select public.socle_ecriture_review($1, 'retourne', $2, $3)`, [
      input.ecritureId,
      input.motifId,
      input.note,
    ]);
    const id = await office.propose(db, {
      pieceId: remplacee.piece_id,
      journal: remplacee.journal,
      date: remplacee.date_ecriture,
      libelle: input.libelle,
      packVersionId: remplacee.pack_version_id,
      devise: remplacee.devise,
      lignes: input.lignes,
    });
    await office.book(db, id);
    return id;
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
   * Les retenues à la source d'un dossier pour un mois, lues dans ses
   * écritures : opérées (à reverser à l'État) et subies (créances sur l'État).
   */
  async retenuesDuMois(db: Requete, tenantId: string, periode: string) {
    const { rows } = await db.query(
      `select ecriture_id, date_ecriture::text as date_ecriture, ecriture, ligne, compte, sens,
              montant::text as montant, statut
         from public.retenues_du_mois($1, $2::date)`,
      [tenantId, periode],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      ecritureId: r["ecriture_id"] as string,
      dateEcriture: r["date_ecriture"] as string,
      ecriture: r["ecriture"] as string,
      ligne: r["ligne"] as string,
      compte: r["compte"] as string,
      sens: r["sens"] as "operee" | "subie",
      montant: dec(r["montant"]),
      statut: r["statut"] as string,
    }));
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
    //
    // 20 octobre 2026, recette : une facture CONTRE-PASSÉE restait comptée
    // dans la TVA du mois — son écriture d'origine est toujours « booked ».
    // On ne retient que les écritures vivantes : ni contre-passation, ni
    // écriture qu'une contre-passation comptabilisée annule.
    const { rows } = await db.query(
      `select distinct on (x.piece_id) x.piece_id, x.payload
         from extractions_v x
         join ecritures_v e on e.piece_id = x.piece_id
        where e.tenant_id = $1
          -- L'écriture de la FACTURE : un règlement inscrit ne fait pas compter
          -- une facture contre-passée (ANO-006, 21 octobre 2026).
          and e.nature = 'piece'
          and e.status = 'booked'
          and e.reverses_id is null
          and not exists (
            select 1 from ecritures_v r
             where r.reverses_id = e.id and r.status = 'booked'
          )
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

  /**
   * Les lectures des pièces TRANSMISES dans la fenêtre, avec leur date d'envoi.
   *
   * ================================================================= POURQUOI
   *
   * Décision du commanditaire, 10 octobre 2026 : « le calcul de TVA dans le
   * dashboard serait imputé à la date de transmission au comptable, car le
   * comptable est censé la déclarer dans le mois courant ».
   *
   * C'est la réponse à une contradiction qu'il voyait depuis le 5 octobre :
   * « Vos charges » affichait 514,700 et « Votre TVA » zéro, pour le même
   * mois. Les deux avaient raison — l'un lisait les pièces LUES, l'autre les
   * pièces COMPTABILISÉES — et aucun ne disait lequel.
   *
   * Sa règle tranche, et elle est juste pour une raison simple : une TVA se
   * récupère sur une déclaration, une déclaration est déposée par le cabinet,
   * et le cabinet ne peut déclarer que ce qu'il a reçu. Une pièce gardée au
   * coffre n'entre dans aucune déclaration, et doit donc peser zéro.
   *
   * ================================= POURQUOI CETTE MÉTHODE, ET PAS `bookedExtracts`
   *
   * `bookedExtracts` sélectionne sur la date d'ÉCRITURE et sert au cabinet —
   * c'est son journal, et il a raison de le voir ainsi. Les deux lectures
   * coexistent, chacune nommée, et chaque écran dit laquelle il emploie :
   * c'est cette mention, et non la règle, qui empêche deux chiffres de se
   * contredire en silence.
   *
   * Noter ce que `bookedExtracts` faisait, et qui était incohérent : il
   * sélectionnait par date d'écriture puis l'appelant regroupait par date de
   * DOCUMENT. Une facture de février comptabilisée en octobre était donc
   * retenue, puis rangée en février — dans un mois que la fenêtre n'avait pas
   * demandé.
   *
   * ============================================ CE QU'UNE DATE NULLE VEUT DIRE
   *
   * Les pièces transmises avant le 11 octobre n'ont pas de date d'envoi : la
   * transmission n'était qu'un drapeau. Elles ne sont dans aucune fenêtre, et
   * c'est voulu — leur donner la date du jour les ferait toutes entrer dans la
   * déclaration du mois courant, ce qui serait faux et invisible. L'écran les
   * nomme à part.
   */
  async extraitsTransmis(db: Requete, tenantId: string, from: string, to: string) {
    const { rows } = await db.query(
      `select distinct on (x.piece_id)
              x.piece_id, x.payload, p.transmise_le
         from extractions_v x
         -- La pièce qui compte (ANO-005) : confirmée, dans la société, sans
         -- doublon, d'un type qui porte écriture. Retournée par le cabinet,
         -- elle n'y est pas tant qu'elle n'est pas reprise ; transmise sans
         -- avoir été confirmée, non plus.
         join pieces_qui_comptent_v p on p.id = x.piece_id
        where p.tenant_id = $1
          and p.transmise_le >= $2::date
          and p.transmise_le < ($3::date + interval '1 day')
          and x.contract = 'extract.v1'
        order by x.piece_id, x.created_at desc`,
      [tenantId, from, to],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      pieceId: r["piece_id"] as string,
      extract: r["payload"],
      transmiseLe: (r["transmise_le"] as Date).toISOString().slice(0, 10),
    }));
  },

  /**
   * Combien de pièces sont parties au cabinet sans qu'on sache quand.
   *
   * Elles ne pèsent dans aucune déclaration, et il faut pouvoir le dire :
   * une pièce qui disparaît des totaux sans que rien ne la nomme est pire
   * qu'une pièce mal rangée.
   */
  async transmisesSansDate(db: Requete, tenantId: string): Promise<number> {
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from pieces_v
        where tenant_id = $1 and vis = 'partage' and transmise_le is null`,
      [tenantId],
    );
    return Number(rows[0]?.n ?? 0);
  },
};
