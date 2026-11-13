/**
 * Une pièce reçue aboutit à une écriture proposée — et quand elle n'y aboutit
 * pas, la plateforme le voit (G1, recette du 13 novembre 2026).
 *
 * Le 13 novembre, depuis 9 h 30, aucune pièce reçue sur le staging n'avait
 * d'écriture proposée, et aucune épreuve ne tenait la chaîne de bout en bout :
 * les épreuves existantes la prennent par morceaux (la lecture d'un côté, la
 * proposition de l'autre, avec des lectures posées à la main). Celle-ci la
 * parcourt SOUS RLS RÉELLE, par la vraie application :
 *
 *   1. la pièce est déposée (`/rpc` puis `/pieces/:id/contenu`, jeton du client) ;
 *   2. la lecture tourne par le vrai flux (`readPieceFlow`) — seuls les organes
 *      payants sont des faux (`lectures-d-essai.ts`) ;
 *   3. le Socle propose l'écriture, et le client la retrouve, sous sa RLS.
 *
 * Puis la panne : une pièce dont la lecture n'a jamais tourné, demandée depuis
 * plus que le seuil, paraît dans `plateforme.lectures_en_souffrance_v` pour un
 * opérateur de la plateforme — et pour personne d'autre. La plateforme ne lit
 * que la file : jamais la pièce.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/une-piece-recue-aboutit-a-une-proposition.test.ts
 *
 * R7 : les organisations d'essai s'archivent.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { moteurDisponible } from "@malica/sudoku";

import { creerCompte, emettreJeton, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentite } from "./db.ts";
import { fabrique } from "./depots/fabrique.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";
import { creerAppelLocal } from "./malica/appel-local.ts";
import { complete, lecteurs } from "./malica/lecture/lectures-d-essai.ts";
import { readPieceFlow } from "./malica/lecture/read-flow.ts";
import { executerRpc } from "./rpc.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

/** Des octets déclarés JPEG : ils en portent la signature, que le dépôt vérifie. */
const octetsDEssai = (texte: string): Uint8Array =>
  new Uint8Array([0xff, 0xd8, 0xff, ...new TextEncoder().encode(texte)]);

describe("une pièce reçue aboutit à une proposition", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `de-bout-en-bout-${Date.now()}`;
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"], max: 2 });
  let dirigeant: Utilisateur;
  let operateur: Utilisateur;
  let org = "";
  let base = "";
  let racine = "";
  let arret: (() => Promise<void>) | null = null;

  const rpc = (u: Utilisateur, depot: string, methode: string, ...args: unknown[]) =>
    sousIdentite(u.id, (db) => executerRpc(db, { depot, methode, args }));

  /** Le téléphone : la pièce s'enregistre, puis ses octets partent. */
  async function deposer(cle: string): Promise<string> {
    const appeler = (chemin: string, init: RequestInit) =>
      fetch(`${base}${chemin}`, {
        ...init,
        headers: {
          ...(init.headers as Record<string, string>),
          Authorization: `Bearer ${emettreJeton(dirigeant, new Date())}`,
          "X-Malica-Client": "coque-android/0.2.99",
        },
      });
    const enregistree = await appeler("/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-malica-cle": `${cle}-enregistrer` },
      body: JSON.stringify({
        depot: "capture",
        methode: "enregistrer",
        args: [
          {
            tenantId: org,
            source: "photo",
            vis: "partage",
            idempotencyKey: `${marque}-${cle}`,
            contentType: "image/jpeg",
            pageCount: 1,
          },
        ],
      }),
    });
    assert.equal(enregistree.status, 200);
    const piece = ((await enregistree.json()) as { resultat: { id: string } }).resultat.id;
    const octets = await appeler(`/pieces/${piece}/contenu`, {
      method: "POST",
      headers: { "Content-Type": "image/jpeg", "x-malica-cle": `${cle}-octets` },
      body: octetsDEssai(`essai ${marque} ${cle}`),
    });
    assert.equal(octets.status, 201);
    return piece;
  }

  before(async () => {
    const d = await creerCompte(`${marque}@essai.local`, "MotDePasseTresLong2026!");
    const o = await creerCompte(`operateur-${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(d && o);
    dirigeant = d;
    operateur = o;
    // Un dossier autonome : la société tient ses livres, la proposition est la sienne.
    org = await sousIdentite(dirigeant.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', $1, 'autonome', $2, 'TN', 'TND') as id`,
        [`PME ${marque}`, matriculeDEssai("A", "M")],
      );
      return rows[0]!.id;
    });
    await admin.query("insert into app.platform_operators (user_id) values ($1)", [operateur.id]);

    racine = await mkdtemp(path.join(tmpdir(), "malica-de-bout-en-bout-"));
    process.env["STOCKAGE_RACINE"] = racine;
    const { app } = await import("./app.ts");
    const serveur = app.listen(0);
    await new Promise((r) => serveur.once("listening", r));
    base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
    arret = () => new Promise<void>((r) => serveur.close(() => r()));
  });

  after(async () => {
    await admin.query(
      `update identity.organizations set archived_at = now(),
              archived_reason = 'fixture de test automatisé' where id = $1`,
      [org],
    );
    await arret?.();
    await admin.end();
    await fermerLePool();
    if (racine) await rm(racine, { recursive: true, force: true });
  });

  it(
    "déposée, lue puis proposée : le client retrouve l'écriture proposée, sous sa RLS",
    { skip: !moteurDisponible() && "moteur du sudoku absent" },
    async () => {
      const piece = await deposer("lue");
      const modele = lecteurs([() => complete("qwen-vl-ocr")]);
      await readPieceFlow(
        creerAppelLocal((t) => sousIdentite(dirigeant.id, t)),
        piece,
        modele,
      );

      // La lecture est en base : sans elle, aucune proposition ne se calcule.
      const { rows: lues } = await admin.query(
        `select 1 from capture.extractions where piece_id = $1`,
        [piece],
      );
      assert.equal(lues.length, 1, "la lecture est persistée");

      await rpc(dirigeant, "capture", "preciser", piece, "document_kind", "facture_achat");
      const proposition = (await rpc(dirigeant, "office", "propositionDePiece", piece)) as {
        ok: boolean;
        raison?: string;
      };
      assert.equal(proposition.ok, true, proposition.raison);

      const ecriture = (await rpc(dirigeant, "office", "proposerDepuisPiece", piece)) as string;
      assert.match(ecriture, /^[0-9a-f-]{36}$/);

      // L'écriture est PROPOSÉE, et le client la lit — par sa RLS, pas en superutilisateur.
      const lue = await sousIdentite(dirigeant.id, async (db) => {
        const { rows } = await db.query<{ status: string }>(
          `select e.status from socle.ecritures e where e.id = $1 and e.piece_id = $2`,
          [ecriture, piece],
        );
        return rows;
      });
      assert.deepEqual(
        lue.map((r) => r.status),
        ["proposee"],
      );
      const { rows: statut } = await admin.query<{ status: string }>(
        `select status from capture.pieces where id = $1`,
        [piece],
      );
      assert.equal(statut[0]?.status, "proposee");
    },
  );

  it("une lecture qui ne tourne pas depuis plus que le seuil se voit, pour la plateforme seule", async () => {
    const piece = await deposer("muette");
    // Le travail que la route inscrit à la réception : durable, jamais pris.
    await sousIdentite(dirigeant.id, (db) => fabrique.enregistrerLecture(db, piece));

    const alertes = (u: Utilisateur) =>
      sousIdentite(u.id, async (db) => {
        const { rows } = await db.query<{
          tenant_id: string;
          etat: string;
          pieces: number;
          alerte: boolean;
          seuil_min: number;
        }>(
          `select tenant_id, etat, pieces, alerte, seuil_min from plateforme.lectures_en_souffrance_v`,
        );
        return rows.filter((r) => r.tenant_id === org);
      });

    // Fraîche : sous le seuil, elle attend normalement. Pas d'alarme.
    assert.deepEqual(await alertes(operateur), []);

    // Le seuil est en base, pas dans le code : on le lit, on vieillit le travail d'autant.
    const { rows: s } = await admin.query<{ minutes: number }>(
      `select value_num::integer as minutes from ref.socle_params
        where code = 'fabrique.seuil.travail.proposition_attente_min'
          and valid_from <= current_date and (valid_to is null or valid_to >= current_date)
        order by valid_from desc limit 1`,
    );
    assert.ok(s[0], "le seuil est au référentiel");
    const client = await admin.connect();
    try {
      // Les faits sont en ajout seul : seul le superutilisateur, sans déclencheur, date la demande.
      await client.query("begin");
      await client.query("set local session_replication_role = replica");
      await client.query(
        `update fabrique.travaux set demande_le = now() - make_interval(mins => $2::integer + 5)
          where piece_id = $1`,
        [piece, s[0].minutes],
      );
      await client.query("commit");
    } finally {
      client.release();
    }

    const vues = await alertes(operateur);
    assert.equal(vues.length, 1);
    assert.equal(vues[0]!.etat, "a_faire");
    assert.equal(vues[0]!.pieces, 1);
    assert.equal(vues[0]!.alerte, true);
    assert.equal(vues[0]!.seuil_min, s[0].minutes);

    // Le client, lui, ne lit rien de la supervision de la plateforme.
    assert.deepEqual(await alertes(dirigeant), []);
  });
});
