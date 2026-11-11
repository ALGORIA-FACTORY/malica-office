/**
 * Le crayon d'une facture lue : les lignes se corrigent (10 novembre 2026).
 *
 * Demande du dirigeant : un crayon à côté de chaque composante de la facture.
 * Cette épreuve tient les LIGNES — libellé, quantité, prix unitaire HT, montant
 * HT, code TVA —, sur la pièce type dont le pied tombe juste.
 *
 *   - la correction est une précision (R7) : la lecture d'origine est intacte,
 *     et la fiche porte la valeur lue, la valeur saisie, l'auteur ;
 *   - la pièce est rejugée, et le message vient du jugement (R3) : sur la
 *     pièce type (HT 15000,000 ; TVA 2850,000 ; total 17851,000 ; timbre
 *     1,000) il ferme, et tant qu'un montant reste faux il ne ferme pas ;
 *   - la saisie est bornée par la devise du référentiel (R4), jamais arrondie ;
 *   - une personne sans droit sur la pièce est refusée, une pièce engagée aussi.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/le-crayon-corrige-les-lignes.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentite, sousIdentiteDuServeur } from "./db.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";
import { executerRpc } from "./rpc.ts";
import { lecture as lectureDEssai } from "./scan/lecture-d-essai.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

interface Jugement {
  ferme: boolean;
  etat: string;
  devise: string | null;
  montants: {
    baseHt: string | null;
    tva: string | null;
    droits: Array<string | null>;
    ttc: string | null;
  } | null;
  aVerifier: string[];
}
interface Corrige {
  id: string | null;
  champ: string;
  valeur: string;
  jugement: Jugement;
}

describe("le crayon corrige les lignes de la facture", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `lignes-${Date.now()}`;
  const mdp = "MotDePasseTresLong2026!";
  const mf = matriculeDEssai("A", "M");
  let dirigeant: Utilisateur;
  let etranger: Utilisateur;
  let societe = "";
  let packId = "";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });

  const fait = (u: () => Utilisateur, methode: string, ...args: unknown[]) => {
    const [depot, nom] = methode.split(".") as [string, string];
    return sousIdentite(u().id, (db) => executerRpc(db, { depot, methode: nom, args }));
  };
  const pmeFait = (methode: string, ...args: unknown[]) => fait(() => dirigeant, methode, ...args);

  let n = 0;
  /** La pièce type dont le pied tombe juste, avec ses deux lignes. */
  const lue = async () => {
    n += 1;
    const l = lectureDEssai({
      clientMf: mf,
      numero: `CRAYON-${n}`,
      ht: ["15", "000,000"],
      tva: "2850,000",
      ttc: ["17", "851,000"],
    });
    const p = (await pmeFait("capture.enregistrer", {
      tenantId: societe,
      source: "pdf",
      vis: "entite",
      idempotencyKey: `${marque}-${n}`,
      contentType: "application/pdf",
      pageCount: 1,
    })) as { id: string };
    await sousIdentiteDuServeur(dirigeant.id, (db) =>
      executerRpc(
        db,
        {
          depot: "capture",
          methode: "persisterLecture",
          args: [
            {
              pieceId: p.id,
              packId,
              tokens: l.tokens,
              contract: "extract.v1",
              extract: {
                ...l.extract,
                lines: [
                  {
                    label: "Achats",
                    tax_code: "TVA19",
                    base_ht: "15000.000",
                    vat_amount: "2850.000",
                    ttc: "17850.000",
                  },
                ],
                totals: { base_ht: "15000.000", vat: "2850.000", ttc: "17851.000" },
                articles: [
                  {
                    designation: "Ramettes papier A4",
                    quantity: "200",
                    unit_price_ht: "25.000",
                    unit_price_ttc: null,
                    total_ht: "5000.000",
                    tax_code: "TVA19",
                  },
                  {
                    designation: "Cartouches d'encre",
                    quantity: "20",
                    unit_price_ht: "500.000",
                    unit_price_ttc: null,
                    total_ht: "10000.000",
                    tax_code: "TVA19",
                  },
                ],
              },
              citations: l.citations,
              flags: [],
              articles: [],
              documentKind: "facture_achat",
              documentDate: l.extract.document_date,
              mode: "pdf-text",
              confianceParChamp: { "totals.ttc": 0.95 },
            },
          ],
        },
        "serveur",
      ),
    );
    await pmeFait("capture.analyser", p.id);
    return p.id;
  };

  const corrige = (id: string, champ: string, valeur: string) =>
    pmeFait("capture.corrigerLeChamp", id, champ, valeur) as Promise<Corrige>;

  before(async () => {
    dirigeant = (await creerCompte(`dirigeant-${marque}@essai.local`, mdp))!;
    etranger = (await creerCompte(`etranger-${marque}@essai.local`, mdp))!;
    assert.ok(dirigeant && etranger);
    societe = await sousIdentite(dirigeant.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', $1, 'autonome', $2, 'TN', 'TND') as id`,
        [`PME LIGNES ${marque}`, mf],
      );
      return rows[0]!.id;
    });
    packId = (
      await admin.query<{ id: string }>(
        `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
          order by effective_from desc limit 1`,
      )
    ).rows[0]!.id;
  });

  after(async () => {
    try {
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = $1 and archived_at is null`,
        [societe],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  const dites = async (id: string, champ: string) =>
    (
      await admin.query<{ valeur: string }>(
        `select valeur from capture.precisions where piece_id = $1 and champ = $2 order by decided_at`,
        [id, champ],
      )
    ).rows.map((r) => r.valeur);

  it("la pièce type tient : le pied ferme et les lignes aussi", async () => {
    const id = await lue();
    // Redire la quantité lue la confirme : le jugement ferme, rien n'est reproché.
    const r = await corrige(id, "articles[0].quantity", "200");
    assert.equal(r.jugement.ferme, true, JSON.stringify(r.jugement));
    assert.deepEqual(r.jugement.aVerifier, []);
  });

  it("chaque composante d'une ligne s'inscrit en précision, et la lecture reste", async () => {
    const id = await lue();
    for (const [champ, valeur, attendu] of [
      ["articles[0].designation", "  Ramettes   A4 80g ", "Ramettes A4 80g"],
      ["articles[0].quantity", "200.0", "200"],
      ["articles[0].unit_price_ht", "25", "25.000"],
      ["articles[0].total_ht", "5000", "5000.000"],
      ["articles[0].tax_code", "TVA19", "TVA19"],
    ] as const) {
      const r = await corrige(id, champ, valeur);
      assert.equal(r.valeur, attendu, champ);
    }
    const { rows } = await admin.query<{ n: number; designation: string; code: string }>(
      `select count(*) over ()::int as n, payload #>> '{articles,0,designation}' as designation,
              payload #>> '{articles,0,tax_code}' as code
         from capture.extractions where piece_id = $1`,
      [id],
    );
    assert.equal(rows.length, 1, "aucune lecture nouvelle");
    assert.equal(
      rows[0]!.designation,
      "Ramettes papier A4",
      "la lecture n'est jamais modifiée (R7)",
    );

    const fiche = (await pmeFait("capture.dossier", id)) as {
      extraction: { payload: { articles: Array<{ designation: string }> } };
      corrections: Array<{ champ: string; valeur: string; lue: string | null; par: string | null }>;
    };
    assert.equal(fiche.extraction.payload.articles[0]!.designation, "Ramettes A4 80g");
    const c = fiche.corrections.find((x) => x.champ === "articles[0].designation");
    assert.equal(c?.lue, "Ramettes papier A4", "la valeur lue reste, à côté");
    assert.ok(c?.par, "la personne qui a saisi est nommée");
  });

  it("une ligne dont le montant ne suit pas son prix ne ferme pas, et se nomme", async () => {
    const id = await lue();
    const r = await corrige(id, "articles[0].unit_price_ht", "26.000");
    assert.equal(r.jugement.ferme, false, JSON.stringify(r.jugement));
    assert.deepEqual(r.jugement.aVerifier, ["articles[0].unit_price_ht", "articles[0].total_ht"]);
    // Revenir au prix imprimé : le jugement ferme de nouveau.
    const apres = await corrige(id, "articles[0].unit_price_ht", "25.000");
    assert.equal(apres.jugement.ferme, true, JSON.stringify(apres.jugement));
    assert.deepEqual(await dites(id, "articles[0].unit_price_ht"), ["26.000", "25.000"]);
  });

  it("des lignes qui ne font plus la base nomment la base", async () => {
    const id = await lue();
    // Quantité et montant corrigés ensemble de la ligne : 21 × 500 = 10500, la base reste 15000.
    await corrige(id, "articles[1].quantity", "21");
    const r = await corrige(id, "articles[1].total_ht", "10500.000");
    assert.equal(r.jugement.ferme, false, JSON.stringify(r.jugement));
    assert.ok(r.jugement.aVerifier.includes("totals.base_ht"), JSON.stringify(r.jugement));
  });

  it("le code TVA se choisit dans la liste du référentiel à la date de la pièce", async () => {
    const id = await lue();
    const liste = (await pmeFait("capture.codesDeTva", id, "fr")) as Array<{
      code: string;
      label: string;
      taux: string;
    }>;
    const { rows } = await admin.query<{ code: string }>(
      `select distinct t.code from ref.tva_rates t
        where t.pack_version_id = $1 and t.valid_from <= current_date
          and (t.valid_to is null or t.valid_to >= current_date)`,
      [packId],
    );
    assert.deepEqual(
      liste.map((c) => c.code).sort(),
      rows.map((r) => r.code).sort(),
      "la liste est celle du référentiel, pas une liste de l'écran",
    );
    assert.ok(liste.length > 1 && liste.every((c) => c.label.length > 0));

    const ok = await corrige(id, "articles[0].tax_code", "TVA07");
    assert.equal(ok.valeur, "TVA07");
    // Un taux saisi n'est pas un code : « 19 » n'existe pas au référentiel.
    await assert.rejects(corrige(id, "articles[0].tax_code", "19"), /code_tva_inconnu/);
    await assert.rejects(corrige(id, "articles[0].tax_code", "TVA99"), /code_tva_inconnu/);
    assert.deepEqual(await dites(id, "articles[0].tax_code"), ["TVA07"]);
  });

  it("quand c'est le pied qui ne ferme pas, une ligne corrigée n'est pas désignée seule", async () => {
    const id = await lue();
    // Le pied est faussé par une précision (TVA 2350), puis une ligne est corrigée.
    await corrige(id, "totals.vat", "2350.000");
    const r = await corrige(id, "articles[0].tax_code", "TVA19");
    assert.equal(r.jugement.ferme, false, JSON.stringify(r.jugement));
    assert.deepEqual(r.jugement.aVerifier, [
      "articles[0].tax_code",
      "totals.base_ht",
      "totals.vat",
      "totals.ttc",
    ]);
  });

  it("une saisie illisible, trop précise, vide ou sur une ligne inconnue est refusée", async () => {
    const id = await lue();
    await assert.rejects(corrige(id, "articles[0].quantity", "deux"), /quantite_illisible/);
    await assert.rejects(corrige(id, "articles[0].quantity", "1.1234567"), /quantite_illisible/);
    await assert.rejects(
      corrige(id, "articles[0].unit_price_ht", "25.0001"),
      /montant_trop_precis/,
    );
    await assert.rejects(corrige(id, "articles[0].total_ht", "-1"), /montant_illisible/);
    await assert.rejects(corrige(id, "articles[0].designation", "   "), /libelle_vide/);
    await assert.rejects(
      corrige(id, "articles[0].designation", "x".repeat(201)),
      /libelle_trop_long/,
    );
    await assert.rejects(corrige(id, "articles[9].quantity", "1"), /ligne_inconnue/);
    await assert.rejects(corrige(id, "articles[0].couleur", "bleu"), /champ/);
    const { rows } = await admin.query(`select 1 from capture.precisions where piece_id = $1`, [
      id,
    ]);
    assert.equal(rows.length, 0, "rien ne s'est écrit");
  });

  it("une personne sans droit est refusée, et une pièce engagée aussi", async () => {
    const id = await lue();
    await assert.rejects(
      fait(() => etranger, "capture.corrigerLeChamp", id, "articles[0].quantity", "3"),
      /introuvable|refus/,
    );
    await admin.query(`update capture.pieces set status = 'proposee' where id = $1`, [id]);
    await assert.rejects(corrige(id, "articles[0].quantity", "3"), /engagee/);
    const { rows } = await admin.query(`select 1 from capture.precisions where piece_id = $1`, [
      id,
    ]);
    assert.equal(rows.length, 0);
  });
});
