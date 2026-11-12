/**
 * Le compte de résultat compte la dotation constatée (recette du 11 novembre
 * 2026, point 1.7) : une dotation aux amortissements inscrite au journal OD
 * manquait au compte de résultat du dossier, donc au procès-verbal.
 *
 * La cause n'était pas le journal : la porte datait la dotation du dernier
 * jour de l'exercice, et le cumul du dossier s'arrête au jour où on le lit.
 * Une dotation constatée en cours d'exercice se date désormais du jour du
 * constat.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/le-resultat-compte-la-dotation-constatee.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { computePnl } from "@malica/socle";
import { arreteDuCumul, debutDExercice } from "@malica/socle/exercice";

import { BASE_CONFIGUREE, monterUneSociete, type SocieteDEssai } from "./circuit-d-essai.ts";
import { fermerLePool, sousIdentite } from "./db.ts";

interface Ligne {
  journal: string;
  accountCode: string;
  debit: string;
  credit: string;
}

describe("le compte de résultat compte la dotation constatée", { skip: !BASE_CONFIGUREE }, () => {
  let s: SocieteDEssai;
  let jour: string;
  let annee: number;

  before(async () => {
    s = await monterUneSociete(`pnl-${Date.now()}`);
    const { rows } = await s.admin.query<{ jour: string }>(`select current_date::text as jour`);
    jour = rows[0]!.jour;
    annee = Number(jour.slice(0, 4));
  });

  after(async () => {
    try {
      await s?.fermer();
    } finally {
      await fermerLePool();
    }
  });

  it("le résultat du dossier est la somme des charges et des produits inscrits, dotation comprise", async () => {
    // Une facture inscrite, puis une dotation de l'exercice en cours.
    const piece = await s.deposer("amel", "entite");
    await s.lire("amel", piece);
    await s.fait("amel", "collab.envoyer", piece);
    await s.priseEnCharge(piece);
    const categorie = (
      await s.admin.query<{ id: string; dotation: string }>(
        `select id, account_dotation as dotation from ref.immo_categories
          where pack_version_id = $1 and valid_to is null order by code limit 1`,
        [s.pack],
      )
    ).rows[0]!;
    const bien = await sousIdentite(s.gens.amel.id, async (db) => {
      const r = await db.query<{ id: string }>(
        `select public.immo_bien_creer($1, null, 'partage', null, $2, 'Vitrine', $3::date,
                                       1000, 0, 'lineaire', 4::smallint, 1, 'TND', $4) as id`,
        [s.pme, categorie.id, `${annee}-01-01`, s.pack],
      );
      return r.rows[0]!.id;
    });
    const { ecritureId } = (await s.fait("expert", "immo.constaterDotation", {
      assetId: bien,
      exercice: annee,
      months: 12,
      dotation: "250.000",
      cumul: "250.000",
      vnc: "750.000",
      packVersionId: s.pack,
    })) as { ecritureId: string };

    const ecriture = (
      await s.admin.query<{ journal: string; date: string; status: string }>(
        `select journal, date_ecriture::text as date, status from socle.ecritures where id = $1`,
        [ecritureId],
      )
    ).rows[0]!;
    assert.equal(ecriture.journal, "OD");
    assert.equal(ecriture.status, "booked");
    // Constatée aujourd'hui, elle ne se date pas d'un jour qui n'est pas arrivé.
    assert.equal(ecriture.date, jour);

    // Ce que l'écran du dossier et le procès-verbal lisent : le cumul de l'exercice au jour.
    const periode = jour.slice(0, 7);
    const lignes = (await s.fait(
      "expert",
      "office.periodeLignes",
      s.pme,
      debutDExercice(null, periode),
      arreteDuCumul(periode, jour),
    )) as Ligne[];
    const classes = (await s.fait("expert", "referentiel.classesDeComptes", s.pack)) as Array<{
      prefix: string;
      nature: "charge" | "produit" | "actif" | "passif";
    }>;
    const pnl = computePnl({
      period: periode,
      currency: { code: "TND", decimals: 3 },
      entries: lignes.map((l) => ({
        account_code: l.accountCode,
        debit: l.debit,
        credit: l.credit,
      })),
      coa: [],
      classes,
    });

    // Le journal : toutes les écritures inscrites du dossier, tous journaux confondus.
    const journal = (
      await s.admin.query<{ nature: string; solde: string }>(
        `select k.nature, sum(l.debit - l.credit)::text as solde
           from socle.ecritures e
           join socle.ecriture_lignes l on l.ecriture_id = e.id
           join lateral (
             select c.nature from ref.account_classes c
              where c.pack_version_id = $2 and starts_with(l.account_code, c.prefix)
              order by length(c.prefix) desc limit 1) k on true
          where e.tenant_id = $1 and e.status = 'booked'
            and k.nature in ('charge', 'produit')
          group by k.nature`,
        [s.pme, s.pack],
      )
    ).rows;
    const du = (nature: string) => Number(journal.find((j) => j.nature === nature)?.solde ?? 0);

    assert.ok(lignes.some((l) => l.journal === "OD" && l.accountCode === categorie.dotation));
    assert.equal(Number(pnl.charges), du("charge"));
    assert.equal(Number(pnl.produits), 0 - du("produit"));
    assert.equal(Number(pnl.charges), 350);
  });

  it("une dotation d'un exercice clos se date toujours de sa clôture", async () => {
    const categorie = (
      await s.admin.query<{ id: string }>(
        `select id from ref.immo_categories
          where pack_version_id = $1 and valid_to is null order by code limit 1`,
        [s.pack],
      )
    ).rows[0]!;
    const bien = await sousIdentite(s.gens.amel.id, async (db) => {
      const r = await db.query<{ id: string }>(
        `select public.immo_bien_creer($1, null, 'partage', null, $2, 'Etabli', $3::date,
                                       1000, 0, 'lineaire', 4::smallint, 1, 'TND', $4) as id`,
        [s.pme, categorie.id, `${annee - 1}-01-01`, s.pack],
      );
      return r.rows[0]!.id;
    });
    const { ecritureId } = (await s.fait("expert", "immo.constaterDotation", {
      assetId: bien,
      exercice: annee - 1,
      months: 12,
      dotation: "250.000",
      cumul: "250.000",
      vnc: "750.000",
      packVersionId: s.pack,
    })) as { ecritureId: string };
    const { rows } = await s.admin.query<{ date: string }>(
      `select date_ecriture::text as date from socle.ecritures where id = $1`,
      [ecritureId],
    );
    assert.equal(rows[0]!.date, `${annee - 1}-12-31`);
  });
});
