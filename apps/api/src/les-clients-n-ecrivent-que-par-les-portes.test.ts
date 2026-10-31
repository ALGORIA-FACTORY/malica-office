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
 * La fin du lot (`20261105100000_toute_ecriture_passe_par_une_porte.sql`)
 * retire les 108 droits qui restaient : plus aucun client n'écrit une table
 * ni une vue. Les portes reprises de ses chemins appartiennent au `portier`,
 * qui s'exécute sous les politiques de son appelant. Le second bloc
 * d'épreuves le prouve famille par famille, pour cinq personnes ; toutes ses
 * épreuves échouaient avant.
 *
 * Et l'inventaire : `verrous/ecritures-des-clients.json` dit les droits
 * d'écriture des clients (aucun) et ceux du portier, avec les portes qui les
 * exercent. Un droit nouveau, plus large, ou que plus aucune porte n'exerce
 * fait échouer l'épreuve de l'instantané.
 *
 *   node --experimental-strip-types --test src/les-clients-n-ecrivent-que-par-les-portes.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";

import { creerCompte } from "./auth.ts";
import {
  BASE_CONFIGUREE,
  monterUneSociete,
  type Personne,
  type SocieteDEssai,
} from "./circuit-d-essai.ts";
import { fermerLePool, sousIdentite, sousIdentiteDuServeur } from "./db.ts";

interface Droit {
  objet: string;
  privilege: string;
  colonnes?: string[];
  chemins: string[];
}

const INVENTAIRE = JSON.parse(
  readFileSync(new URL("./verrous/ecritures-des-clients.json", import.meta.url), "utf8"),
) as { droits: Droit[]; portes: Droit[] };

/**
 * Les droits d'écriture du portier, par table ou par colonne, et les portes
 * qui les exercent : celles qu'il possède et dont le corps écrit la table
 * (une insertion qui se replie en mise à jour exerce le droit de mise à jour).
 */
const DROITS_DU_PORTIER = `
with t as (
  select table_schema || '.' || table_name as objet, privilege_type as privilege,
         null::text as colonnes
    from information_schema.role_table_grants
   where grantee = 'portier' and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
), c as (
  select cp.table_schema || '.' || cp.table_name as objet, cp.privilege_type as privilege,
         string_agg(cp.column_name, ',' order by cp.column_name) as colonnes
    from information_schema.column_privileges cp
   where cp.grantee = 'portier' and cp.privilege_type in ('INSERT', 'UPDATE')
     and not exists (select 1 from t where t.objet = cp.table_schema || '.' || cp.table_name
                                       and t.privilege = cp.privilege_type)
   group by 1, 2
), g as (select * from t union all select * from c),
f as (
  select n.nspname || '.' || p.proname as fn, p.prosrc
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.proowner = 'portier'::regrole
)
select g.objet, g.privilege, g.colonnes,
       coalesce((select array_agg(distinct f.fn order by f.fn) from f
          where f.prosrc ~* (case g.privilege
                 when 'INSERT' then 'insert\\s+into\\s+' || replace(g.objet, '.', '\\.') || '\\M'
                 when 'UPDATE' then '(update\\s+' || replace(g.objet, '.', '\\.')
                                    || '\\M|insert\\s+into\\s+' || replace(g.objet, '.', '\\.')
                                    || '\\M[^;]*on\\s+conflict[^;]*do\\s+update)'
                 else 'delete\\s+from\\s+' || replace(g.objet, '.', '\\.') || '\\M' end)),
                '{}') as chemins
  from g order by g.objet, g.privilege`;

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

  // Le pool de l'API sert encore au bloc suivant, qui le ferme.
  after(async () => {
    await s?.fermer();
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
    // Une pièce ne s'insère plus en SQL brut (lot 6, fin) : par sa porte seulement.
    await refuse(
      sql(
        "sami",
        `insert into capture.pieces (tenant_id, vis, source, storage_path, idempotency_key,
                                     source_piece_id)
         values ($1, 'partage', 'photo', 'essai/insertion', $2, $3)`,
        [s.pme, `insertion-${Date.now()}`, a],
      ),
      REFUS_DE_DROIT,
    );
    // Par la porte, déclarée partagée sans source partie : le siège ne transmet pas.
    await refuse(
      sql(
        "sami",
        `select public.capture_piece_register($1, 'photo', 'essai/insertion', $2, null,
                                              'partage'::app.vis_t)`,
        [s.pme, `insertion-${Date.now()}`],
      ),
      /refus\.envoi\.reserve_au_proprietaire/,
    );
    const apres = await etat(b);
    assert.equal(apres["vis"], "entite");
    assert.equal(apres["source_piece_id"], null);

    // La pièce issue d'une pièce déjà chez le comptable la suit, elle.
    const partie = await chezLeComptable();
    const [issue] = (await sql(
      "sami",
      `select public.capture_piece_register($1, 'photo', 'essai/issue', $2, null,
                                            'partage'::app.vis_t, null, null, null, $3) as id`,
      [s.pme, `issue-${Date.now()}`, partie],
    )) as Array<{ id: string }>;
    assert.ok(issue?.id, "la pièce issue d'une pièce partie la suit chez le comptable");
    assert.equal((await etat(issue.id))["vis"], "partage");
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

  it("un fait ne s'écrit que par une porte, pas même signé de soi ; un avis non plus", async () => {
    const id = await lue("sami");
    for (const acteur of [s.gens.amel.id, s.gens.sonia.id])
      await refuse(
        sql(
          "sonia",
          `insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                                        object_id, payload)
           values ($1, $2, 'piece.retournee_au_siege', 'capture', 'pieces', $3, '{"note":"x"}')`,
          [s.pme, acteur, id],
        ),
        /permission denied for table event_log/,
      );
    await refuse(
      sql("sonia", `update audit.event_log set payload = '{}' where tenant_id = $1`, [s.pme]),
      /permission denied for table event_log/,
    );
    for (const destinataire of [s.gens.sami.id, null])
      await refuse(
        sql(
          "sonia",
          `insert into collab.notifications (tenant_id, user_id, kind, payload)
           values ($1, $2, 'piece.renvoyee', jsonb_build_object('piece_id', $3::text))`,
          [s.pme, destinataire, id],
        ),
        /permission denied for table notifications/,
      );
  });

  it("la porte des faits ne connaît que son référentiel, et le cabinet qui supervise", async () => {
    const id = await chezLeComptable();
    const ecriture = await s.priseEnCharge(id);
    const consigner = (qui: Personne, action: string, objet: string, contenu: unknown) =>
      sql(qui, `select public.fait_consigner($1, $2, $3::jsonb) as id`, [
        action,
        objet,
        JSON.stringify(contenu),
      ]);
    // Une nature hors du référentiel : refusée, même au cabinet.
    await refuse(consigner("expert", "piece.validee", ecriture, {}), /refus\.saisie\.mal_formee/);
    // Un objet qu'on ne voit pas n'existe pas : une pièce n'est pas une écriture.
    await refuse(
      consigner("expert", "piece.retour_clos", ecriture, {}),
      /objet introuvable ou non autorise/,
    );
    // Dossier en mandat : clore un retour est l'acte du cabinet qui le tient,
    // pas de la société, qui pourtant lit la pièce.
    await s.admin.query(
      `update identity.organizations set validation_mode = 'mandate' where id = $1`,
      [s.pme],
    );
    try {
      await refuse(consigner("amel", "piece.retour_clos", id, {}), /refus\.geste\.non_permis/);
    } finally {
      await s.admin.query(
        `update identity.organizations set validation_mode = 'autonome' where id = $1`,
        [s.pme],
      );
    }
    const [fait] = (await consigner("expert", "ecriture.forcee", ecriture, {
      piece_id: id,
    })) as Array<{ id: string }>;
    const { rows } = await s.admin.query(
      `select tenant_id, actor, object_schema, object_table, pack_version_id
         from audit.event_log where id = $1`,
      [fait!.id],
    );
    // Le dossier vient de l'objet, l'acteur de la session : jamais de l'appelant.
    assert.deepEqual(rows[0], {
      tenant_id: s.pme,
      actor: s.gens.expert.id,
      object_schema: "socle",
      object_table: "ecritures",
      pack_version_id: s.pack,
    });
  });

  it("un identifiant mal formé ne s'écrit pas, et une ligne qui en porte ne fait rien tomber", async () => {
    const POISON = "-".repeat(36);
    // À l'écriture : le client n'écrit plus rien ; et même une porte, qui
    // écrit sous les politiques de son appelant, est refusée par elles.
    await refuse(
      sql(
        "sonia",
        `insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, payload)
         values ($1, auth.uid(), 'essai.poison', 'essai', 'essai', jsonb_build_object('piece_id', $2::text))`,
        [s.pme, POISON],
      ),
      /permission denied for table event_log/,
    );
    const ecriture = await s.priseEnCharge(await chezLeComptable());
    await refuse(
      sql("expert", `select public.fait_consigner('ecriture.forcee', $1, $2::jsonb)`, [
        ecriture,
        JSON.stringify({ piece_id: POISON }),
      ]),
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

  it("aucun client n'écrit ; le portier ne porte que ce que ses portes exercent", async () => {
    const { rows } = await s.admin.query<{
      objet: string;
      privilege: string;
      colonnes: string;
      grantee: string;
    }>(DROITS_DES_CLIENTS);
    assert.deepEqual(
      rows.map(cle),
      INVENTAIRE.droits.map(cle),
      "un droit d'écriture d'un client : il passe par une porte, ou se justifie dans verrous/ecritures-des-clients.json",
    );
    assert.deepEqual(INVENTAIRE.droits, [], "plus aucun client n'écrit directement");

    // Les droits du portier, et les portes qui les exercent : l'instantané.
    const { rows: portes } = await s.admin.query<{
      objet: string;
      privilege: string;
      colonnes: string | null;
      chemins: string[];
    }>(DROITS_DU_PORTIER);
    // Trié ici : l'ordre de la base suit sa collation, celui du fichier non.
    const parCle = (a: Droit, b: Droit) => (cle(a) < cle(b) ? -1 : cle(a) > cle(b) ? 1 : 0);
    assert.deepEqual(
      portes
        .map((p) => ({
          objet: p.objet,
          privilege: p.privilege,
          ...(p.colonnes ? { colonnes: p.colonnes.split(",") } : {}),
          chemins: [...p.chemins].sort(),
        }))
        .sort(parCle),
      INVENTAIRE.portes.map((p) => ({ ...p, chemins: [...p.chemins].sort() })).sort(parCle),
      "un droit du portier nouveau, plus large, ou exercé par d'autres portes : l'inventaire le dit",
    );
    for (const p of INVENTAIRE.portes) assert.ok(p.chemins.length > 0, `${cle(p)} : aucune porte`);

    // Chaque table que le portier écrit est sous RLS : ses portes s'y plient.
    const tables = [...new Set(INVENTAIRE.portes.map((d) => d.objet))];
    const { rows: sansRls } = await s.admin.query<{ objet: string }>(
      `select n.nspname || '.' || c.relname as objet
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname || '.' || c.relname = any($1) and not (c.relkind = 'r' and c.relrowsecurity)`,
      [tables],
    );
    assert.deepEqual(sansRls, []);
  });

  it("le portier n'est qu'un membre d'authenticated, que personne n'endosse", async () => {
    const { rows } = await s.admin.query(
      `select r.rolsuper, r.rolbypassrls, r.rolcanlogin, r.rolinherit,
              pg_has_role('portier', 'authenticated', 'member') as membre,
              (select count(*)::int from pg_auth_members m where m.roleid = r.oid) as endosse_par,
              (select count(*)::int from pg_class c where c.relowner = r.oid) as possede
         from pg_roles r where r.rolname = 'portier'`,
    );
    assert.deepEqual(rows[0], {
      rolsuper: false,
      rolbypassrls: false,
      rolcanlogin: false,
      rolinherit: true,
      membre: true,
      endosse_par: 0,
      possede: 0,
    });
    // Ses fonctions sont des portes, au chemin de recherche vide.
    const { rows: portes } = await s.admin.query<{ f: string }>(
      `select p.oid::regprocedure::text as f from pg_proc p
        where p.proowner = 'portier'::regrole
          and not (p.prosecdef and 'search_path=""' = any(coalesce(p.proconfig, '{}')))`,
    );
    assert.deepEqual(portes, []);
    // Et plus aucune fonction en `security invoker` qu'un client appelle n'écrit.
    const { rows: invocateurs } = await s.admin.query<{ f: string }>(
      `select p.oid::regprocedure::text as f
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where not p.prosecdef
          and n.nspname not in ('pg_catalog', 'information_schema', 'extensions', 'auth', 'storage')
          and (has_function_privilege('authenticated', p.oid, 'execute')
               or p.prorettype = 'trigger'::regtype)
          and p.prosrc ~* '(insert\\s+into|update\\s+[a-z_]+\\.[a-z_]+\\s+(as\\s+\\w+\\s+)?set|delete\\s+from)\\s'`,
    );
    assert.deepEqual(invocateurs, []);
  });
});

/**
 * Le contournement, famille par famille : du SQL brut, sous l'identité d'un
 * membre de la PME (le propriétaire), d'un siège, de l'expert engagé, d'un
 * collaborateur du cabinet sans ce dossier, et de l'expert d'un cabinet
 * étranger. Toute écriture directe est refusée par les droits — avant toute
 * politique, avant tout déclencheur : il n'y a plus de chemin à garder.
 *
 * Avant `20261105100000`, le propriétaire inscrivait une ligne d'écriture,
 * un fait signé de lui, un statut de pièce, une ligne de relevé, un
 * mouvement de stock, un tiers, une analyse ou une recette.
 */
describe("aucune écriture directe, famille par famille", { skip: !BASE_CONFIGUREE }, () => {
  let s: SocieteDEssai;
  let piece: string;
  let ecriture: string;
  const intrus: Record<"collaborateur" | "etranger", string> = { collaborateur: "", etranger: "" };
  let cabinetEtranger: string;

  before(async () => {
    const marque = `familles-${Date.now()}`;
    s = await monterUneSociete(marque);
    for (const qui of ["collaborateur", "etranger"] as const) {
      const u = await creerCompte(`${marque}-${qui}@essai.local`, "MotDePasseTresLong2026!");
      assert.ok(u, qui);
      intrus[qui] = u.id;
    }
    // Un collaborateur du cabinet engagé, à qui le dossier n'est pas affecté.
    await s.admin.query(
      `insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'collaborateur')`,
      [s.cabinet, intrus.collaborateur],
    );
    // L'expert d'un autre cabinet.
    cabinetEtranger = await sousIdentiteDuServeur(intrus.etranger, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('cabinet', $1, 'autonome', null, 'TN', 'TND') as id`,
        [`COMPTA ETRANGER ${marque}`],
      );
      return rows[0]!.id;
    });
    piece = await s.deposer("sami", "entite");
    await s.lire("sami", piece);
    await s.fait("sami", "collab.envoyer", piece);
    await s.fait("amel", "collab.envoyer", piece);
    ecriture = await s.priseEnCharge(piece);
  });

  after(async () => {
    try {
      await s?.admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = $1 and archived_at is null`,
        [cabinetEtranger],
      );
      await s?.fermer();
    } finally {
      await fermerLePool();
    }
  });

  const personnes = () => ({
    "le propriétaire": s.gens.amel.id,
    "un siège": s.gens.sami.id,
    "l'expert engagé": s.gens.expert.id,
    "un collaborateur sans le dossier": intrus.collaborateur,
    "un cabinet étranger": intrus.etranger,
  });

  /** Chaque écriture directe d'une famille, pour chaque personne : refusée par les droits. */
  const toutEstRefuse = async (familles: Array<[string, unknown[]]>) => {
    const passes: string[] = [];
    for (const [qui, id] of Object.entries(personnes()))
      for (const [requete, valeurs] of familles)
        await sousIdentite(id, (db) => db.query(requete, valeurs)).then(
          () => passes.push(`${qui} : ${requete}`),
          (e: Error) => {
            if (!/^permission denied for (table|view) /.test(e.message))
              passes.push(`${qui} : ${requete} → ${e.message}`);
          },
        );
    assert.deepEqual(passes, [], "une écriture directe a échappé aux droits");
  };

  /** Insérer, modifier, effacer : la forme la plus nue, sur une ligne du dossier. */
  const nues = (...tables: string[]): Array<[string, unknown[]]> =>
    tables.flatMap((t) => [
      [`insert into ${t} (tenant_id) values ($1)`, [s.pme]],
      [`update ${t} set tenant_id = tenant_id where tenant_id = $1`, [s.pme]],
      [`delete from ${t} where tenant_id = $1`, [s.pme]],
    ]);

  it("les écritures et leurs lignes : par book, review, contre-passer seulement", async () => {
    await toutEstRefuse([
      ...nues("socle.ecritures", "socle.ecriture_lignes", "socle.prises_en_charge"),
      [
        `insert into socle.ecriture_lignes (tenant_id, ecriture_id, ordinal, account_code, libelle,
                                            debit, credit)
         values ($1, $2, 99, '601', 'ligne glissée', 1000, 0)`,
        [s.pme, ecriture],
      ],
      [
        `update socle.ecritures set status = 'proposee', libelle = 'réécrite' where id = $1`,
        [ecriture],
      ],
      [`delete from socle.ecritures where id = $1`, [ecriture]],
    ]);
  });

  it("le journal d'audit et l'état d'une pièce : par leurs portes seulement", async () => {
    await toutEstRefuse([
      ...nues(
        "audit.event_log",
        "capture.pieces",
        "capture.analyses",
        "capture.analyses_verifiees",
        "capture.extractions",
        "capture.paiements",
        "collab.notifications",
      ),
      [
        `insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id)
         values ($1, auth.uid(), 'ecriture.forcee', 'socle', 'ecritures', $2)`,
        [s.pme, ecriture],
      ],
      [`update capture.pieces set status = 'supervisee' where id = $1`, [piece]],
      [`update capture.pieces set status = 'lue', updated_at = now() where id = $1`, [piece]],
    ]);
  });

  it("la banque : comptes, relevés, lettrages", async () => {
    await toutEstRefuse([
      ...nues(
        "banque.comptes",
        "banque.releve_lignes",
        "banque.lettrages",
        "banque.lettrage_etat",
        "banque.rapprochements",
        "public.banque_comptes_v",
        "public.banque_lignes_v",
      ),
      [`update banque.releve_lignes set status = 'rapprochee' where tenant_id = $1`, [s.pme]],
    ]);
  });

  it("les immobilisations, les stocks, les tiers", async () => {
    await toutEstRefuse(
      nues(
        "immo.assets",
        "immo.cessions",
        "immo.dotations",
        "immo.depreciations",
        "public.immo_assets_v",
        "public.immo_cessions_v",
        "stocks.items",
        "stocks.mouvements",
        "stocks.inventaires",
        "stocks.depreciations",
        "public.stocks_items_v",
        "public.stocks_mouvements_v",
        "tiers.auxiliaires",
        "public.tiers_v",
      ),
    );
  });

  it("la fabrique de recettes", async () => {
    await toutEstRefuse(
      nues(
        "fabrique.recettes",
        "fabrique.recette_versions",
        "fabrique.recette_version_exemples",
        "fabrique.promotions",
        "fabrique.exemples",
        "fabrique.evaluations",
        "fabrique.evaluation_exemples",
        "fabrique.derives",
        "fabrique.executions",
        "fabrique.travaux",
        "fabrique.travail_faits",
      ),
    );
  });

  it("l'identité, le paramétrage, les conversations", async () => {
    await toutEstRefuse(
      nues(
        "identity.entities",
        "identity.fiches_fiscales",
        "identity.api_keys",
        "identity.invitations",
        "parametrage.accounts",
        "parametrage.role_bindings",
        "agents.conversations",
        "agents.reponse_controles",
        "agents.reponse_verdicts",
        "agents.agent_runs",
        "collab.exports",
      ).concat([
        // ANO-001 : un collaborateur s'affectait le dossier qu'il voulait.
        [
          `insert into collab.assignments (cabinet_tenant_id, client_tenant_id, collaborator_id)
           values ($1, $2, auth.uid())`,
          [s.cabinet, s.pme],
        ],
      ]),
    );
  });

  it("les portes refusent ce qu'elles ne trouvent pas, au lieu de se taire", async () => {
    const inconnu = "00000000-0000-4000-8000-000000000000";
    const essai = (requete: string, valeurs: unknown[]) =>
      sousIdentite(s.gens.amel.id, (db) => db.query(requete, valeurs));
    await assert.rejects(
      essai(`select public.tiers_activer($1, false)`, [inconnu]),
      /tiers introuvable ou non autorise/,
    );
    await assert.rejects(
      essai(
        `select public.stocks_mouvement_inscrire($1, $2, 'entree', current_date, 1, 1, null, null)`,
        [s.pme, inconnu],
      ),
      /article introuvable ou non autorise/,
    );
    // « Rapprochée », c'est le lettrage qui le dit, pas un clic.
    await assert.rejects(
      essai(`select public.banque_ligne_classer($1, 'rapprochee')`, [inconnu]),
      /refus\.banque\.statut_par_le_lettrage/,
    );
    // Une analyse se pose sur la lecture de SA pièce.
    const autre = await s.deposer("amel", "entite");
    await assert.rejects(
      essai(
        `select public.analyse_poser($1, (select id from capture.extractions where piece_id = $2),
                                     $3, '{}', '[{}]', 'à rejeter', '[{}]', null, null, null, null)`,
        [autre, piece, s.pack],
      ),
      /refus\.saisie\.mal_formee/,
    );
  });
});
