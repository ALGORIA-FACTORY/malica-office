/**
 * La bibliothèque s'exporte — éprouvé par le réseau, sous les rôles réels.
 *
 * `POST /exports/bibliotheque` passe par la vraie application Express et la
 * vraie base (RLS, sans superutilisateur pour les gestes). Ce que ces épreuves
 * établissent :
 *
 *   — le CONTENU : un ZIP des originaux rangés par dossier, un Excel d'une
 *     ligne par pièce, rien d'additionné ; un dossier et une feuille par
 *     société quand l'export en couvre plusieurs ;
 *   — les DROITS : l'espace privé n'est jamais exporté, une autre société non
 *     plus, et un fichier de plusieurs sociétés ne se relit que par son auteur
 *     (un membre d'une seule d'entre elles n'y a pas droit) ;
 *   — le JOURNAL : chaque fichier s'inscrit (qui, quoi, quelles pièces), un
 *     refus n'y laisse rien ; les pièces remises se lisent ensuite ;
 *   — les LIMITES : la taille, les préparations simultanées et la conservation
 *     viennent de la base, et l'API les applique.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/la-bibliotheque-s-exporte.test.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { strFromU8, unzipSync } from "fflate";
import pg from "pg";

import { creerCompte, emettreJeton, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentite } from "./db.ts";
import { preparationsEnCours } from "./export-bibliotheque.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";
import { executerRpc } from "./rpc.ts";

const CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["DATABASE_URL_ADMIN"] && process.env["JWT_SECRET"],
);

/** Des octets distincts par pièce : un ZIP se relit à leur contenu. */
const octetsDe = (nom: string) => Buffer.from(`ORIGINAL ${nom}`);

interface Fichier {
  id: string;
  format: string;
  nomDeFichier: string;
  taille: number;
}
interface Reponse {
  etat: string;
  fichiers?: Fichier[];
  pieces?: number;
  octets?: number;
  erreur?: string;
}

describe("la bibliothèque s'exporte", { skip: !CONFIGUREE }, () => {
  const marque = `export-${Date.now()}`;
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
  let racine = "";
  let base = "";
  let arret: (() => Promise<void>) | null = null;
  let dirigeant: Utilisateur;
  let collaborateurA: Utilisateur;
  let intrus: Utilisateur;
  let societeA = "";
  let societeB = "";
  let societeC = "";
  const piece: Record<string, string> = {};

  const jeton = (u: Utilisateur) => `Bearer ${emettreJeton(u, new Date())}`;
  const exporter = (qui: Utilisateur, corps: Record<string, unknown>) =>
    fetch(`${base}/exports/bibliotheque`, {
      method: "POST",
      headers: { Authorization: jeton(qui), "Content-Type": "application/json" },
      body: JSON.stringify({ langue: "fr", zip: true, excel: true, ...corps }),
    });
  const relire = (qui: Utilisateur, id: string) =>
    fetch(`${base}/exports/${id}/contenu`, { headers: { Authorization: jeton(qui) } });
  const exportsInscrits = async (societes: string[]) =>
    (
      await admin.query<{ n: string }>(
        `select count(*) as n from collab.exports
          where tenant_id = any($1::uuid[]) and format like 'bibliotheque_%'`,
        [societes],
      )
    ).rows[0]!.n;
  const reglerLesLimites = (octetsMax: number, jours: number, simultanes: number) =>
    admin.query(
      `insert into plateforme.reglages_export
         (octets_max, conservation_jours, simultanes_max, motif)
       values ($1, $2, $3, 'épreuve automatique')`,
      [octetsMax, jours, simultanes],
    );

  before(async () => {
    racine = await mkdtemp(path.join(tmpdir(), "malica-export-"));
    process.env["STOCKAGE_RACINE"] = racine;
    const { app } = await import("./app.ts");
    const serveur = app.listen(0);
    await new Promise((resoudre) => serveur.once("listening", resoudre));
    base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
    arret = () => new Promise<void>((resoudre) => serveur.close(() => resoudre()));

    const comptes = await Promise.all(
      ["dirigeant", "collaborateur", "intrus"].map((r) =>
        creerCompte(`${r}-${marque}@essai.local`, "MotDePasseTresLong2026!"),
      ),
    );
    assert.ok(comptes.every(Boolean));
    [dirigeant, collaborateurA, intrus] = comptes as [Utilisateur, Utilisateur, Utilisateur];
    const creer = (u: Utilisateur, nom: string) =>
      sousIdentite(u.id, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `select public.create_organization('pme',$1,'autonome',$2,'TN','TND') as id`,
          [nom, matriculeDEssai()],
        );
        return rows[0]!.id;
      });
    // Une société d'atelier (sans licence, donc sans borne de places) : le dirigeant
    // et un collaborateur, membre de cette seule société.
    const { rows: atelier } = await admin.query<{ id: string }>(
      `insert into identity.organizations (kind, name, jurisdiction, currency)
       values ('pme', $1, 'TN', 'TND') returning id`,
      [`Atelier ${marque}`],
    );
    societeA = atelier[0]!.id;
    await admin.query(
      `insert into identity.memberships (tenant_id, user_id, role)
       values ($1, $2, 'dirigeant'), ($1, $3, 'collaborateur')`,
      [societeA, dirigeant.id, collaborateurA.id],
    );
    societeB = await creer(dirigeant, `Boutique ${marque}`);
    societeC = await creer(intrus, `Intrus ${marque}`);

    const ajouter = async (
      cle: string,
      tenant: string,
      vis: string,
      type: string,
      recueLe: string,
      auteur: string,
      lu: { issuer: string; numero: string; date: string } | null,
    ) => {
      const { rows } = await admin.query<{ id: string }>(
        `insert into capture.pieces
           (tenant_id, source, vis, storage_path, idempotency_key, created_by, document_kind,
            document_kind_statut, created_at, content_type, page_count)
         values ($1, 'photo', $2, $3, $3, $4, $5, 'confirme', $6, 'image/jpeg', 1) returning id`,
        [tenant, vis, `${marque}-${cle}`, auteur, type, recueLe],
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
      await mkdir(path.join(racine, tenant), { recursive: true });
      await writeFile(path.join(racine, tenant, id), octetsDe(cle));
      piece[cle] = id;
    };
    await ajouter(
      "facture",
      societeA,
      "partage",
      "facture_achat",
      "2026-11-03T09:00:00Z",
      dirigeant.id,
      {
        issuer: "Grossiste du Sahel",
        numero: "FA-1111",
        date: "2026-11-02",
      },
    );
    await ajouter(
      "ticket",
      societeA,
      "entite",
      "ticket_caisse",
      "2026-11-05T09:00:00Z",
      dirigeant.id,
      null,
    );
    await ajouter(
      "privee",
      societeA,
      "personnel",
      "ticket_caisse",
      "2026-11-06T09:00:00Z",
      dirigeant.id,
      null,
    );
    await ajouter(
      "deB",
      societeB,
      "partage",
      "facture_achat",
      "2026-11-07T09:00:00Z",
      dirigeant.id,
      {
        issuer: "Imprimerie du Lac",
        numero: "FA-77",
        date: "2026-11-06",
      },
    );
    await ajouter(
      "deC",
      societeC,
      "partage",
      "facture_achat",
      "2026-11-08T09:00:00Z",
      intrus.id,
      null,
    );
  });

  after(async () => {
    try {
      if (arret) await arret();
      // Le défaut livré redevient le réglage en vigueur (table en ajout seul).
      await admin.query(
        `insert into plateforme.reglages_export
           (octets_max, conservation_jours, simultanes_max, motif)
         select octets_max, conservation_jours, simultanes_max,
                'épreuve automatique : retour au défaut livré'
           from plateforme.reglages_export order by decide_le, id limit 1`,
      );
      await admin.query(
        `update identity.organizations set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = any($1::uuid[])`,
        [[societeA, societeB, societeC].filter(Boolean)],
      );
    } finally {
      await admin.end();
      if (racine) await rm(racine, { recursive: true, force: true });
      await fermerLePool();
    }
  });

  describe("une société, ses deux fichiers", () => {
    let fichiers: Fichier[] = [];

    it("garde un ZIP des originaux par dossier et un Excel d'une ligne par pièce", async () => {
      const r = await exporter(dirigeant, { pieces: [piece["facture"], piece["ticket"]] });
      assert.equal(r.status, 200);
      const corps = (await r.json()) as Reponse;
      assert.equal(corps.etat, "pret");
      fichiers = corps.fichiers!;
      assert.deepEqual(fichiers.map((f) => f.format).sort(), [
        "bibliotheque_xlsx",
        "bibliotheque_zip",
      ]);
      assert.equal(corps.pieces, 2);

      // Relus par /exports/:id/contenu, octet pour octet.
      const zipFichier = fichiers.find((f) => f.format === "bibliotheque_zip")!;
      const lu = await relire(dirigeant, zipFichier.id);
      assert.equal(lu.status, 200);
      assert.match(lu.headers.get("content-disposition") ?? "", /\.zip/);
      const octets = new Uint8Array(await lu.arrayBuffer());
      assert.equal(octets.length, zipFichier.taille);
      const entrees = unzipSync(octets);
      const noms = Object.keys(entrees).sort();
      assert.equal(noms.length, 2);
      // Un dossier par type de pièce (libellés du référentiel), jamais « cabinet ».
      assert.ok(noms.some((n) => n.startsWith("Achats/") && n.includes("Grossiste du Sahel")));
      assert.ok(noms.some((n) => n.startsWith("Tickets et reçus/")));
      assert.ok(noms.every((n) => !/cabinet/i.test(n)));
      assert.deepEqual(
        Object.values(entrees)
          .map((o) => strFromU8(o))
          .sort(),
        ["ORIGINAL facture", "ORIGINAL ticket"],
      );
      // Le privé n'y est pas.
      assert.ok(!Object.values(entrees).some((o) => strFromU8(o).includes("privee")));
    });

    it("l'Excel est une feuille « Pièces » d'une ligne par pièce, sans total", async () => {
      const xlsx = fichiers.find((f) => f.format === "bibliotheque_xlsx")!;
      const lu = await relire(dirigeant, xlsx.id);
      assert.equal(lu.status, 200);
      const classeur = unzipSync(new Uint8Array(await lu.arrayBuffer()));
      const feuille = strFromU8(classeur["xl/worksheets/sheet1.xml"]!);
      assert.equal((feuille.match(/<row /g) ?? []).length, 3, "l'en-tête et deux pièces");
      assert.match(strFromU8(classeur["xl/workbook.xml"]!), /name="Pièces"/);
      assert.match(feuille, /Grossiste du Sahel/);
      assert.match(feuille, /FA-1111/);
      assert.match(feuille, /02\/11\/2026/);
      assert.ok(!/<f>/.test(feuille), "aucune formule : rien n'est additionné");
    });

    it("s'inscrit au journal, remet les pièces, et se garde jusqu'à l'échéance de la base", async () => {
      const { rows } = await admin.query<{
        format: string;
        empreinte: string;
        expire_le: Date;
        plusieurs_societes: boolean;
        created_by: string;
      }>(
        `select format, empreinte, expire_le, plusieurs_societes, created_by
           from collab.exports where id = any($1::uuid[])`,
        [fichiers.map((f) => f.id)],
      );
      assert.equal(rows.length, 2);
      for (const e of rows) {
        assert.equal(e.created_by, dirigeant.id);
        assert.equal(e.plusieurs_societes, false);
        // Sept jours, le défaut livré de la base.
        const jours = (e.expire_le.getTime() - Date.now()) / 86_400_000;
        assert.ok(jours > 6.9 && jours < 7.1);
      }
      const zip = fichiers.find((f) => f.format === "bibliotheque_zip")!;
      const octets = new Uint8Array(await (await relire(dirigeant, zip.id)).arrayBuffer());
      assert.equal(
        rows.find((e) => e.format === "bibliotheque_zip")!.empreinte,
        createHash("sha256").update(octets).digest("hex"),
      );

      const remises = await admin.query<{ piece_id: string }>(
        `select piece_id from collab.exports_pieces where export_id = $1`,
        [zip.id],
      );
      assert.deepEqual(
        remises.rows.map((r) => r.piece_id).sort(),
        [piece["facture"], piece["ticket"]].sort(),
      );
      const audit = await admin.query<{ n: string }>(
        `select count(*) as n from audit.event_log
          where action = 'export.bibliotheque' and actor = $1`,
        [dirigeant.id],
      );
      assert.equal(Number(audit.rows[0]!.n), 2);
    });

    it("la liste dit ce qui a été remis : « à exporter » est ce qui ne l'a jamais été", async () => {
      const lire = (qui: Utilisateur, societe: string) =>
        sousIdentite(qui.id, (db) =>
          executerRpc(db, { depot: "capture", methode: "listAvecLecture", args: [societe] }),
        ) as Promise<Array<{ id: string; remiseLe: string | null; comptabilite: boolean }>>;
      const deA = await lire(dirigeant, societeA);
      assert.ok(deA.find((p) => p.id === piece["facture"])!.remiseLe, "la facture a été remise");
      assert.ok(deA.find((p) => p.id === piece["ticket"])!.remiseLe, "le ticket a été remis");
      // Une société sans mandat n'a pas de comptabilité : « à exporter » la concerne.
      assert.equal(deA[0]!.comptabilite, false);
      // Ce que personne n'a remis reste « à exporter ».
      const deB = await lire(dirigeant, societeB);
      assert.equal(deB.find((p) => p.id === piece["deB"])!.remiseLe, null);
      // Un collaborateur ne voit pas les pièces du dirigeant, donc pas leur remise.
      const duCollaborateur = await lire(collaborateurA, societeA);
      assert.equal(
        duCollaborateur.find((p) => p.id === piece["ticket"]),
        undefined,
      );
    });

    it("l'Excel seul, ou le ZIP seul, se demandent", async () => {
      const seul = (await (
        await exporter(dirigeant, { pieces: [piece["ticket"]], zip: false })
      ).json()) as Reponse;
      assert.deepEqual(
        seul.fichiers!.map((f) => f.format),
        ["bibliotheque_xlsx"],
      );
      const zip = (await (
        await exporter(dirigeant, { pieces: [piece["ticket"]], excel: false })
      ).json()) as Reponse;
      assert.deepEqual(
        zip.fichiers!.map((f) => f.format),
        ["bibliotheque_zip"],
      );
    });

    it("sans l'un ni l'autre, la demande est mal formée", async () => {
      const r = await exporter(dirigeant, { pieces: [piece["ticket"]], zip: false, excel: false });
      assert.equal(r.status, 400);
    });
  });

  describe("les droits", () => {
    it("une pièce de l'espace privé refuse l'export entier, et n'inscrit rien", async () => {
      const avant = await exportsInscrits([societeA]);
      const r = await exporter(dirigeant, { pieces: [piece["facture"], piece["privee"]] });
      assert.equal(r.status, 404);
      assert.equal(await exportsInscrits([societeA]), avant);
    });

    it("la porte refuse elle-même une pièce privée, appelée sans l'API", async () => {
      await assert.rejects(
        sousIdentite(dirigeant.id, (db) =>
          db.query(
            `select public.export_bibliotheque_inscrire($1, $2::uuid[], 'bibliotheque_zip', 1, 10,
                    $3, 'x.zip', 'application/zip', date '2026-11-01', date '2026-11-30')`,
            [societeA, [piece["privee"]], "a".repeat(64)],
          ),
        ),
        /refus\.introuvable\.piece/,
      );
    });

    it("on n'exporte pas la pièce d'une autre société", async () => {
      const avant = await exportsInscrits([societeA, societeC]);
      const r = await exporter(dirigeant, { pieces: [piece["deC"]] });
      assert.equal(r.status, 404);
      assert.equal(((await r.json()) as Reponse).erreur?.startsWith("refus.introuvable"), true);
      const inverse = await exporter(intrus, { pieces: [piece["facture"]] });
      assert.equal(inverse.status, 404);
      assert.equal(await exportsInscrits([societeA, societeC]), avant);
    });

    it("l'export d'une société ne se relit pas depuis une autre", async () => {
      const r = (await (
        await exporter(dirigeant, { pieces: [piece["ticket"]] })
      ).json()) as Reponse;
      const id = r.fichiers![0]!.id;
      assert.equal((await relire(dirigeant, id)).status, 200);
      assert.equal((await relire(intrus, id)).status, 404);
    });

    it("un collaborateur n'exporte que ce qu'il voit : ni la pièce du dirigeant, ni le privé", async () => {
      const duDirigeant = await exporter(collaborateurA, { pieces: [piece["ticket"]] });
      assert.equal(duDirigeant.status, 404);
      const privee = await exporter(collaborateurA, { pieces: [piece["privee"]] });
      assert.equal(privee.status, 404);
    });
  });

  describe("toutes les sociétés, un seul fichier", () => {
    let combine: Fichier[] = [];

    it("range un dossier par société dans le ZIP et une feuille par société dans l'Excel", async () => {
      const r = await exporter(dirigeant, {
        pieces: [piece["facture"], piece["ticket"], piece["deB"]],
        langue: "fr",
      });
      assert.equal(r.status, 200);
      const corps = (await r.json()) as Reponse;
      combine = corps.fichiers!;
      const zip = combine.find((f) => f.format === "bibliotheque_zip")!;
      const entrees = unzipSync(
        new Uint8Array(await (await relire(dirigeant, zip.id)).arrayBuffer()),
      );
      const noms = Object.keys(entrees);
      assert.equal(noms.length, 3);
      assert.ok(noms.some((n) => n.startsWith(`Atelier ${marque}/`)));
      assert.ok(noms.some((n) => n.startsWith(`Boutique ${marque}/`)));
      const xlsx = combine.find((f) => f.format === "bibliotheque_xlsx")!;
      const classeur = unzipSync(
        new Uint8Array(await (await relire(dirigeant, xlsx.id)).arrayBuffer()),
      );
      const classeurXml = strFromU8(classeur["xl/workbook.xml"]!);
      assert.match(classeurXml, new RegExp(`name="Atelier ${marque}"`));
      assert.match(classeurXml, new RegExp(`name="Boutique ${marque}"`));
      assert.ok(classeur["xl/worksheets/sheet2.xml"], "une feuille par société");
    });

    it("ne se relit que par son auteur : un membre d'une seule société n'y a pas droit", async () => {
      const zip = combine.find((f) => f.format === "bibliotheque_zip")!;
      assert.equal((await relire(dirigeant, zip.id)).status, 200);
      // Le collaborateur est membre de la société A, où le fichier est rangé.
      assert.equal((await relire(collaborateurA, zip.id)).status, 404);
      assert.equal((await relire(intrus, zip.id)).status, 404);
      const { rows } = await admin.query<{ plusieurs_societes: boolean; tenant_id: string }>(
        `select plusieurs_societes, tenant_id from collab.exports where id = $1`,
        [zip.id],
      );
      assert.equal(rows[0]!.plusieurs_societes, true);
    });

    it("remet les pièces de chaque société, chacune sous sa société", async () => {
      const zip = combine.find((f) => f.format === "bibliotheque_zip")!;
      const { rows } = await admin.query<{ tenant_id: string; piece_id: string }>(
        `select tenant_id, piece_id from collab.exports_pieces where export_id = $1`,
        [zip.id],
      );
      assert.equal(rows.length, 3);
      assert.equal(rows.find((r) => r.piece_id === piece["deB"])!.tenant_id, societeB);
    });
  });

  describe("les limites viennent de la base", () => {
    it("au-delà de la taille maximale : un constat, rien n'est préparé ni inscrit", async () => {
      await reglerLesLimites(10, 7, 2);
      const avant = await exportsInscrits([societeA]);
      const r = await exporter(dirigeant, { pieces: [piece["facture"]] });
      const corps = (await r.json()) as Reponse;
      assert.equal(corps.etat, "trop_volumineuse");
      assert.ok((corps.octets ?? 0) > 10);
      assert.equal(await exportsInscrits([societeA]), avant);
    });

    it("au-delà des préparations simultanées : 429, rien n'est inscrit", async () => {
      await reglerLesLimites(209_715_200, 7, 1);
      preparationsEnCours.set(societeA, 1);
      try {
        const avant = await exportsInscrits([societeA]);
        const r = await exporter(dirigeant, { pieces: [piece["facture"]] });
        assert.equal(r.status, 429);
        assert.equal(((await r.json()) as Reponse).erreur, "refus.export.trop_de_demandes");
        assert.equal(await exportsInscrits([societeA]), avant);
      } finally {
        preparationsEnCours.delete(societeA);
      }
      // La place rendue, la demande suivante passe.
      const r = await exporter(dirigeant, { pieces: [piece["facture"]] });
      assert.equal(r.status, 200);
    });

    it("la conservation : un fichier échu ne se relit plus, et un nouvel export le retire", async () => {
      await reglerLesLimites(209_715_200, 7, 2);
      // Un export échu, posé par l'administration (le journal ne se réécrit pas).
      const { rows } = await admin.query<{ id: string }>(
        `insert into collab.exports
           (tenant_id, format, du, au, lignes, taille_octets, empreinte, created_by,
            nom_de_fichier, type_mime, expire_le)
         values ($1, 'bibliotheque_zip', date '2026-11-01', date '2026-11-30', 1, 3, $2, $3,
                 'ancien.zip', 'application/zip', now() - interval '1 hour') returning id`,
        [societeA, "b".repeat(64), dirigeant.id],
      );
      const echu = rows[0]!.id;
      const chemin = path.join(racine, societeA, "exports", echu);
      await mkdir(path.dirname(chemin), { recursive: true });
      await writeFile(chemin, "abc");
      assert.equal((await relire(dirigeant, echu)).status, 404);
      await access(chemin);
      const r = await exporter(dirigeant, { pieces: [piece["ticket"]] });
      assert.equal(r.status, 200);
      await assert.rejects(access(chemin), "les octets échus sont retirés");
      // La ligne du journal reste : un fait daté ne s'efface pas.
      const reste = await admin.query(`select 1 from collab.exports where id = $1`, [echu]);
      assert.equal(reste.rowCount, 1);
    });
  });

  describe("les mentions du fichier se disent dans la langue demandée", () => {
    for (const [langue, feuille, dossier] of [
      ["fr", "Pièces", "Achats"],
      ["en", "Documents", "Purchases"],
      ["ar", "الوثائق", null],
    ] as const) {
      it(`en ${langue}`, async () => {
        const r = (await (
          await exporter(dirigeant, { pieces: [piece["facture"]], langue })
        ).json()) as Reponse;
        const zip = r.fichiers!.find((f) => f.format === "bibliotheque_zip")!;
        const xlsx = r.fichiers!.find((f) => f.format === "bibliotheque_xlsx")!;
        const classeur = unzipSync(
          new Uint8Array(await (await relire(dirigeant, xlsx.id)).arrayBuffer()),
        );
        assert.match(strFromU8(classeur["xl/workbook.xml"]!), new RegExp(`name="${feuille}"`));
        if (langue === "ar")
          assert.match(strFromU8(classeur["xl/worksheets/sheet1.xml"]!), /rightToLeft="1"/);
        const noms = Object.keys(
          unzipSync(new Uint8Array(await (await relire(dirigeant, zip.id)).arrayBuffer())),
        );
        if (dossier) assert.ok(noms[0]!.startsWith(`${dossier}/`), noms[0]);
        else assert.ok(/[؀-ۿ]/.test(noms[0]!), "le dossier se dit en arabe");
      });
    }
  });
});
