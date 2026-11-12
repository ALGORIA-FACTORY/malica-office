/**
 * La bibliothèque s'imprime — éprouvé par le réseau, sous les rôles réels.
 *
 * `POST /impressions` passe par la vraie application Express et la vraie base
 * (RLS, sans superutilisateur pour les gestes). Ce que ces épreuves établissent :
 *
 *   — la COMPOSITION : une page de garde (société, matricule, période, nombre
 *     de pièces), l'index, puis les pièces dans l'ordre de l'index ; une page
 *     de garde par société quand la sélection en couvre plusieurs ;
 *   — les DROITS : on n'imprime pas les pièces d'un autre, l'espace privé
 *     n'entre jamais dans une impression, le cabinet imprime sous son mandat
 *     la même composition que le dossier téléchargé ;
 *   — le JOURNAL : chaque impression s'y inscrit (qui, quoi, quand), et un
 *     refus n'y laisse rien ;
 *   — l'ÉPHÉMÈRE : aucun fichier écrit, aucune lecture consommée ;
 *   — le VOLUME : le seuil de la tour avertit, son plafond refuse.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { createCanvas, PDFDocument } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import pg from "pg";

import { creerCompte, emettreJeton, type Utilisateur } from "./auth.ts";
import { documentsLies } from "./bibliotheque.ts";
import { fermerLePool, sousIdentite } from "./db.ts";
import { identite } from "./depots/identite.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";

const CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["DATABASE_URL_ADMIN"] && process.env["JWT_SECRET"],
);

/** Un PDF de deux pages en portrait, et une photo couchée : l'ordre se lit à leur sens. */
function unPdfDeDeuxPages(): Buffer {
  const doc = new PDFDocument();
  for (const couleur of ["#2968A5", "#3A8F54"]) {
    const ctx = doc.beginPage(595, 842);
    ctx.fillStyle = couleur;
    ctx.fillRect(40, 40, 200, 120);
    doc.endPage();
  }
  return doc.close();
}
async function unePhotoCouchee(): Promise<Buffer> {
  const toile = createCanvas(800, 500);
  const ctx = toile.getContext("2d");
  ctx.fillStyle = "#B58614";
  ctx.fillRect(0, 0, 800, 500);
  return toile.encode("jpeg", 80);
}

/** Ce qu'un lecteur de PDF voit d'une impression : le texte et le sens de chaque page. */
async function lire(pdf: ArrayBuffer): Promise<Array<{ texte: string; couchee: boolean }>> {
  const tache = getDocument({ data: new Uint8Array(pdf), verbosity: 0 });
  const doc = await tache.promise;
  const pages: Array<{ texte: string; couchee: boolean }> = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const vue = page.getViewport({ scale: 1 });
    const contenu = await page.getTextContent();
    pages.push({
      texte: contenu.items.map((i) => ("str" in i ? i.str : "")).join(" "),
      couchee: vue.width > vue.height,
    });
  }
  await tache.destroy();
  return pages;
}

describe("la bibliothèque s'imprime", { skip: !CONFIGUREE }, () => {
  const marque = `impression-${Date.now()}`;
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
  let racineEssai = "";
  let base = "";
  let arret: (() => Promise<void>) | null = null;
  let dirigeant: Utilisateur;
  let expert: Utilisateur;
  let intrus: Utilisateur;
  /** Un collaborateur de la société : il voit ses pièces, pas celles du dirigeant. */
  let collaborateur: Utilisateur;
  let societe = "";
  let seconde = "";
  let cabinet = "";
  const matricule = matriculeDEssai();
  let photo = "";
  let facture = "";
  let justificatif = "";
  let privee = "";
  let autre = "";
  let gardee = "";
  let saPiece = "";
  let pieceDuPatron = "";
  let rayons = "";

  const imprimer = (qui: Utilisateur, corps: Record<string, unknown>) =>
    fetch(`${base}/impressions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${emettreJeton(qui, new Date())}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ langue: "fr", portee: "selection", confirme: true, ...corps }),
    });
  const journal = async (acteur: string) =>
    (
      await admin.query<{ tenant_id: string; payload: Record<string, unknown>; at: Date }>(
        `select tenant_id, payload, at from audit.event_log
          where action = 'impression.generee' and actor = $1 order by at, id`,
        [acteur],
      )
    ).rows;
  const fichiers = async () =>
    (await readdir(racineEssai, { recursive: true, withFileTypes: true }))
      .filter((f) => f.isFile())
      .map((f) => path.join(f.parentPath, f.name))
      .sort();
  /** Le réglage de la tour pour une épreuve ; le défaut livré revient ensuite. */
  const regler = (pagesSeuil: number, pagesMax: number) =>
    admin.query(
      `insert into plateforme.reglages_impression (pages_seuil, octets_seuil, pages_max, motif)
       values ($1, 20971520, $2, 'épreuve automatique')`,
      [pagesSeuil, pagesMax],
    );

  before(async () => {
    racineEssai = await mkdtemp(path.join(tmpdir(), "malica-impression-"));
    process.env["STOCKAGE_RACINE"] = racineEssai;
    const { app } = await import("./app.ts");
    const serveur = app.listen(0);
    await new Promise((resoudre) => serveur.once("listening", resoudre));
    base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
    arret = () => new Promise<void>((resoudre) => serveur.close(() => resoudre()));

    const comptes = await Promise.all(
      ["dirigeant", "expert", "intrus", "collaborateur"].map((r) =>
        creerCompte(`${r}-${marque}@essai.local`, "MotDePasseTresLong2026!"),
      ),
    );
    assert.ok(comptes.every(Boolean));
    [dirigeant, expert, intrus, collaborateur] = comptes as [
      Utilisateur,
      Utilisateur,
      Utilisateur,
      Utilisateur,
    ];
    const creer = (u: Utilisateur, kind: string, nom: string, legal: string | null) =>
      sousIdentite(u.id, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `select public.create_organization($1,$2,'autonome',$3,'TN','TND') as id`,
          [kind, nom, legal],
        );
        return rows[0]!.id;
      });
    societe = await creer(dirigeant, "pme", `Atelier ${marque}`, matricule);
    seconde = await creer(dirigeant, "pme", `Boutique ${marque}`, matriculeDEssai());
    cabinet = await creer(expert, "cabinet", `Comptabilité ${marque}`, null);
    await creer(intrus, "pme", `Intrus ${marque}`, matriculeDEssai());
    await sousIdentite(expert.id, (db) => identite.proposerMandat(db, cabinet, matricule));
    const [mandat] = await sousIdentite(dirigeant.id, (db) =>
      identite.mandatsProposes(db, societe),
    );
    await sousIdentite(dirigeant.id, (db) => identite.repondreAuMandat(db, mandat!.id, true));

    // Des pièces d'essai à l'état voulu, posées par l'administration ; leurs
    // octets, écrits là où le stockage les attend (`<racine>/<société>/<pièce>`).
    const pdf = unPdfDeDeuxPages();
    const jpeg = await unePhotoCouchee();
    const ajouter = async (
      tenant: string,
      vis: string,
      type: string,
      recueLe: string,
      octets: Buffer,
      lu: { issuer: string; numero: string; date: string } | null,
      parent: string | null = null,
      auteur: string = dirigeant.id,
    ) => {
      const { rows } = await admin.query<{ id: string }>(
        `insert into capture.pieces
           (tenant_id, source, vis, storage_path, idempotency_key, created_by, document_kind,
            document_kind_statut, source_piece_id, created_at, content_type, page_count)
         values ($1, $2, $3, $4, $4, $5, $6, 'confirme', $7, $8, $9, $10) returning id`,
        [
          tenant,
          octets === pdf ? "pdf" : "photo",
          vis,
          `${marque}-${Math.random()}`,
          auteur,
          type,
          parent,
          recueLe,
          octets === pdf ? "application/pdf" : "image/jpeg",
          octets === pdf ? 2 : 1,
        ],
      );
      const id = rows[0]!.id;
      if (lu)
        await admin.query(
          `insert into capture.extractions (tenant_id, piece_id, contract, payload)
           values ($1, $2, 'extract.v1', $3::jsonb)`,
          [
            tenant,
            id,
            JSON.stringify({
              issuer: lu.issuer,
              document_date: lu.date,
              references: { invoice_no: lu.numero },
            }),
          ],
        );
      await mkdir(path.join(racineEssai, tenant), { recursive: true });
      await writeFile(path.join(racineEssai, tenant, id), octets);
      return id;
    };
    // La photo est reçue AVANT la facture : elle la précède dans l'index.
    photo = await ajouter(societe, "partage", "ticket_caisse", "2026-10-28T09:00:00Z", jpeg, {
      issuer: "Papeterie El Amen",
      numero: "RC-0007",
      date: "2026-10-28",
    });
    facture = await ajouter(societe, "partage", "facture_achat", "2026-11-03T09:00:00Z", pdf, {
      issuer: "Grossiste du Sahel",
      numero: "FA-2026-1111",
      date: "2026-11-02",
    });
    justificatif = await ajouter(
      societe,
      "partage",
      "justificatif_paiement",
      "2026-11-04T09:00:00Z",
      jpeg,
      null,
      facture,
    );
    privee = await ajouter(
      societe,
      "personnel",
      "ticket_caisse",
      "2026-11-05T09:00:00Z",
      jpeg,
      null,
    );
    autre = await ajouter(seconde, "partage", "facture_achat", "2026-11-06T09:00:00Z", pdf, {
      issuer: "Imprimerie du Lac",
      numero: "FA-77",
      date: "2026-11-06",
    });
    // Gardée à la société, jamais transmise : elle est dans sa bibliothèque.
    gardee = await ajouter(societe, "entite", "ticket_caisse", "2026-11-07T09:00:00Z", jpeg, null);
    // Une société d'atelier (sans licence, donc sans borne de places) : le
    // dirigeant et un collaborateur, chacun sa pièce gardée.
    const { rows: atelier } = await admin.query<{ id: string }>(
      `insert into identity.organizations (kind, name, jurisdiction, currency)
       values ('pme', $1, 'TN', 'TND') returning id`,
      [`Rayons ${marque}`],
    );
    rayons = atelier[0]!.id;
    await admin.query(
      `insert into identity.memberships (tenant_id, user_id, role)
       values ($1, $2, 'collaborateur'), ($1, $3, 'dirigeant')`,
      [rayons, collaborateur.id, dirigeant.id],
    );
    saPiece = await ajouter(
      rayons,
      "entite",
      "ticket_caisse",
      "2026-11-08T09:00:00Z",
      jpeg,
      null,
      null,
      collaborateur.id,
    );
    pieceDuPatron = await ajouter(
      rayons,
      "entite",
      "ticket_caisse",
      "2026-11-09T09:00:00Z",
      jpeg,
      null,
    );
  });

  after(async () => {
    try {
      if (arret) await arret();
      // Le défaut livré redevient le réglage en vigueur (table en ajout seul).
      await admin.query(
        `insert into plateforme.reglages_impression (pages_seuil, octets_seuil, pages_max, motif)
         select pages_seuil, octets_seuil, pages_max, 'épreuve automatique : retour au défaut livré'
           from plateforme.reglages_impression order by decide_le, id limit 1`,
      );
      await admin.query(
        `update identity.organizations set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = any($1::uuid[])`,
        [[societe, seconde, cabinet, rayons].filter(Boolean)],
      );
    } finally {
      await admin.end();
      if (racineEssai) await rm(racineEssai, { recursive: true, force: true });
      await fermerLePool();
    }
  });

  it("compose la page de garde, l'index, puis les pièces dans l'ordre de l'index", async () => {
    const avant = await fichiers();
    const lectures = async () =>
      (
        await admin.query<{ n: string }>(
          `select (select count(*) from capture.extractions where tenant_id = $1)
                + (select count(*) from agents.agent_runs where tenant_id = $1) as n`,
          [societe],
        )
      ).rows[0]!.n;
    const lecturesAvant = await lectures();

    const reponse = await imprimer(dirigeant, { pieces: [facture, photo], portee: "dossier" });
    assert.equal(reponse.status, 200);
    assert.equal(reponse.headers.get("content-type"), "application/pdf");
    assert.match(reponse.headers.get("cache-control") ?? "", /no-store/);
    const pages = await lire(await reponse.arrayBuffer());

    // Garde, index, la photo (reçue la première, couchée), puis les deux pages de la facture.
    assert.equal(pages.length, 5);
    const garde = pages[0]!.texte;
    assert.match(garde, new RegExp(`Atelier ${marque}`));
    assert.ok(garde.includes(matricule), "le matricule est sur la page de garde");
    assert.match(garde, /10\/2026 – 11\/2026/, "la période va du premier au dernier mois");
    assert.match(garde, /Nombre de pièces\s+2\b/);
    const index = pages[1]!.texte;
    assert.match(index, /Index des pièces/);
    assert.ok(
      index.indexOf("RC-0007") > 0 && index.indexOf("RC-0007") < index.indexOf("FA-2026-1111"),
      "l'index suit l'ordre de réception",
    );
    assert.match(index, /Papeterie El Amen/);
    assert.deepEqual(
      pages.slice(2).map((p) => p.couchee),
      [true, false, false],
      "les pièces suivent l'ordre de l'index",
    );

    const lignes = await journal(dirigeant.id);
    assert.equal(lignes.length, 1, "une impression, une ligne au journal");
    assert.equal(lignes[0]!.tenant_id, societe);
    assert.deepEqual(lignes[0]!.payload["pieces"], [photo, facture]);
    assert.equal(lignes[0]!.payload["portee"], "dossier");
    assert.equal(lignes[0]!.payload["pages"], 5);
    assert.ok(Date.now() - lignes[0]!.at.getTime() < 60_000, "datée de l'impression");

    assert.deepEqual(await fichiers(), avant, "aucun fichier n'est gardé");
    assert.equal(await lectures(), lecturesAvant, "aucune lecture n'est consommée");
  });

  it("n'imprime pas les pièces d'un autre, et n'en laisse rien au journal", async () => {
    const reponse = await imprimer(intrus, { pieces: [facture] });
    assert.equal(reponse.status, 404);
    assert.notEqual(reponse.headers.get("content-type"), "application/pdf");
    // Ni en se disant cabinet : le mandat n'est pas le sien.
    const sousCabinet = await imprimer(intrus, { pieces: [facture], cabinetId: cabinet });
    assert.ok([400, 404].includes(sousCabinet.status));
    assert.deepEqual(await journal(intrus.id), []);
    assert.equal((await imprimer(intrus, { pieces: [facture] })).status, 404);
    const sansSession = await fetch(`${base}/impressions`, { method: "POST" });
    assert.equal(sansSession.status, 401);
  });

  it("un collaborateur imprime ses pièces, pas celles du dirigeant", async () => {
    const siennes = await imprimer(collaborateur, { pieces: [saPiece], portee: "piece" });
    assert.equal(siennes.headers.get("content-type"), "application/pdf");
    assert.equal((await lire(await siennes.arrayBuffer())).length, 3);
    assert.equal((await imprimer(collaborateur, { pieces: [pieceDuPatron] })).status, 404);
    assert.equal((await imprimer(collaborateur, { pieces: [saPiece, pieceDuPatron] })).status, 404);
    // Le dirigeant, lui, imprime la pièce de son collaborateur.
    const duDirigeant = await imprimer(dirigeant, { pieces: [saPiece], portee: "piece" });
    assert.equal(duDirigeant.headers.get("content-type"), "application/pdf");
    await duDirigeant.arrayBuffer();
    const lignes = await journal(collaborateur.id);
    assert.equal(lignes.length, 1, "seule l'impression permise s'inscrit");
    assert.deepEqual(lignes[0]!.payload["pieces"], [saPiece]);
  });

  it("imprime une pièce gardée à la société, que la comptabilité ne voit pas", async () => {
    const reponse = await imprimer(dirigeant, { pieces: [gardee], portee: "piece" });
    assert.equal(reponse.headers.get("content-type"), "application/pdf");
    await reponse.arrayBuffer();
    assert.equal(
      (await imprimer(expert, { pieces: [gardee], cabinetId: cabinet })).status,
      404,
      "non transmise, elle n'existe pas pour la comptabilité",
    );
  });

  it("n'imprime jamais l'espace privé, même mêlé à des pièces de la société", async () => {
    const avant = (await journal(dirigeant.id)).length;
    assert.equal((await imprimer(dirigeant, { pieces: [privee] })).status, 404);
    assert.equal((await imprimer(dirigeant, { pieces: [facture, privee] })).status, 404);
    assert.equal((await journal(dirigeant.id)).length, avant, "un refus ne s'inscrit pas");
    // La porte du journal le refuse aussi, appelée seule.
    await assert.rejects(
      sousIdentite(dirigeant.id, (db) =>
        db.query(`select public.impression_journaliser($1::uuid[], 'piece', 1, 1)`, [[privee]]),
      ),
      /refus\.introuvable\.piece/,
    );
  });

  it("imprime sous le mandat du cabinet la composition du dossier téléchargé", async () => {
    const dossier = await sousIdentite(expert.id, (db) =>
      documentsLies(db, cabinet, societe, [facture]),
    );
    const reponse = await imprimer(expert, { pieces: [facture], cabinetId: cabinet });
    assert.equal(reponse.status, 200);
    const pages = await lire(await reponse.arrayBuffer());
    // Garde, index, la facture (deux pages), puis son justificatif lié (une photo).
    assert.deepEqual(
      pages.map((p) => p.couchee),
      [false, false, false, false, true],
    );
    const lignes = await journal(expert.id);
    assert.equal(lignes.length, 1);
    assert.equal(lignes[0]!.tenant_id, societe);
    assert.deepEqual(
      lignes[0]!.payload["pieces"],
      dossier.documents.map((d) => d.id),
      "les mêmes pièces, dans le même ordre, que l'archive",
    );
    assert.deepEqual(lignes[0]!.payload["pieces"], [facture, justificatif]);
  });

  it("ouvre une page de garde par société quand la sélection en couvre plusieurs", async () => {
    const avant = (await journal(dirigeant.id)).length;
    const reponse = await imprimer(dirigeant, { pieces: [autre, photo] });
    assert.equal(reponse.status, 200);
    const pages = await lire(await reponse.arrayBuffer());
    // Atelier : garde, index, photo. Boutique : garde, index, deux pages.
    assert.equal(pages.length, 7);
    assert.match(pages[0]!.texte, new RegExp(`Atelier ${marque}`));
    assert.match(pages[3]!.texte, new RegExp(`Boutique ${marque}`));
    assert.match(pages[4]!.texte, /FA-77/);
    const lignes = (await journal(dirigeant.id)).slice(avant);
    assert.deepEqual(new Set(lignes.map((l) => l.tenant_id)), new Set([societe, seconde]));
  });

  it("écrit les mentions dans la langue demandée", async () => {
    const reponse = await imprimer(dirigeant, { pieces: [photo], langue: "en", portee: "piece" });
    const pages = await lire(await reponse.arrayBuffer());
    assert.match(pages[0]!.texte, /Number of documents\s+1\b/);
    assert.match(pages[1]!.texte, /Document index/);
  });

  it("avertit au-delà du seuil de la tour, et refuse au-delà de son plafond", async () => {
    const avant = (await journal(dirigeant.id)).length;
    await regler(3, 400);
    const averti = await imprimer(dirigeant, { pieces: [facture, photo], confirme: false });
    assert.equal(averti.status, 200);
    const constat = (await averti.json()) as Record<string, unknown>;
    assert.equal(constat["etat"], "a_confirmer");
    assert.equal(constat["pages"], 5);
    assert.ok(Number(constat["octets"]) > 0, "la taille des originaux est dite");
    assert.equal((await journal(dirigeant.id)).length, avant, "un avertissement n'imprime rien");
    // Confirmé, le même lot s'imprime.
    const confirme = await imprimer(dirigeant, { pieces: [facture, photo], confirme: true });
    assert.equal(confirme.headers.get("content-type"), "application/pdf");
    await confirme.arrayBuffer();

    await regler(3, 4);
    const refuse = await imprimer(dirigeant, { pieces: [facture, photo], confirme: true });
    const refus = (await refuse.json()) as Record<string, unknown>;
    assert.equal(refus["etat"], "trop_volumineuse");
    assert.equal(refus["pagesMax"], 4);
  });

  it("ne laisse régler le volume qu'à la tour", async () => {
    await assert.rejects(
      sousIdentite(dirigeant.id, (db) =>
        db.query(`select plateforme.impression_regler(1, 1, 1, 'essai')`),
      ),
    );
    await assert.rejects(
      sousIdentite(dirigeant.id, (db) =>
        db.query(
          `insert into plateforme.reglages_impression (pages_seuil, octets_seuil, pages_max, motif)
           values (1, 1, 1, 'essai')`,
        ),
      ),
    );
  });
});
