/**
 * Une société d'essai pour éprouver le circuit siège → propriétaire →
 * comptable (« Malica sans blocage », lot 4) : deux propriétaires, deux
 * sièges, un cabinet engagé. Tout passe par les vraies portes, sous
 * l'identité de chacun (`executerRpc`) : l'API ne filtre rien, la base décide.
 *
 * Les noms sont fictifs, les comptes `@essai.local`, le matricule d'essai.
 */
import assert from "node:assert/strict";

import pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { sousIdentiteDuServeur } from "./db.ts";
import { identite } from "./depots/identite.ts";
import { lireLaPieceDEssai } from "./lecture-d-essai.ts";
import { office } from "./depots/office.ts";
import { supervision } from "./depots/supervision.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";
import { executerRpc } from "./rpc.ts";

export const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

export type Personne = "amel" | "bilel" | "sami" | "sonia" | "expert";

/** Le rôle d'adhésion de chacun ; les droits, eux, viennent du référentiel. */
const ROLES: Readonly<Record<Exclude<Personne, "amel" | "expert">, string>> = {
  bilel: "dirigeant",
  sami: "collaborateur",
  sonia: "collaborateur",
};

const PRENOMS: Readonly<Record<Personne, string>> = {
  amel: "Amel",
  bilel: "Bilel",
  sami: "Sami",
  sonia: "Sonia",
  expert: "Kamel",
};

export interface SocieteDEssai {
  pme: string;
  cabinet: string;
  nomDuCabinet: string;
  pack: string;
  motifs: Record<string, string>;
  gens: Record<Personne, Utilisateur>;
  admin: pg.Pool;
  /** Un appel RPC, tel que le navigateur le ferait, sous l'identité de `qui`. */
  fait: (qui: Personne, methode: string, ...args: unknown[]) => Promise<unknown>;
  /** Une photo déposée par `qui`, là où il la range. */
  deposer: (qui: Personne, vis: "personnel" | "entite") => Promise<string>;
  /** Une lecture minimale, persistée par la porte du serveur. */
  lire: (qui: Personne, pieceId: string) => Promise<void>;
  /** Le cabinet établit le type, propose et inscrit : « Prise en charge ». */
  priseEnCharge: (pieceId: string) => Promise<string>;
  /** Archive les organisations d'essai et ferme le pool d'administration. */
  fermer: () => Promise<void>;
}

export async function monterUneSociete(marque: string): Promise<SocieteDEssai> {
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
  const gens = {} as Record<Personne, Utilisateur>;
  for (const p of Object.keys(PRENOMS) as Personne[]) {
    const u = await creerCompte(`${marque}-${p}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(u, `compte ${p}`);
    gens[p] = u;
    await sousIdentiteDuServeur(u.id, (db) => identite.ecrireMonProfil(db, PRENOMS[p], "Essai"));
  }

  const legalId = matriculeDEssai();
  const creer = (u: Utilisateur, kind: string, nom: string, mf: string | null) =>
    sousIdentiteDuServeur(u.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization($1, $2, $3, $4, $5, $6) as id`,
        [kind, nom, "autonome", mf, "TN", "TND"],
      );
      return rows[0]!.id;
    });
  const nomDuCabinet = `COMPTA ${marque}`;
  const pme = await creer(gens.amel, "pme", `SOCIETE ${marque}`, legalId);
  const cabinet = await creer(gens.expert, "cabinet", nomDuCabinet, null);

  // L'offre Team ouvre les sièges ; le propriétaire y passe par la vraie porte.
  await sousIdentiteDuServeur(gens.amel.id, (db) =>
    db.query("select public.forfait_changer('team', $1, current_date)", [pme]),
  );
  for (const [p, role] of Object.entries(ROLES) as Array<[Personne, string]>) {
    await admin.query(
      "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, $3)",
      [pme, gens[p].id, role],
    );
  }

  await sousIdentiteDuServeur(gens.expert.id, (db) =>
    identite.proposerMandat(db, cabinet, legalId),
  );
  const [propose] = await sousIdentiteDuServeur(gens.amel.id, (db) =>
    identite.mandatsProposes(db, pme),
  );
  assert.ok(propose, "le mandat proposé");
  await sousIdentiteDuServeur(gens.amel.id, (db) =>
    identite.repondreAuMandat(db, propose.id, true),
  );

  const pack = (
    await admin.query<{ id: string }>(
      `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
        order by effective_from desc limit 1`,
    )
  ).rows[0]!.id;
  const motifs: Record<string, string> = {};
  for (const m of await sousIdentiteDuServeur(gens.expert.id, (db) => supervision.motifs(db, "fr")))
    motifs[m.code] = m.id;

  const fait = (qui: Personne, methode: string, ...args: unknown[]) => {
    const [depot, nom] = methode.split(".") as [string, string];
    return sousIdentiteDuServeur(gens[qui].id, (db) =>
      executerRpc(db, { depot, methode: nom, args }),
    );
  };

  let n = 0;
  const deposer = async (qui: Personne, vis: "personnel" | "entite") => {
    n += 1;
    const p = (await fait(qui, "capture.enregistrer", {
      tenantId: pme,
      source: "photo",
      vis,
      idempotencyKey: `${marque}-${qui}-${n}`,
      contentType: "image/jpeg",
      pageCount: 1,
    })) as { id: string };
    return p.id;
  };

  const lire = async (qui: Personne, pieceId: string) => {
    await sousIdentiteDuServeur(gens[qui].id, (db) => lireLaPieceDEssai(db, pieceId));
  };

  const priseEnCharge = async (pieceId: string) => {
    await sousIdentiteDuServeur(gens.expert.id, (db) =>
      db.query(`select public.piece_type_etabli_par_le_cabinet($1)`, [pieceId]),
    );
    const e = await sousIdentiteDuServeur(gens.expert.id, (db) =>
      office.propose(db, {
        pieceId,
        journal: "ACH",
        date: "2026-10-02",
        libelle: "Facture essai",
        packVersionId: pack,
        devise: "TND",
        lignes: [
          { account_code: "601", libelle: "Achat", debit: "100.000", credit: "0", tax_code: "EXO" },
          {
            account_code: "401",
            libelle: "Fournisseur",
            debit: "0",
            credit: "100.000",
            tax_code: null,
          },
        ],
      }),
    );
    await sousIdentiteDuServeur(gens.expert.id, (db) => office.book(db, e));
    return e;
  };

  const fermer = async () => {
    try {
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = any($1::uuid[]) and archived_at is null`,
        [[pme, cabinet]],
      );
    } finally {
      await admin.end();
    }
  };

  return {
    pme,
    cabinet,
    nomDuCabinet,
    pack,
    motifs,
    gens,
    admin,
    fait,
    deposer,
    lire,
    priseEnCharge,
    fermer,
  };
}
