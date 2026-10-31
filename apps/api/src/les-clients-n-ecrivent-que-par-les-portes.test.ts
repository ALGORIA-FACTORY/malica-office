/**
 * Les clients n'écrivent que par les portes (lot 6, « verrous en base »).
 *
 * La revue indépendante de #146 a écrit en SQL brut, sous l'identité d'un
 * siège authentifié, ce que les portes du circuit refusent. Chaque épreuve
 * rejoue un de ces contournements ; toutes échouaient avant
 * `20261104130000_seules_les_portes_ecrivent.sql` :
 *   - transmettre en se donnant une source (`source_piece_id`) non envoyée ;
 *   - garder, reprendre une pièce au comptable, défaire une transmission, en
 *     écrivant les colonnes du circuit ;
 *   - demander directement au comptable, par-dessus le propriétaire ;
 *   - signer un fait du journal au nom d'un autre, adresser un avis à
 *     quelqu'un, empoisonner le journal d'un identifiant mal formé ;
 *   - relire, parti de la société, les faits qu'on y a faits ;
 *   - demander « lisible ? » en se disant voir toute la société.
 *
 * Et l'inventaire : chaque droit d'écriture qui reste à un client est dans
 * `verrous/ecritures-des-clients.json`, avec les chemins qui l'exigent. Un
 * droit nouveau, ou plus large, fait échouer la dernière épreuve.
 *
 *   node --experimental-strip-types --test src/les-clients-n-ecrivent-que-par-les-portes.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";

import {
  BASE_CONFIGUREE,
  monterUneSociete,
  type Personne,
  type SocieteDEssai,
} from "./circuit-d-essai.ts";
import { fermerLePool, sousIdentite } from "./db.ts";

interface Droit {
  objet: string;
  privilege: string;
  colonnes?: string[];
  chemins: string[];
}

const INVENTAIRE = JSON.parse(
  readFileSync(new URL("./verrous/ecritures-des-clients.json", import.meta.url), "utf8"),
) as { droits: Droit[] };

/**
 * Les droits d'écriture des clients, tels que la base les porte : par table,
 * ou par colonne quand la table entière n'est pas ouverte.
 */
const DROITS_DES_CLIENTS = `
with t as (
  select table_schema || '.' || table_name as objet, privilege_type as privilege,
         null::text as colonnes, grantee
    from information_schema.role_table_grants
   where grantee in ('authenticated', 'anon', 'PUBLIC')
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
     and table_schema not in ('pg_catalog', 'information_schema')
), c as (
  select cp.table_schema || '.' || cp.table_name as objet, cp.privilege_type as privilege,
         string_agg(cp.column_name, ',' order by cp.column_name) as colonnes, cp.grantee
    from information_schema.column_privileges cp
   where cp.grantee in ('authenticated', 'anon', 'PUBLIC')
     and cp.privilege_type in ('INSERT', 'UPDATE')
     and cp.table_schema not in ('pg_catalog', 'information_schema')
     and not exists (select 1 from t
                      where t.objet = cp.table_schema || '.' || cp.table_name
                        and t.privilege = cp.privilege_type and t.grantee = cp.grantee)
   group by 1, 2, 4
)
select objet, privilege, coalesce(colonnes, '') as colonnes, grantee
  from (select * from t union all select * from c) x
 order by 1, 2`;

const cle = (d: { objet: string; privilege: string; colonnes?: string[] | string }) =>
  `${d.objet} ${d.privilege} ${Array.isArray(d.colonnes) ? d.colonnes.join(",") : (d.colonnes ?? "")}`;

describe("les clients n'écrivent que par les portes", { skip: !BASE_CONFIGUREE }, () => {
  let s: SocieteDEssai;

  before(async () => {
    s = await monterUneSociete(`portes-${Date.now()}`);
  });

  after(async () => {
    try {
      await s?.fermer();
    } finally {
      await fermerLePool();
    }
  });

  /** Du SQL brut, sous l'identité de la personne : ce que la revue a fait. */
  const sql = (qui: Personne, requete: string, valeurs: unknown[] = []) =>
    sousIdentite(s.gens[qui].id, async (db) => (await db.query(requete, valeurs)).rows);
  const refuse = (promesse: Promise<unknown>, motif: RegExp) => assert.rejects(promesse, motif);
  const etat = async (id: string) =>
    (
      await s.admin.query(
        `select vis, status, gardee_le, transmise_le, source_piece_id, created_by
           from capture.pieces where id = $1`,
        [id],
      )
    ).rows[0] as Record<string, unknown>;
  const lue = async (qui: Personne) => {
    const id = await s.deposer(qui, "entite");
    await s.lire(qui, id);
    return id;
  };
  /** Envoyée par le siège au propriétaire, puis par lui au comptable. */
  const chezLeComptable = async () => {
    const id = await lue("sami");
    await s.fait("sami", "collab.envoyer", id);
    await s.fait("amel", "collab.envoyer", id);
    return id;
  };
  const REFUS_DE_DROIT = /permission denied for table pieces/;

  it("un siège ne transmet pas en se donnant une source qu'il n'a pas envoyée", async () => {
    const a = await lue("sami");
    const b = await lue("sami");
    await refuse(
      sql("sami", `update capture.pieces set source_piece_id = $2, vis = 'partage' where id = $1`, [
        b,
        a,
      ]),
      REFUS_DE_DROIT,
    );
    // Par insertion, la même exception ne vaut que pour une source déjà partie.
    await refuse(
      sql(
        "sami",
        `insert into capture.pieces (tenant_id, vis, source, storage_path, idempotency_key,
                                     source_piece_id)
         values ($1, 'partage', 'photo', 'essai/insertion', $2, $3)`,
        [s.pme, `insertion-${Date.now()}`, a],
      ),
      /refus\.envoi\.reserve_au_proprietaire/,
    );
    const apres = await etat(b);
    assert.equal(apres["vis"], "entite");
    assert.equal(apres["source_piece_id"], null);

    // La pièce issue d'une pièce déjà chez le comptable la suit, elle.
    const partie = await chezLeComptable();
    const [issue] = await sql(
      "sami",
      `insert into capture.pieces (tenant_id, vis, source, storage_path, idempotency_key,
                                   source_piece_id)
       values ($1, 'partage', 'photo', 'essai/issue', $2, $3) returning id`,
      [s.pme, `issue-${Date.now()}`, partie],
    );
    assert.ok(issue, "la pièce issue d'une pièce partie la suit chez le comptable");
  });

  it("un siège n'écrit pas les colonnes du circuit : garder, reprendre, défaire un envoi", async () => {
    const id = await lue("sami");
    await refuse(
      sql("sami", `update capture.pieces set gardee_le = now() where id = $1`, [id]),
      REFUS_DE_DROIT,
    );
    const partie = await chezLeComptable();
    await refuse(
      sql("sami", `update capture.pieces set vis = 'entite', transmise_le = null where id = $1`, [
        partie,
      ]),
      REFUS_DE_DROIT,
    );
    // Le propriétaire non plus : « Garder » et « Reprendre » ont leurs portes.
    await refuse(
      sql("amel", `update capture.pieces set vis = 'entite' where id = $1`, [partie]),
      REFUS_DE_DROIT,
    );
    // Ni le chemin du fichier : il se calcule de la pièce, par sa porte.
    await refuse(
      sql("sami", `update pieces_v set storage_path = 'autre/fichier' where id = $1`, [id]),
      /permission denied for view pieces_v/,
    );
    assert.equal((await etat(id))["gardee_le"], null);
    assert.equal((await etat(partie))["vis"], "partage");
  });

  it("l'origine d'une pièce ne se réécrit pas, même hors des droits par colonne", async () => {
    const id = await lue("sami");
    await assert.rejects(
      s.admin.query(`update capture.pieces set tenant_id = $2 where id = $1`, [id, s.cabinet]),
      /refus\.piece\.origine_immuable/,
    );
  });

  it("un siège ne demande pas au comptable par-dessus le propriétaire", async () => {
    const partie = await chezLeComptable();
    await s.priseEnCharge(partie);
    await refuse(
      sql(
        "sami",
        `insert into collab.demandes_sur_piece (tenant_id, piece_id, objet, fait, auteur, etape)
         values ($1, $2, 'suppression', 'demandee', auth.uid(), 'cabinet')`,
        [s.pme, partie],
      ),
      /permission denied for table demandes_sur_piece/,
    );
    await assert.rejects(
      s.fait("expert", "collab.repondreSurPiece", partie, "suppression", true, null),
      /aucune demande en attente/,
    );
    const { rows } = await s.admin.query(`select archivee_le from capture.pieces where id = $1`, [
      partie,
    ]);
    assert.equal(rows[0]?.archivee_le, null);
  });

  it("un fait se signe de son auteur ; un avis adressé passe par une porte", async () => {
    const id = await lue("sami");
    await refuse(
      sql(
        "sonia",
        `insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                                      object_id, payload)
         values ($1, $2, 'piece.retournee_au_siege', 'capture', 'pieces', $3, '{"note":"x"}')`,
        [s.pme, s.gens.amel.id, id],
      ),
      /row-level security/,
    );
    await refuse(
      sql("sonia", `update audit.event_log set payload = '{}' where tenant_id = $1`, [s.pme]),
      /permission denied for table event_log/,
    );
    await refuse(
      sql(
        "sonia",
        `insert into collab.notifications (tenant_id, user_id, kind, payload)
         values ($1, $2, 'piece.retournee_par_le_proprietaire', jsonb_build_object('piece_id', $3::text))`,
        [s.pme, s.gens.sami.id, id],
      ),
      /row-level security/,
    );
  });

  it("un identifiant mal formé ne s'écrit pas, et une ligne qui en porte ne fait rien tomber", async () => {
    const POISON = "-".repeat(36);
    // À l'écriture : refusé, au journal comme dans les avis.
    await refuse(
      sql(
        "sonia",
        `insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, payload)
         values ($1, auth.uid(), 'essai.poison', 'essai', 'essai', jsonb_build_object('piece_id', $2::text))`,
        [s.pme, POISON],
      ),
      /row-level security/,
    );
    await refuse(
      sql(
        "sonia",
        `insert into collab.notifications (tenant_id, kind, payload)
         values ($1, 'piece.renvoyee', jsonb_build_object('piece_id', $2::text))`,
        [s.pme, POISON],
      ),
      /row-level security/,
    );

    // Une ligne déjà là (écrite avant la garde) : chacun lit encore tout.
    await s.admin.query(
      `insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, payload)
       values ($1, $2, 'essai.poison', 'essai', 'essai', jsonb_build_object('piece_id', $3::text))`,
      [s.pme, s.gens.sonia.id, POISON],
    );
    await s.admin.query(
      `insert into collab.notifications (tenant_id, kind, payload)
       values ($1, 'piece.renvoyee', jsonb_build_object('piece_id', $2::text))`,
      [s.pme, POISON],
    );
    for (const qui of ["amel", "sami", "expert"] as const) {
      await sql(qui, `select count(*) from event_log_v where tenant_id = $1`, [s.pme]);
      await sql(qui, `select count(*) from collab.notifications where tenant_id = $1`, [s.pme]);
    }
    await s.fait("amel", "supervision.journalDuMandat", s.pme, 5);
  });

  it("parti de la société, un siège ne relit que les faits de son Mon espace", async () => {
    const privee = await s.deposer("bilel", "personnel");
    const societe = await lue("bilel");
    await s.admin.query(`delete from identity.memberships where tenant_id = $1 and user_id = $2`, [
      s.pme,
      s.gens.bilel.id,
    ]);
    const compte = async (objet: string) =>
      (
        (await sql("bilel", `select count(*)::int as n from event_log_v where object_id = $1`, [
          objet,
        ])) as Array<{ n: number }>
      )[0]!.n;
    assert.equal(await compte(societe), 0, "les faits de la société restent à la société");
    assert.ok((await compte(privee)) > 0, "ceux de son Mon espace restent à lui");
  });

  it("« voit toute la société » se juge en base, pas sur la parole de l'appelant", async () => {
    const sienne = await lue("amel");
    await refuse(
      sql("sami", `select app.evenement_lisible_du_membre(true, 'capture', 'pieces', $1, '{}')`, [
        sienne,
      ]),
      /does not exist/,
    );
    const [r] = await sql(
      "sami",
      `select app.evenement_lisible_du_membre($1, 'capture', 'pieces', $2, '{}') as lisible`,
      [s.pme, sienne],
    );
    assert.equal((r as { lisible: boolean }).lisible, false);
  });

  it("deux statuts morts sont retirés, et leur porte avec eux", async () => {
    const id = await lue("sami");
    for (const statut of ["confirmee", "a_revalider"])
      await assert.rejects(
        s.admin.query(`update capture.pieces set status = $2 where id = $1`, [id, statut]),
        /pieces_status_check/,
      );
    const { rows } = await s.admin.query(
      `select count(*)::int as n from pg_proc where proname = 'piece_corriger_apres_transmission'`,
    );
    assert.equal(rows[0]?.n, 0);
  });

  it("chaque droit d'écriture d'un client est inventorié, avec les chemins qui l'exigent", async () => {
    const { rows } = await s.admin.query<{
      objet: string;
      privilege: string;
      colonnes: string;
      grantee: string;
    }>(DROITS_DES_CLIENTS);
    assert.deepEqual(
      rows.filter((r) => r.grantee !== "authenticated").map(cle),
      [],
      "ni anon ni public n'écrivent",
    );
    const enBase = rows.map(cle).sort();
    const inventaire = INVENTAIRE.droits.map(cle).sort();
    assert.deepEqual(
      enBase.filter((d) => !inventaire.includes(d)),
      [],
      "un droit nouveau ou plus large doit être justifié dans verrous/ecritures-des-clients.json",
    );
    assert.deepEqual(
      inventaire.filter((d) => !enBase.includes(d)),
      [],
      "un droit retiré sort de l'inventaire",
    );
    for (const d of INVENTAIRE.droits) assert.ok(d.chemins.length > 0, `${cle(d)} : sans chemin`);

    // Chaque table qu'un client écrit est sous RLS.
    const tables = [...new Set(INVENTAIRE.droits.map((d) => d.objet))];
    const { rows: sansRls } = await s.admin.query<{ objet: string }>(
      `select n.nspname || '.' || c.relname as objet
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname || '.' || c.relname = any($1) and c.relkind = 'r' and not c.relrowsecurity`,
      [tables],
    );
    assert.deepEqual(sansRls, []);
  });
});
