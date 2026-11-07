/**
 * Une écriture que le CABINET a inscrite n'est lisible d'aucune porte de la
 * PME (lot S2, `20261202100100`) — y compris quand la PME en avait posé la
 * proposition.
 *
 * Le portier lit, au-delà de son appelant, toute écriture que celui-ci a
 * CRÉÉE (`created_by`). Or la PME peut proposer l'écriture d'une pièce qu'elle
 * a transmise, et le cabinet engagé l'inscrire telle quelle : l'écriture
 * inscrite par le cabinet garde `created_by` = la PME. Revue indépendante du
 * 6 novembre 2026 : le propriétaire de la PME la valide, puis la
 * contre-passe, par les portes `socle_ecriture_review` et
 * `socle_ecriture_contre_passer` (dossier en validation autonome, cabinet
 * engagé — la fixture de la matrice des droits).
 *
 *   node --experimental-strip-types --test src/la-pme-ne-defait-pas-l-ecriture-inscrite-par-le-cabinet.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { BASE_CONFIGUREE, monterUneSociete, type SocieteDEssai } from "./circuit-d-essai.ts";
import { fermerLePool, sousIdentiteDuServeur } from "./db.ts";
import { office } from "./depots/office.ts";

describe(
  "la PME ne défait pas l'écriture que le cabinet a inscrite",
  { skip: !BASE_CONFIGUREE },
  () => {
    let s: SocieteDEssai;

    before(async () => {
      s = await monterUneSociete(`inscrite-s2-${Date.now()}`);
    });

    after(async () => {
      try {
        await s?.fermer();
      } finally {
        await fermerLePool();
      }
    });

    const chezLeComptable = async () => {
      const id = await s.deposer("sami", "entite");
      await s.lire("sami", id);
      await s.fait("sami", "collab.envoyer", id);
      await s.fait("amel", "collab.envoyer", id);
      return id;
    };

    it("proposée par la PME, inscrite par le cabinet : la PME ne la trouve plus", async () => {
      // Les comptes et la devise d'une écriture du cabinet servent de modèle.
      const modele = await s.priseEnCharge(await chezLeComptable());
      const { rows } = await s.admin.query<{
        journal: string;
        devise: string;
        account_code: string;
        tax_code: string | null;
        debit: string;
        credit: string;
      }>(
        `select e.journal, e.devise, l.account_code, l.tax_code, l.debit::text, l.credit::text
           from socle.ecritures e join socle.ecriture_lignes l on l.ecriture_id = e.id
          where e.id = $1 order by l.ordinal`,
        [modele],
      );

      const piece = await chezLeComptable();
      await sousIdentiteDuServeur(s.gens.expert.id, (db) =>
        db.query(`select public.piece_type_etabli_par_le_cabinet($1)`, [piece]),
      );
      const ecriture = await sousIdentiteDuServeur(s.gens.amel.id, (db) =>
        office.propose(db, {
          pieceId: piece,
          journal: rows[0]!.journal,
          date: "2026-10-05",
          libelle: "Proposée par la société",
          packVersionId: s.pack,
          devise: rows[0]!.devise,
          lignes: rows.map((l) => ({
            account_code: l.account_code,
            libelle: "Ligne",
            debit: l.debit,
            credit: l.credit,
            tax_code: l.tax_code,
          })),
        }),
      );
      // Le cabinet engagé l'inscrit : c'est désormais son écriture.
      await sousIdentiteDuServeur(s.gens.expert.id, (db) => office.book(db, ecriture));

      const motif = Object.values(s.motifs)[0]!;
      for (const [nom, sql, args] of [
        ["review", "select public.socle_ecriture_review($1, 'valide', null, null)", [ecriture]],
        ["contre_passer", "select public.socle_ecriture_contre_passer($1, $2)", [ecriture, motif]],
        [
          "fait_consigner",
          "select public.fait_consigner('ecriture.forcee', $1, '{}'::jsonb)",
          [ecriture],
        ],
      ] as const)
        await assert.rejects(
          sousIdentiteDuServeur(s.gens.amel.id, (db) => db.query(sql, [...args])),
          /refus\./,
          `amel · ${nom} : la porte trouve l'écriture que le cabinet a inscrite`,
        );

      const { rows: apres } = await s.admin.query<{ n: string }>(
        `select count(*)::text as n from socle.ecritures where reverses_id = $1`,
        [ecriture],
      );
      assert.equal(apres[0]!.n, "0", "l'écriture du cabinet n'est pas contre-passée");
    });

    /*
     * L'effet de bord relevé par la même revue : la porte de proposition ne
     * voyait plus l'écriture inscrite par le cabinet, ne refusait plus, et
     * laissait une proposition orpheline sur une pièce déjà inscrite.
     */
    it("la PME ne propose pas sur une pièce que le cabinet a inscrite", async () => {
      const piece = await chezLeComptable();
      await s.priseEnCharge(piece);
      for (const qui of ["amel", "bilel", "sami"] as const)
        await assert.rejects(
          sousIdentiteDuServeur(s.gens[qui].id, (db) =>
            office.propose(db, {
              pieceId: piece,
              journal: "ACH",
              date: "2026-10-02",
              libelle: "Proposée par la société",
              packVersionId: s.pack,
              devise: "TND",
              lignes: [
                { account_code: "601", libelle: "Achat", debit: "100.000", credit: "0" },
                { account_code: "401", libelle: "Fournisseur", debit: "0", credit: "100.000" },
              ],
            }),
          ),
          /refus\.ecriture\.reimputer/,
          qui,
        );
      const { rows } = await s.admin.query<{ n: string }>(
        `select count(*)::text as n from socle.ecritures
          where piece_id = $1 and status = 'proposee'`,
        [piece],
      );
      assert.equal(rows[0]!.n, "0", "aucune proposition orpheline");
    });
  },
);
