/**
 * Une personne des deux côtés tranche la demande qui l'attend.
 *
 * Recette du 2 novembre 2026 : le dirigeant d'une société qui est aussi
 * l'expert de son cabinet mandaté se voyait refuser une demande faite au
 * cabinet (« réservée au cabinet mandaté ») : `piece_repondre` ne regardait
 * que l'étape du propriétaire dès qu'il était membre de la société.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/une-personne-des-deux-cotes-tranche-ce-qui-l-attend.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentiteDuServeur } from "./db.ts";
import { identite } from "./depots/identite.ts";
import { lireLaPieceDEssai } from "./lecture-d-essai.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";
import { executerRpc } from "./rpc.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

describe("une personne des deux côtés tranche ce qui l'attend", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `deux-cotes-${Date.now()}`;
  const legalId = matriculeDEssai();
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
  /** Dirigeant de la société ET expert du cabinet mandaté. */
  let wissem: Utilisateur;
  /** Dirigeant de la société seulement. */
  let associe: Utilisateur;
  let pme = "";
  let cabinet = "";

  const fait = (u: Utilisateur, methode: string, ...args: unknown[]) => {
    const [depot, nom] = methode.split(".") as [string, string];
    return sousIdentiteDuServeur(u.id, (db) => executerRpc(db, { depot, methode: nom, args }));
  };

  let n = 0;
  /** Une pièce lue, transmise au cabinet. */
  const transmise = async () => {
    n += 1;
    const { rows } = await admin.query<{ id: string }>(
      `insert into capture.pieces (tenant_id, source, vis, storage_path, idempotency_key, created_by,
                                   transmise_le)
       values ($1, 'pdf', 'partage', $2, $3, $4, now())
       returning id`,
      [pme, `essai/${marque}-${n}.pdf`, `${marque}-${n}`, wissem.id],
    );
    const id = rows[0]!.id;
    await sousIdentiteDuServeur(wissem.id, (db) => lireLaPieceDEssai(db, id));
    return id;
  };
  const dernierFait = async (id: string, etape: string) =>
    (
      await admin.query<{ fait: string }>(
        `select fait from collab.demandes_sur_piece
          where piece_id = $1 and etape = $2 order by created_at desc limit 1`,
        [id, etape],
      )
    ).rows[0]?.fait ?? null;

  before(async () => {
    wissem = (await creerCompte(`w-${marque}@essai.local`, "MotDePasseTresLong2026!"))!;
    associe = (await creerCompte(`a-${marque}@essai.local`, "MotDePasseTresLong2026!"))!;
    assert.ok(wissem && associe);
    // Les organisations, les rôles et la licence posés par l'administrateur,
    // comme `la-coque-n-invite-que-sur-une-place-incluse` : une licence Team
    // pour que l'associé ait sa place.
    const org = async (kind: string, nom: string, mf: string | null) =>
      (
        await admin.query<{ id: string }>(
          `insert into identity.organizations (kind, name, legal_id, jurisdiction, currency)
           values ($1, $2, $3, 'TN', 'TND') returning id`,
          [kind, nom, mf],
        )
      ).rows[0]!.id;
    pme = await org("pme", `PME ${marque}`, legalId);
    cabinet = await org("cabinet", `CABINET ${marque}`, null);
    for (const [t, u, r] of [
      [pme, wissem.id, "dirigeant"],
      [pme, associe.id, "dirigeant"],
      [cabinet, wissem.id, "expert"],
    ] as const)
      await admin.query(
        "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, $3)",
        [t, u, r],
      );
    const licence = (
      await admin.query<{ id: string }>(
        `insert into facturation.licences (titulaire, offre_code, offre_depuis)
         values ($1, 'team', current_date) returning id`,
        [wissem.id],
      )
    ).rows[0]!.id;
    await admin.query(
      "insert into facturation.licence_organisations (licence_id, tenant_id) values ($1, $2)",
      [licence, pme],
    );
    await sousIdentiteDuServeur(wissem.id, (db) => identite.proposerMandat(db, cabinet, legalId));
    const [propose] = await sousIdentiteDuServeur(wissem.id, (db) =>
      identite.mandatsProposes(db, pme),
    );
    await sousIdentiteDuServeur(wissem.id, (db) =>
      identite.repondreAuMandat(db, propose!.id, true),
    );
  });

  after(async () => {
    try {
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = any($1::uuid[]) and archived_at is null`,
        [[pme, cabinet].filter(Boolean)],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  it("la demande faite au cabinet se tranche par celui qui est aussi de la société", async () => {
    const id = await transmise();
    await fait(associe, "collab.demanderSurPiece", id, "suppression");
    assert.equal(await dernierFait(id, "cabinet"), "demandee");
    await fait(wissem, "collab.repondreSurPiece", id, "suppression", false, "On la garde");
    assert.equal(await dernierFait(id, "cabinet"), "refusee");
  });

  it("un dirigeant qui n'est pas du cabinet reste refusé, avec le même motif", async () => {
    const id = await transmise();
    await fait(wissem, "collab.demanderSurPiece", id, "rappel");
    await assert.rejects(
      fait(associe, "collab.repondreSurPiece", id, "rappel", true, null),
      /cabinet_mandate/,
    );
    assert.equal(await dernierFait(id, "cabinet"), "demandee");
  });
});
