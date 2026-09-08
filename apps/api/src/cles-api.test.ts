/**
 * Les clés d'API du cabinet, éprouvées par le réseau.
 *
 * Ce qu'elles établissent, contre la vraie base et la vraie application :
 *   — une clé se crée par la RPC, se rend en clair UNE fois, et se liste masquée ;
 *   — sous la clé, les organisations de l'appelant sont exactement le cabinet,
 *     même si la personne qui l'a créée est aussi membre d'une PME ;
 *   — la portée ouvre la méthode qu'elle couvre et ferme les autres (403) ;
 *   — une clé inconnue ou révoquée ne résout plus (401), et une clé révoquée
 *     ne se révoque pas deux fois ni ne s'efface.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, emettreJeton, type Utilisateur } from "./auth.ts";
import { PREFIXE_CLE, resoudreCle } from "./cles-api.ts";
import { fermerLePool, sousCleDuCabinet, sousIdentite } from "./db.ts";
import { executerRpc } from "./rpc.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

/** Un PDF minuscule mais authentique. */
const OCTETS = Buffer.from("%PDF-1.4\nquelques octets\n%%EOF\n", "utf8");

interface CleVue {
  id: string;
  prefixe: string;
  suffixe: string;
  portees: string[];
  revokedAt: string | null;
}

describe("les clés d'API du cabinet", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `cles-${Date.now()}`;
  let racineEssai = "";
  let base = "";
  let arret: (() => Promise<void>) | null = null;

  let personne: Utilisateur;
  let cabinet = "";
  let pme = "";
  let cle = "";
  let cleId = "";

  before(async () => {
    racineEssai = await mkdtemp(path.join(tmpdir(), "malica-cles-"));
    process.env["STOCKAGE_RACINE"] = racineEssai;

    const { app } = await import("./app.ts");
    const serveur = app.listen(0);
    await new Promise((resoudre) => serveur.once("listening", resoudre));
    base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
    arret = () => new Promise<void>((resoudre) => serveur.close(() => resoudre()));

    const compte = await creerCompte(`${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(compte);
    personne = compte;

    // La même personne est membre d'une PME ET d'un cabinet : c'est ce qui
    // rend la preuve de frontière intéressante.
    await sousIdentite(personne.id, async (db) => {
      const org = async (kind: string, nom: string, mode: string) => {
        const { rows } = await db.query<{ id: string }>(
          `select public.create_organization($1, $2, $3, null, $4, $5) as id`,
          [kind, nom, mode, "TN", "TND"],
        );
        return rows[0]!.id;
      };
      pme = await org("pme", `ESSAI PME ${marque}`, "autonome");
      cabinet = await org("cabinet", `ESSAI CABINET ${marque}`, "mandate");
    });
  });

  after(async () => {
    const admin = process.env["DATABASE_URL_ADMIN"];
    if (BASE_CONFIGUREE && admin && cabinet) {
      const pool = new pg.Pool({ connectionString: admin });
      try {
        await pool.query(
          `update identity.organizations
              set archived_at = now(), archived_reason = 'fixture de test automatisé'
            where id = any($1::uuid[]) and archived_at is null`,
          [[pme, cabinet]],
        );
      } finally {
        await pool.end();
      }
    }
    if (arret) await arret();
    await fermerLePool();
    if (racineEssai) await rm(racineEssai, { recursive: true, force: true });
  });

  function rpc(depot: string, methode: string, args: unknown[]): Promise<unknown> {
    return sousIdentite(personne.id, (db) => executerRpc(db, { depot, methode, args }));
  }

  async function parLeReseau(
    jeton: string,
    corps: { depot: string; methode: string; args: unknown[] },
  ): Promise<{ status: number; json: { resultat?: unknown; erreur?: string } }> {
    const reponse = await fetch(`${base}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${jeton}` },
      body: JSON.stringify(corps),
    });
    return { status: reponse.status, json: (await reponse.json()) as never };
  }

  const lecture = () => ({
    depot: "office",
    methode: "periodeLignes",
    args: [cabinet, "2020-01-01", "2030-12-31"],
  });

  it("crée une clé, la rend en clair une seule fois, et la liste masquée", async () => {
    const creee = (await rpc("integrations", "creerCle", [
      cabinet,
      "Outil d'essai",
      ["ecritures.lire", "pieces.deposer"],
    ])) as { id: string; cle: string; prefixe: string; suffixe: string };
    assert.ok(creee.cle.startsWith(PREFIXE_CLE));
    cle = creee.cle;
    cleId = creee.id;

    const liste = (await rpc("integrations", "cles", [cabinet])) as CleVue[];
    const vue = liste.find((k) => k.id === cleId);
    assert.ok(vue, "la clé créée doit apparaître dans la liste");
    assert.equal(vue.prefixe, cle.slice(PREFIXE_CLE.length, PREFIXE_CLE.length + 8));
    assert.equal(vue.suffixe, cle.slice(-4));
    assert.deepEqual(vue.portees, ["ecritures.lire", "pieces.deposer"]);
    assert.equal(vue.revokedAt, null);
    assert.ok(!JSON.stringify(liste).includes(cle), "la valeur en clair ne se relit jamais");

    const etat = (await rpc("integrations", "etat", [cabinet])) as { clesActives: number };
    assert.equal(etat.clesActives, 1);
  });

  it("une PME ne porte pas de clé", async () => {
    await assert.rejects(rpc("integrations", "creerCle", [pme, "Essai", ["ecritures.lire"]]));
  });

  it("sous la clé, les organisations de l'appelant sont exactement le cabinet", async () => {
    const resolue = await resoudreCle(cle);
    assert.ok(resolue, "une clé active doit se résoudre");
    assert.equal(resolue.tenantId, cabinet);
    assert.equal(resolue.auNomDe, personne.id);

    const orgs = await sousCleDuCabinet(resolue, async (db) => {
      const { rows } = await db.query<{ id: string }>(`select app.member_orgs() as id`);
      return rows.map((r) => r.id);
    });
    // La personne est membre de la PME aussi ; la clé, elle, ne la voit pas.
    assert.deepEqual(orgs, [cabinet]);

    // Et la session de cette personne, elle, voit toujours ses deux organisations.
    const session = await sousIdentite(personne.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(`select app.member_orgs() as id`);
      return rows.map((r) => r.id).sort();
    });
    assert.deepEqual(session, [cabinet, pme].sort());
  });

  it("par le réseau : la portée ouvre ce qu'elle couvre, et ferme le reste", async () => {
    const ouverte = await parLeReseau(cle, lecture());
    assert.equal(ouverte.status, 200, JSON.stringify(ouverte.json));
    assert.deepEqual(ouverte.json.resultat, []);

    const fermee = await parLeReseau(cle, {
      depot: "parametrage",
      methode: "reglagesCabinet",
      args: [cabinet],
    });
    assert.equal(fermee.status, 403);
    assert.ok(fermee.json.erreur && !/[a-z_]+\.[a-z_]+/.test(fermee.json.erreur));

    // Une clé ne gère pas les clés, quelle que soit sa portée.
    const reflexive = await parLeReseau(cle, {
      depot: "integrations",
      methode: "cles",
      args: [cabinet],
    });
    assert.equal(reflexive.status, 403);
  });

  it("dépose une pièce avec la clé : la ligne par la RPC, les octets par la route", async () => {
    const enregistree = await parLeReseau(cle, {
      depot: "capture",
      methode: "enregistrer",
      args: [
        {
          tenantId: cabinet,
          source: "pdf",
          vis: "personnel",
          idempotencyKey: `${marque}-piece`,
          contentType: "application/pdf",
        },
      ],
    });
    assert.equal(enregistree.status, 200, JSON.stringify(enregistree.json));
    const { id } = enregistree.json.resultat as { id: string };
    assert.ok(id);

    const octets = await fetch(`${base}/pieces/${id}/contenu`, {
      method: "POST",
      headers: { authorization: `Bearer ${cle}`, "content-type": "application/pdf" },
      body: OCTETS,
    });
    assert.equal(octets.status, 201);

    // La lecture des octets reste une affaire de session : la clé n'y a pas accès.
    const relecture = await fetch(`${base}/pieces/${id}/contenu`, {
      headers: { authorization: `Bearer ${cle}` },
    });
    assert.equal(relecture.status, 401);

    // La personne, elle, relit ce que la clé a déposé : même cabinet, même RLS.
    const parLaSession = await fetch(`${base}/pieces/${id}/contenu`, {
      headers: { authorization: `Bearer ${emettreJeton(personne)}` },
    });
    assert.equal(parLaSession.status, 200);
    assert.deepEqual(Buffer.from(await parLaSession.arrayBuffer()), OCTETS);
  });

  it("une clé inconnue est refusée, sans détail", async () => {
    const inconnue = await parLeReseau(`${PREFIXE_CLE}${"0".repeat(48)}`, lecture());
    assert.equal(inconnue.status, 401);
    assert.equal(await resoudreCle(`${PREFIXE_CLE}${"0".repeat(48)}`), null);
  });

  it("une clé révoquée ne résout plus, et ne se révoque pas deux fois", async () => {
    await rpc("integrations", "revoquerCle", [cleId]);

    assert.equal(await resoudreCle(cle), null, "une clé révoquée ne doit plus se résoudre");
    const refus = await parLeReseau(cle, lecture());
    assert.equal(refus.status, 401);

    const liste = (await rpc("integrations", "cles", [cabinet])) as CleVue[];
    assert.ok(liste.find((k) => k.id === cleId)?.revokedAt, "la clé reste listée, révoquée");

    await assert.rejects(rpc("integrations", "revoquerCle", [cleId]));
    // Elle ne s'efface pas non plus : le déclencheur refuse, même à un membre.
    await assert.rejects(
      sousIdentite(personne.id, (db) => db.query(`delete from api_keys_v where id = $1`, [cleId])),
    );

    const etat = (await rpc("integrations", "etat", [cabinet])) as { clesActives: number };
    assert.equal(etat.clesActives, 0);
  });
});
