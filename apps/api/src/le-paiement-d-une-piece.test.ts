/**
 * Le paiement d'une pièce, et la date à laquelle elle part au cabinet.
 *
 * ================================================================= POURQUOI
 *
 * 10 octobre 2026, deux demandes du commanditaire au même moment :
 *
 *   — le moyen de paiement, choisi après la lecture, avec la photo de son
 *     justificatif sauf en espèces ;
 *   — la TVA du tableau de bord « imputée à la date de transmission au
 *     comptable, car le comptable est censé la déclarer dans le mois
 *     courant ».
 *
 * La seconde était impossible : la transmission n'était pas une date mais un
 * drapeau. On savait qu'une pièce était partie, jamais QUAND.
 *
 * Ces épreuves tiennent les garanties du référentiel et de la base, avant
 * qu'aucun écran ne s'y adosse. Elles ne touchent aucune donnée de tenant.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL_ADMIN"]);

describe("les moyens de paiement du pack", { skip: !BASE_CONFIGUREE }, () => {
  let pool: pg.Pool;
  let pack = "";

  before(async () => {
    pool = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
    const { rows } = await pool.query<{ id: string }>(
      `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
        order by effective_from desc limit 1`,
    );
    pack = rows[0]!.id;
  });

  after(async () => {
    await pool.end();
  });

  const moyens = async () => {
    const { rows } = await pool.query<{
      code: string;
      tresorerie_account: string | null;
      exige_justificatif: boolean;
    }>(
      `select code, tresorerie_account, exige_justificatif
         from ref.payment_means where pack_version_id = $1 order by rang`,
      [pack],
    );
    return rows;
  };

  it("les huit moyens demandés sont là, dans l'ordre", async () => {
    assert.deepEqual(
      (await moyens()).map((m) => m.code),
      [
        "especes",
        "cheque",
        "cheque_banque",
        "carte_bancaire",
        "virement",
        "traite",
        "autre",
        "non_paye",
      ],
    );
  });

  it("seules les espèces et le non-payé se passent de justificatif", async () => {
    // La règle du commanditaire, mot pour mot : « à l'exception d'espèces les
    // autres on doit prendre une photo ».
    const sans = (await moyens())
      .filter((m) => !m.exige_justificatif)
      .map((m) => m.code)
      .sort();
    assert.deepEqual(sans, ["especes", "non_paye"]);
  });

  it("chaque moyen qui exige une photo porte un compte de trésorerie", async () => {
    for (const m of await moyens()) {
      if (m.exige_justificatif) {
        assert.ok(
          m.tresorerie_account,
          `${m.code} : exiger une preuve de paiement sans savoir où la trésorerie bouge n'a pas de sens`,
        );
      }
    }
  });

  it("et chaque compte de trésorerie existe au plan comptable", async () => {
    /*
     * La garantie qui évite l'erreur invisible : un compte inventé resterait
     * silencieux jusqu'au jour où il produirait une écriture fausse. C'est la
     * même épreuve que pour les familles de charge, le 7 octobre.
     */
    const { rows } = await pool.query<{ code: string; compte: string }>(
      `select m.code, m.tresorerie_account as compte
         from ref.payment_means m
        where m.pack_version_id = $1
          and m.tresorerie_account is not null
          and not exists (
            select 1 from ref.accounts a
             where a.pack_version_id = m.pack_version_id
               and a.account_code = m.tresorerie_account)`,
      [pack],
    );
    assert.deepEqual(
      rows.map((r) => `${r.code} → ${r.compte}`),
      [],
      "un compte de trésorerie qui n'existe pas au plan comptable",
    );
  });

  it("la traite ne se confond pas avec la banque", async () => {
    // Une traite est une dette à échéance, pas un décaissement. Les loger au
    // même compte ferait disparaître l'échéance fournisseur.
    const m = await moyens();
    const traite = m.find((x) => x.code === "traite")!;
    const cheque = m.find((x) => x.code === "cheque")!;
    assert.notEqual(traite.tresorerie_account, cheque.tresorerie_account);
  });

  it("« pas encore payé » ne porte aucune trésorerie : rien n'a bougé", async () => {
    const m = (await moyens()).find((x) => x.code === "non_paye")!;
    assert.equal(m.tresorerie_account, null);
    assert.equal(m.exige_justificatif, false);
  });

  it("les huit sont traduits dans les trois langues", async () => {
    const { rows } = await pool.query<{ code: string; manquantes: string }>(
      `select m.code,
              string_agg(l.locale, ',' order by l.locale) as manquantes
         from ref.payment_means m
         left join ref.labels l on l.ns = 'moyen_paiement' and l.key = m.code
        where m.pack_version_id = $1
        group by m.code
       having count(l.id) <> 3`,
      [pack],
    );
    assert.deepEqual(rows, [], "un moyen non traduit s'affiche en français dans un écran anglais");
  });

  it("une contrainte empêche d'exiger une photo sans compte de trésorerie", async () => {
    await assert.rejects(
      () =>
        pool.query(
          `insert into ref.payment_means
             (pack_version_id, code, libelle, tresorerie_account, exige_justificatif, rang, valid_from)
           values ($1, 'incoherent', 'Incohérent', null, true, 99, date '2026-01-01')`,
          [pack],
        ),
      /payment_means_justificatif_implique_tresorerie/,
      "la cohérence doit être dans la contrainte, pas dans la discipline",
    );
  });
});

describe("le reçu et son justificatif", { skip: !BASE_CONFIGUREE }, () => {
  let pool: pg.Pool;

  before(() => {
    pool = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
  });
  after(async () => {
    await pool.end();
  });

  it("ne portent AUCUNE écriture, et partent quand même au cabinet", async () => {
    /*
     * La garantie de premier ordre. Un PDF qui arrive chez le comptable et
     * ressemble à une pièce justificative sera tôt ou tard comptabilisé — et
     * la dépense serait comptée deux fois : une par la facture, une par son
     * reçu.
     */
    const { rows } = await pool.query<{
      code: string;
      porte_ecriture: boolean;
      transmissible: boolean;
    }>(
      `select code, porte_ecriture, transmissible from ref.document_types
        where code in ('recu_de_paiement', 'justificatif_paiement') order by code`,
    );
    assert.equal(rows.length, 2, "les deux types doivent exister");
    for (const r of rows) {
      assert.equal(r.porte_ecriture, false, `${r.code} : comptabilisable ferait compter deux fois`);
      assert.equal(r.transmissible, true, `${r.code} : le comptable doit le recevoir`);
    }
  });
});

describe("la date de transmission d'une pièce", { skip: !BASE_CONFIGUREE }, () => {
  let pool: pg.Pool;

  before(() => {
    pool = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
  });
  after(async () => {
    await pool.end();
  });

  it("la colonne existe, et elle est nulle par défaut", async () => {
    const { rows } = await pool.query<{ is_nullable: string; column_default: string | null }>(
      `select is_nullable, column_default from information_schema.columns
        where table_schema = 'capture' and table_name = 'pieces'
          and column_name = 'transmise_le'`,
    );
    assert.equal(rows.length, 1, "sans elle, aucune TVA ne peut être rangée au mois de l'envoi");
    assert.equal(rows[0]!.is_nullable, "YES", "une pièce gardée chez soi n'a pas de date d'envoi");
    assert.equal(
      rows[0]!.column_default,
      null,
      "un défaut daté donnerait une date d'envoi à des pièces jamais envoyées",
    );
  });

  it("le drapeau et la date changent ensemble, par la même porte", async () => {
    /*
     * `capture_piece_set_vis` est la SEULE porte par laquelle `vis` bouge.
     *
     * Le 11 octobre, en recopiant son corps pour y poser la date, je l'ai
     * réécrite SOUS UN AUTRE NOM : le dépôt a porté deux portes, et
     * l'application passait par celle que je n'avais pas corrigée. Aucune
     * transmission ne se datait plus.
     *
     * Cette épreuve nomme donc la fonction RÉELLE, et la suivante vérifie
     * qu'il n'y en a pas d'autre.
     */
    const { rows } = await pool.query<{ src: string }>(
      `select prosrc as src from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'capture_piece_set_vis'`,
    );
    assert.equal(rows.length, 1);
    assert.match(rows[0]!.src, /transmise_le = case when p_vis = 'partage'/);
    assert.match(rows[0]!.src, /else null end/, "un rappel doit effacer la date");
  });

  it("et il n'existe qu'UNE porte : un doublon est une divergence programmée", async () => {
    const { rows } = await pool.query<{ proname: string }>(
      `select p.proname from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.prosrc like '%transmise_le = case when p_vis%'
        order by p.proname`,
    );
    assert.deepEqual(
      rows.map((r) => r.proname),
      ["capture_piece_set_vis"],
      "deux fonctions qui posent la date divergeront : la prochaine correction ira dans celle qu'on aura sous les yeux",
    );
  });

  it("les paiements sont append-only : un fait ne se réécrit pas (R7)", async () => {
    const { rows } = await pool.query<{ n: number }>(
      `select count(*)::int as n from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'capture' and c.relname = 'paiements' and not t.tgisinternal`,
    );
    assert.ok(rows[0]!.n > 0, "sans déclencheur, une correction écraserait le fait d'origine");
  });

  it("un paiement daté sans montant est refusé, et réciproquement", async () => {
    const { rows } = await pool.query<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint
        where conname = 'paiements_date_et_montant_ensemble'`,
    );
    assert.equal(
      rows.length,
      1,
      "un paiement à moitié saisi est un paiement qu'on ne peut pas lire",
    );
    assert.match(rows[0]!.def, /paye_le IS NULL\) = \(montant_mineur IS NULL/);
  });
});
