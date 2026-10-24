/**
 * La dette qu'un paiement éteint se lit à un seul endroit : `app.dette_eteinte`.
 *
 * ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
 *
 * Relecture de la demande n°87 (24 octobre 2026) : la somme des débits des
 * écritures de règlement VIVANTES d'un paiement était recopiée dans
 * `capture.paiementsDUnePiece` et dans la proposition de règlement, et la
 * première relisait en plus les décimales de la devise à la main. Aucune
 * épreuve ne lisait `detteEteinteMineur`.
 *
 * Le cas qui distingue la dette du chèque : une retenue à la source. Le chèque
 * porte le net, la dette éteinte est le TTC.
 *
 *   node --experimental-strip-types --test src/scan/la-dette-eteinte-se-lit-une-fois.test.ts
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentiteDuServeur } from "../db.ts";
import { matriculeDEssai } from "../matricule-d-essai.ts";
import { executerRpc } from "../rpc.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

type Paiement = { id: string; montantMineur: number | null; detteEteinteMineur: number | null };

describe("la dette éteinte se lit une fois", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `dette-${Date.now()}`;
  let u: Utilisateur;
  let org = "";
  let pack = "";
  let motif = "";

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

  /** Une facture d'achat lue et jugée « à comptabiliser », posée par l'administrateur. */
  async function factureLue(cle: string, ttcMineur: number) {
    const id = (
      (await rpc("capture", "enregistrer", {
        tenantId: org,
        source: "pdf",
        vis: "personnel",
        idempotencyKey: `${marque}-${cle}`,
        contentType: "application/pdf",
        pageCount: 1,
        documentKind: "facture_achat",
      })) as { id: string }
    ).id;
    await rpc("capture", "preciser", id, "document_kind", "facture_achat");
    await admin(async (p) => {
      const { rows } = await p.query<{ id: string }>(
        `insert into capture.extractions (tenant_id, piece_id, contract, payload)
         values ($1, $2, 'extract.v1', $3::jsonb) returning id`,
        [
          org,
          id,
          JSON.stringify({ issuer: "COMPTOIR DU CENTRE SUARL", references: { invoice_no: cle } }),
        ],
      );
      await p.query(
        `insert into capture.analyses
           (tenant_id, piece_id, extraction_id, pack_version_id, normalisation, controles, verdict, motifs)
         values ($1, $2, $3, $4, $5::jsonb, '[{"controle":"essai","ok":true}]'::jsonb,
                 'à comptabiliser', '[{"motif":"essai"}]'::jsonb)`,
        [
          org,
          id,
          rows[0]!.id,
          pack,
          JSON.stringify({ etat: "tranche", montants: { ttc: ttcMineur, tva: null } }),
        ],
      );
    });
    return id;
  }

  const paiements = async (pieceId: string) =>
    (await rpc("capture", "paiementsDUnePiece", pieceId)) as Paiement[];

  const detteEnBase = (paiementId: string) =>
    sousIdentiteDuServeur(u.id, async (db) => {
      const { rows } = await db.query<{ d: string | null }>(
        `select app.dette_eteinte($1)::text as d`,
        [paiementId],
      );
      return rows[0]!.d;
    });

  before(async () => {
    const c = await creerCompte(`${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(c);
    u = c;
    org = await sousIdentiteDuServeur(u.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', 'ALGORIA FACTORY SUARL', 'autonome',
                                           '${matriculeDEssai("A", "M")}', 'TN', 'TND') as id`,
      );
      return rows[0]!.id;
    });
    ({ pack, motif } = await admin(async (p) => {
      const { rows: packs } = await p.query<{ id: string }>(
        `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
          order by effective_from desc limit 1`,
      );
      const { rows: motifs } = await p.query<{ id: string }>(
        `select id from ref.paiement_motifs_annulation where code = 'moyen_errone'`,
      );
      return { pack: packs[0]!.id, motif: motifs[0]!.id };
    }));
  });

  after(async () => {
    await admin((p) =>
      p.query(
        `update identity.organizations set archived_at = now(),
                archived_reason = 'fixture de test automatisé' where id = $1`,
        [org],
      ),
    );
    await fermerLePool();
  });

  it("un chèque au net avec retenue éteint le TTC, lu par la fonction et par l'écran", async () => {
    // 1 969,610 TTC × 1,5 % = 29,544 retenus ; le chèque porte 1 940,066.
    const f = await factureLue("DETTE-RETENUE", 1_969_610);
    const p = (await rpc("capture", "enregistrerPaiement", {
      pieceId: f,
      packId: pack,
      moyenCode: "cheque",
      montantMineur: 1_940_066,
      devise: "TND",
      payeLe: "2026-10-13",
      justificatifPieceId: null,
      reference: "4512899",
    })) as string;

    // Rien d'inscrit : aucune dette éteinte, ni en base ni à l'écran.
    assert.equal(await detteEnBase(p), null);
    assert.equal((await paiements(f))[0]!.detteEteinteMineur, null);

    await rpc("office", "inscrireLeReglement", p, {
      codes: ["RAS_MARCHES_ACQUISITIONS"],
      baseReglee: "1969.610",
      justification: "Certificat RS-1, acquisition qualifiée",
    });
    assert.equal(Number(await detteEnBase(p)), 1969.61);
    const [ligne] = await paiements(f);
    assert.equal(ligne!.montantMineur, 1_940_066);
    assert.equal(ligne!.detteEteinteMineur, 1_969_610);

    // Annulé : le règlement est contre-passé, il n'éteint plus rien.
    await rpc("capture", "annulerPaiement", p, motif);
    assert.equal(await detteEnBase(p), null);
    const apres = (await paiements(f)).find((x) => x.id === p);
    assert.equal(apres!.detteEteinteMineur, null);
  });
});
