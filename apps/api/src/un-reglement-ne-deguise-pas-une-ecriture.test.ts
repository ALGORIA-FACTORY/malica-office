/**
 * Un règlement ne déguise pas une écriture (vérification indépendante du lot S5).
 *
 * Le lot S5 ferme à la PME toute écriture d'un dossier confié, sauf le
 * règlement : le déclencheur `ecritures_du_cabinet_sont_a_lui` laisse passer
 * `nature = 'reglement'`, et `socle_ecriture_book` n'arrête la PME que sur
 * `nature = 'piece'`. Or la nature n'est qu'une étiquette : `socle_ecriture_propose`
 * la tire de la seule présence de `p_paiement`, quelles que soient les lignes.
 * Le propriétaire d'un dossier confié propose alors, par le dépôt servi au
 * navigateur (`office.propose`), une « écriture de règlement » au journal des
 * ventes, 607 / 707, et l'inscrit par la porte de la base — dans les livres
 * que tient le cabinet.
 *
 *   node --experimental-strip-types --test src/un-reglement-ne-deguise-pas-une-ecriture.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { BASE_CONFIGUREE, monterUneSociete, type SocieteDEssai } from "./circuit-d-essai.ts";
import { fermerLePool, sousIdentiteDuServeur } from "./db.ts";

describe("un règlement ne déguise pas une écriture", { skip: !BASE_CONFIGUREE }, () => {
  let s: SocieteDEssai;

  before(async () => {
    s = await monterUneSociete(`reglement-deguise-${Date.now()}`);
  });

  after(async () => {
    try {
      await s?.fermer();
    } finally {
      await fermerLePool();
    }
  });

  const LIGNES_INVENTEES = [
    {
      account_code: "607",
      libelle: "Achat inventé",
      debit: "999.000",
      credit: "0",
      tax_code: null,
    },
    {
      account_code: "707",
      libelle: "Vente inventée",
      debit: "0",
      credit: "999.000",
      tax_code: null,
    },
  ];

  for (const mode of ["autonome", "mandate"] as const)
    it(`dossier confié (${mode}) : la PME n'inscrit pas, sous le nom d'un règlement, des lignes qui n'en sont pas`, async () => {
      await s.admin.query(
        `update identity.organizations set validation_mode = $2::app.validation_mode_t where id = $1`,
        [s.pme, mode],
      );
      try {
        // Une pièce passée chez le comptable, qu'il prend en charge ; la société la paie.
        const piece = await s.deposer("sami", "entite");
        await s.lire("sami", piece);
        await s.fait("sami", "collab.envoyer", piece);
        await s.fait("amel", "collab.envoyer", piece);
        await s.priseEnCharge(piece);
        const paiement = (await s.fait("amel", "capture.enregistrerPaiement", {
          pieceId: piece,
          packId: s.pack,
          moyenCode: "especes",
          montantMineur: 100000,
          devise: "TND",
          payeLe: "2026-10-03",
        })) as string;

        // Le dépôt que le navigateur appelle : une « proposition de règlement »
        // au journal des ventes, dont aucune ligne ne règle quoi que ce soit.
        let proposee: string | null = null;
        try {
          proposee = (await s.fait("amel", "office.propose", {
            pieceId: piece,
            journal: "VTE",
            date: "2026-10-03",
            libelle: "Règlement",
            packVersionId: s.pack,
            lignes: LIGNES_INVENTEES,
            devise: "TND",
            paiementId: paiement,
          })) as string;
        } catch {
          // Refusée : c'est ce qu'on attend.
        }
        // Et la porte de la base, sous l'identité de la société (R6 : la base décide).
        if (proposee)
          await sousIdentiteDuServeur(s.gens.amel.id, (db) =>
            db.query(`select public.socle_ecriture_book($1)`, [proposee]),
          ).catch(() => undefined);

        const { rows } = await s.admin.query<{ status: string; journal: string }>(
          `select e.status, e.journal from socle.ecritures e
            where e.piece_id = $1
              and exists (select 1 from socle.ecriture_lignes l
                           where l.ecriture_id = e.id and l.account_code = '707')`,
          [piece],
        );
        assert.deepEqual(
          rows,
          [],
          "la PME a écrit, sous le nom d'un règlement, une écriture 607 / 707 dans les livres du cabinet",
        );
      } finally {
        await s.admin.query(
          `update identity.organizations set validation_mode = 'autonome' where id = $1`,
          [s.pme],
        );
      }
    });
});
