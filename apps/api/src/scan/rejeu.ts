/**
 * Rejuger les pièces aux règles du jour.
 *
 * ================================================================= POURQUOI
 *
 * Le 30 octobre 2026 (PR 142), le Socle a appris à déduire ce que la facture
 * prouve, et propose bien plus souvent. Mais le jugement d'une pièce est posé
 * une fois, en ajout seul (`capture.analyses`), et le dernier passage fait
 * foi : sur le staging, le cabinet lisait encore « le Socle ne propose rien »
 * sur des pièces que les nouvelles règles proposent.
 *
 * ================================================================= CE QUI EST SÛR
 *
 *   — le jugement est celui de `capture.analyser`, rejoué tel quel
 *     (`rejugerLaPiece`) ; une analyse NOUVELLE ne s'ajoute que s'il change :
 *     rejouer deux fois n'ajoute rien ;
 *   — rien d'autre ne s'écrit : ni écriture, ni règlement, ni fait (R7). Une
 *     pièce qui porte une écriture (proposée, ou inscrite et vivante) n'est pas
 *     rejugée : son jugement a déjà servi ;
 *   — seules la version COURANTE d'une pièce, non archivée, et lue ;
 *   — la RLS et l'affectation décident : `app.peut_superviser` — le cabinet
 *     qui tient le dossier (l'expert, ou le collaborateur affecté), la société
 *     seulement quand elle tient ses livres. Un dossier qu'on ne supervise pas
 *     n'est pas dans le périmètre : il n'y a rien à refuser, il n'y est pas ;
 *   — par pages, sous un budget de temps : l'appel rend une `suite` à
 *     repasser tant qu'il en reste. Une pièce qui échoue est consignée au
 *     journal des pannes et n'arrête pas les autres.
 */

import type { Requete } from "../db.ts";
import { journal } from "../depots/journal.ts";

import { REGLES_DU_JUGEMENT, rejugerLaPiece } from "./analyse.ts";
import { propositionDePiece } from "./proposition.ts";

/*
 * Les bornes d'un appel. Ce ne sont pas des paramètres métier : elles disent
 * combien de travail tient dans UNE transaction de l'API (chaque requête y est
 * coupée à 30 s, `db.ts`). Une page se juge pièce par pièce ; le budget arrête
 * l'appel entre deux pages, et la `suite` reprend où il s'est arrêté.
 */
const PIECES_PAR_PAGE = 50;
const BUDGET_MS = 20_000;

/** L'endroit du code, tel que le journal des pannes le nomme. */
const OU = "api/scan/rejeu";

/**
 * Le périmètre, sur une pièce `p` : ce que l'appelant supervise, version
 * courante, non archivée, lue, sans écriture de pièce proposée ni vivante —
 * sur toute la chaîne des versions, comme toutes les gardes depuis le
 * 29 octobre 2026.
 */
const DANS_LE_PERIMETRE = `
      app.peut_superviser(p.tenant_id)
  and p.archivee_le is null
  and not exists (select 1 from capture.remplacements r where r.piece_id = p.id)
  and exists (select 1 from extractions_v x where x.piece_id = p.id)
  and not exists (
        select 1 from ecritures_v e
         where e.piece_id in (select app.versions_de_la_piece(p.id))
           and e.nature = 'piece'
           and (app.ecriture_vivante(e.id) or (e.status = 'proposee' and e.reverses_id is null)))`;

/** Ce que le rejeu a fait — ou, en essai, ce qu'il aurait fait. */
export interface BilanDuRejeu {
  /** Pièces rejugées (jugement recalculé), y compris celles qui n'ont pas changé. */
  rejugees: number;
  /** Pièces dont le jugement a changé : une analyse nouvelle (en essai : l'aurait été). */
  changees: number;
  /** Pièces qui reçoivent une proposition d'écriture après le rejeu. */
  proposables: number;
  /**
   * Pièces toujours sans proposition, par raison : le code de chaque contrôle
   * en défaut quand le verdict bloque, sinon le code de la raison
   * (`RaisonSansEcriture`). Une pièce compte dans chacune de ses raisons.
   */
  nonProposables: Record<string, number>;
  /** Pièces en échec, consignées au journal des pannes. */
  enEchec: number;
  /** Le détail des pièces dont le jugement change, pour cet appel. */
  changements: Array<{ pieceId: string; tenantId: string; proposable: boolean }>;
  /** Où reprendre ; `null` quand tout le périmètre a été parcouru. */
  suite: string | null;
  /** La version des règles appliquée. */
  regles: string;
}

/** Les raisons d'une pièce sans proposition. */
function raisonsDe(p: Awaited<ReturnType<typeof propositionDePiece>>): string[] {
  if (p.ok) return [];
  if (p.controlesEnDefaut && p.controlesEnDefaut.length > 0) return p.controlesEnDefaut;
  return [p.raisonCode ?? `verdict.${p.verdictCode ?? "inconnu"}`];
}

/**
 * Consigner l'échec d'une pièce, sans jamais en créer un second. Au dossier de
 * la pièce si l'appelant en est membre, sinon au cabinet qui le tient : le
 * journal des pannes ne s'écrit que chez soi (RLS).
 */
async function consignerLEchec(db: Requete, tenantId: string, pieceId: string, e: unknown) {
  try {
    const { rows } = await db.query<{ ou: string | null }>(
      `select coalesce(
                (select $1::uuid where $1::uuid in (select app.member_orgs())),
                (select g.cabinet_org_id from identity.engagements g
                  where g.pme_org_id = $1 and g.status = 'actif'
                    and g.cabinet_org_id in (select app.member_orgs())
                  limit 1)) as ou`,
      [tenantId],
    );
    const chez = rows[0]?.ou;
    if (!chez) return;
    const erreur = e instanceof Error ? e : new Error(String(e));
    await journal.consigner(db, {
      tenantId: chez,
      ou: OU,
      message: `rejeu de la pièce ${pieceId} : ${erreur.message}`,
      pile: erreur.stack ?? null,
    });
  } catch {
    // Le journal lui-même a échoué : l'échec reste compté dans le bilan.
  }
}

/**
 * Rejuger, à l'ouverture, une pièce dont le jugement a été rendu sous des
 * règles plus anciennes — si l'appelant la supervise et qu'elle est dans le
 * périmètre. Rend vrai si une analyse nouvelle a été posée.
 */
export async function rejugerALOuverture(db: Requete, pieceId: string): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>(
    `select exists (
       select 1 from capture.pieces p
        where p.id = $1
          and (select a.regles from capture.analyses a
                where a.piece_id = p.id order by a.created_at desc limit 1)
              is distinct from $2
          and ${DANS_LE_PERIMETRE}) as ok`,
    [pieceId, REGLES_DU_JUGEMENT],
  );
  if (!rows[0]?.ok) return false;
  return (await rejugerLaPiece(db, pieceId)).change;
}

/**
 * Rejuger les pièces du périmètre — d'un dossier, ou de tous ceux que
 * l'appelant supervise. `essai` : tout est joué puis annulé (point de reprise
 * de la transaction), le bilan dit ce qui changerait.
 */
export async function rejugerLesPieces(
  db: Requete,
  options: { tenantId?: string | null; apres?: string | null; essai?: boolean } = {},
): Promise<BilanDuRejeu> {
  const debut = Date.now();
  const bilan: BilanDuRejeu = {
    rejugees: 0,
    changees: 0,
    proposables: 0,
    nonProposables: {},
    enEchec: 0,
    changements: [],
    suite: null,
    regles: REGLES_DU_JUGEMENT,
  };
  // En essai, tout se joue puis s'annule — les traces de panne comprises :
  // l'essai n'écrit rien, ses échecs se lisent dans le bilan.
  if (options.essai) await db.query("savepoint rejeu_essai");

  let apres = options.apres ?? null;
  for (;;) {
    const { rows: page } = await db.query<{ id: string; tenant_id: string }>(
      `select p.id, p.tenant_id from capture.pieces p
        where ($1::uuid is null or p.tenant_id = $1)
          and ($2::uuid is null or p.id > $2)
          and ${DANS_LE_PERIMETRE}
        order by p.id
        limit $3`,
      [options.tenantId ?? null, apres, PIECES_PAR_PAGE],
    );
    for (const piece of page) {
      await db.query("savepoint rejeu_piece");
      try {
        const { change } = await rejugerLaPiece(db, piece.id);
        const proposition = await propositionDePiece(db, piece.id);
        await db.query("release savepoint rejeu_piece");
        bilan.rejugees += 1;
        if (proposition.ok) bilan.proposables += 1;
        for (const r of raisonsDe(proposition))
          bilan.nonProposables[r] = (bilan.nonProposables[r] ?? 0) + 1;
        if (change) {
          bilan.changees += 1;
          bilan.changements.push({
            pieceId: piece.id,
            tenantId: piece.tenant_id,
            proposable: proposition.ok,
          });
        }
      } catch (e) {
        await db.query("rollback to savepoint rejeu_piece");
        bilan.enEchec += 1;
        await consignerLEchec(db, piece.tenant_id, piece.id, e);
      }
    }
    if (page.length < PIECES_PAR_PAGE) break;
    apres = page[page.length - 1]!.id;
    if (Date.now() - debut >= BUDGET_MS) {
      bilan.suite = apres;
      break;
    }
  }

  if (options.essai) await db.query("rollback to savepoint rejeu_essai");
  return bilan;
}
