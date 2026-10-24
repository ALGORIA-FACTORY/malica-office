/**
 * Le barème d'un droit fixe se lit à la date de la PIÈCE, pas au jour de la lecture.
 *
 * ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
 *
 * Relecture de la demande n°87 (24 octobre 2026). La proposition d'écriture
 * bloque un droit imprimé qui diffère du barème (`FISCAL_CHARGE_MISMATCH`), et
 * lisait ce barème par `referentiel.fiscalCharges`, filtré sur `aujourdhui()`.
 * Au lendemain d'un changement du tarif du timbre, toute facture ANTÉRIEURE —
 * qui porte, à juste titre, le tarif de son jour — aurait été bloquée.
 *
 * L'épreuve pose un droit d'essai, à son propre code pour ne rien changer au
 * barème que les autres épreuves lisent : 1,000 jusqu'au 30 juin 2026, 2,000
 * depuis le 1er juillet. Le changement est PASSÉ, comme le jour où il frappe.
 *
 *   node --experimental-strip-types --test src/scan/le-bareme-se-lit-a-la-date-de-la-piece.test.ts
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentiteDuServeur } from "../db.ts";
import { matriculeDEssai } from "../matricule-d-essai.ts";
import { executerRpc } from "../rpc.ts";

import { lecture } from "./lecture-d-essai.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

type Proposition = { ok: true } | { ok: false; raison: string; verdict?: string };

describe("le barème se lit à la date de la pièce", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `bareme-${Date.now()}`;
  const CODE = `TIMBRE_ESSAI_${Date.now()}`;
  const MF_DOSSIER = matriculeDEssai();
  let u: Utilisateur;
  let org = "";
  let packId = "";

  const rpc = (depot: string, methode: string, ...args: unknown[]) =>
    sousIdentiteDuServeur(u.id, (db) => executerRpc(db, { depot, methode, args }, "serveur"));

  const admin = async <T>(f: (p: pg.Pool) => Promise<T>) => {
    const p = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
    try {
      return await f(p);
    } finally {
      await p.end();
    }
  };

  /** Une facture d'achat datée de `iso`, qui imprime le droit d'essai à 1,000. */
  async function pieceDatee(cle: string, iso: string) {
    const l = lecture({ clientMf: MF_DOSSIER, numero: `F-${cle}` });
    const [annee, mois, jour] = iso.split("-");
    l.tokens[5]!.text = `${jour}/${mois}/${annee}`;
    l.extract.document_date = iso;
    l.extract.other_charges = [{ code: CODE, label: "", amount: "1.000" }];
    const p = (await rpc("capture", "enregistrer", {
      tenantId: org,
      source: "pdf",
      vis: "partage",
      idempotencyKey: `${marque}-${cle}`,
      contentType: "application/pdf",
      pageCount: 1,
    })) as { id: string };
    await rpc("capture", "persisterLecture", {
      pieceId: p.id,
      packId,
      tokens: l.tokens,
      contract: "extract.v1",
      extract: l.extract,
      citations: l.citations,
      flags: [],
      articles: [],
      documentKind: "facture_achat",
      documentDate: iso,
      mode: "pdf-text",
      confianceParChamp: { "totals.ttc": 0.95 },
    });
    await rpc("capture", "analyser", p.id);
    return p.id;
  }

  before(async () => {
    const c = await creerCompte(`${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(c);
    u = c;
    org = await sousIdentiteDuServeur(u.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', 'ALGORIA FACTORY SARL', 'autonome',
                                           '${MF_DOSSIER}', 'TN', 'TND') as id`,
      );
      return rows[0]!.id;
    });
    packId = await admin(async (p) => {
      const { rows } = await p.query<{ id: string }>(
        `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
          order by effective_from desc limit 1`,
      );
      const pack = rows[0]!.id;
      // Le compte est celui que le pack donne déjà au timbre d'achat : l'épreuve
      // n'invente que le tarif et sa date, pas l'imputation.
      await p.query(
        `insert into ref.fiscal_charges
           (pack_version_id, code, label, document_kind, account_code, basis, fixed_amount,
            legal_reference, valid_from, valid_to)
         select pack_version_id, $2, 'Droit d''essai', 'facture_achat', account_code, basis,
                v.montant, 'épreuve automatisée', v.du, v.au
           from ref.fiscal_charges,
                (values (1.000, date '2026-01-01', date '2026-06-30'),
                        (2.000, date '2026-07-01', null::date)) v(montant, du, au)
          where pack_version_id = $1 and code = 'DROIT_TIMBRE'
            and document_kind = 'facture_achat' and valid_to is null`,
        [pack, CODE],
      );
      return pack;
    });
  });

  after(async () => {
    await admin(async (p) => {
      await p.query(`delete from ref.fiscal_charges where code = $1`, [CODE]);
      await p.query(
        `update identity.organizations set archived_at = now(),
                archived_reason = 'fixture de test automatisé' where id = $1`,
        [org],
      );
    });
    await fermerLePool();
  });

  it("le référentiel rend le tarif en vigueur à la date demandée", async () => {
    const tarif = async (jour: string) => {
      const droits = (await rpc("referentiel", "fiscalCharges", packId, "fr", jour)) as Array<{
        code: string;
        fixedAmount: string | null;
      }>;
      return droits.filter((d) => d.code === CODE).map((d) => d.fixedAmount);
    };
    assert.deepEqual(await tarif("2026-03-15"), ["1.000"]);
    assert.deepEqual(await tarif("2026-09-10"), ["2.000"]);
  });

  it("une facture antérieure au changement, au tarif de son jour, n'est pas bloquée", async () => {
    const piece = await pieceDatee("avant", "2026-03-15");
    const r = (await rpc("office", "propositionDePiece", piece)) as Proposition;
    assert.ok(r.ok, r.ok ? "" : r.raison);
  });

  it("une facture postérieure qui imprime l'ancien tarif est bloquée", async () => {
    const piece = await pieceDatee("apres", "2026-09-10");
    const r = (await rpc("office", "propositionDePiece", piece)) as Proposition;
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.raison, new RegExp(`${CODE}.*différent du barème`));
  });
});
