/**
 * Une miniature montre la pièce, sans la livrer.
 *
 * ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
 *
 * Les listes chargeaient les octets COMPLETS de chaque pièce pour en montrer
 * l'aperçu : une à trois mégaoctets la photo, vingt à cent pièces par liste.
 * La route `/pieces/:id/miniature` rend une petite image de la vraie page.
 *
 * Ce que ce fichier établit :
 *   — la miniature d'une photo est un JPEG bien plus léger, dans sa boîte ;
 *   — un PDF scanné donne sa première page ; un PDF de texte, ou un logo, rien
 *     (204 : l'écran garde sa feuille esquissée) ;
 *   — la RLS est la même que celle du contenu : un membre d'un autre tenant ne
 *     la lit pas, ni le dirigeant la pièce PERSONNELLE de son siège (404) ;
 *   — supprimer la pièce efface aussi sa miniature.
 */
import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { createCanvas, loadImage } from "@napi-rs/canvas";
import pg from "pg";

import { creerCompte, emettreJeton, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentiteDuServeur } from "./db.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";
import { fabriquerMiniature } from "./miniature.ts";
import { executerRpc } from "./rpc.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

/** Une « photo » de page, à la taille d'un téléphone : 1200 × 1600. */
async function photo(largeur = 1200, hauteur = 1600): Promise<Buffer> {
  const toile = createCanvas(largeur, hauteur);
  const ctx = toile.getContext("2d");
  ctx.fillStyle = "#F4F4F2";
  ctx.fillRect(0, 0, largeur, hauteur);
  // Du bruit, pour qu'un JPEG ne se réduise pas à rien.
  for (let i = 0; i < 4000; i += 1) {
    ctx.fillStyle = `rgb(${(i * 37) % 255},${(i * 91) % 255},${(i * 53) % 255})`;
    ctx.fillRect((i * 131) % largeur, (i * 197) % hauteur, 9, 3);
  }
  return toile.encode("jpeg", 92);
}

/**
 * Un PDF d'une page A4 qui porte une image JPEG, posée sur toute la page (un
 * scan) ou dans un coin (un logo sur un document de texte).
 */
function pdfAvecImage(
  jpeg: Buffer,
  largeur: number,
  hauteur: number,
  pose: "page" | "logo",
): Uint8Array {
  const place = pose === "page" ? "595 0 0 842 0 0" : "80 0 0 80 40 740";
  const dessin = `q ${place} cm /Im1 Do Q\n`;
  const morceaux: (string | Buffer)[] = [];
  const offsets: number[] = [];
  let taille = 0;
  const pousser = (m: string | Buffer) => {
    morceaux.push(m);
    taille += typeof m === "string" ? Buffer.byteLength(m, "latin1") : m.length;
  };
  const objet = (n: number, corps: (string | Buffer)[]) => {
    offsets[n - 1] = taille;
    pousser(`${n} 0 obj\n`);
    for (const c of corps) pousser(c);
    pousser("\nendobj\n");
  };

  pousser("%PDF-1.4\n");
  objet(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  objet(2, ["<< /Type /Pages /Kids [3 0 R] /Count 1 >>"]);
  objet(3, [
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] " +
      "/Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>",
  ]);
  objet(4, [`<< /Length ${dessin.length} >>\nstream\n${dessin}endstream`]);
  objet(5, [
    `<< /Type /XObject /Subtype /Image /Width ${largeur} /Height ${hauteur} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
    jpeg,
    "\nendstream",
  ]);
  const debut = taille;
  pousser(`xref\n0 6\n0000000000 65535 f \n`);
  for (const o of offsets) pousser(`${String(o).padStart(10, "0")} 00000 n \n`);
  pousser(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${debut}\n%%EOF\n`);
  return new Uint8Array(
    Buffer.concat(morceaux.map((m) => (typeof m === "string" ? Buffer.from(m, "latin1") : m))),
  );
}

describe("fabriquer une miniature", () => {
  it("réduit une photo dans sa boîte, en JPEG, bien plus léger", async () => {
    const source = await photo();
    const mini = await fabriquerMiniature(new Uint8Array(source), "image/jpeg");
    assert.ok(mini, "une photo donne une miniature");
    const image = await loadImage(mini);
    assert.equal(image.width, 360);
    assert.equal(image.height, 480);
    assert.ok(mini.length * 5 < source.length, `${mini.length} o contre ${source.length} o`);
  });

  it("n'agrandit jamais une petite image", async () => {
    const mini = await fabriquerMiniature(new Uint8Array(await photo(120, 160)), "image/jpeg");
    assert.ok(mini);
    const image = await loadImage(mini);
    assert.equal(image.width, 120);
  });

  it("montre la première page d'un PDF scanné", async () => {
    const pdf = pdfAvecImage(await photo(600, 848), 600, 848, "page");
    const mini = await fabriquerMiniature(pdf, "application/pdf");
    assert.ok(mini, "un scan donne sa page");
    const image = await loadImage(mini);
    assert.ok(image.height <= 480 && image.width <= 360);
  });

  it("ne prend pas le logo d'un PDF de texte pour la page", async () => {
    const pdf = pdfAvecImage(await photo(200, 200), 200, 200, "logo");
    assert.equal(await fabriquerMiniature(pdf, "application/pdf"), null);
  });

  it("n'invente rien d'un contenu illisible ou d'un type inconnu", async () => {
    const bruit = new Uint8Array([1, 2, 3, 4, 5]);
    assert.equal(await fabriquerMiniature(bruit, "image/jpeg"), null);
    assert.equal(await fabriquerMiniature(bruit, "application/pdf"), null);
    assert.equal(await fabriquerMiniature(bruit, "application/octet-stream"), null);
  });
});

describe("la route de la miniature", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `miniature-${Date.now()}`;
  let racineEssai = "";
  let base = "";
  let arret: (() => Promise<void>) | null = null;

  let dirigeant: Utilisateur;
  let siege: Utilisateur;
  let tiers: Utilisateur;
  let pme = "";
  let autre = "";
  /** Une photo de la société, visible de ses membres. */
  let dansLaSociete = "";
  /** Une photo que le siège garde pour lui. */
  let privee = "";
  /** Un PDF de texte : aucune miniature à en tirer. */
  let texte = "";

  const admin = async <T>(f: (p: pg.Pool) => Promise<T>) => {
    const p = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
    try {
      return await f(p);
    } finally {
      await p.end();
    }
  };

  const entetes = (qui: Utilisateur) => ({ Authorization: `Bearer ${emettreJeton(qui)}` });

  async function deposer(
    qui: Utilisateur,
    cle: string,
    vis: "personnel" | "entite",
    type: string,
    octets: Uint8Array,
  ): Promise<string> {
    const p = (await sousIdentiteDuServeur(qui.id, (db) =>
      executerRpc(
        db,
        {
          depot: "capture",
          methode: "enregistrer",
          args: [
            {
              tenantId: pme,
              source: type === "application/pdf" ? "pdf" : "photo",
              vis,
              idempotencyKey: `${marque}-${cle}`,
              contentType: type,
              pageCount: 1,
            },
          ],
        },
        "serveur",
      ),
    )) as { id: string };
    const depot = await fetch(`${base}/pieces/${p.id}/contenu`, {
      method: "POST",
      headers: { ...entetes(qui), "Content-Type": type },
      body: octets,
    });
    assert.equal(depot.status, 201);
    return p.id;
  }

  const organisation = (qui: Utilisateur, nom: string) =>
    sousIdentiteDuServeur(qui.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', $1, 'autonome', $2, 'TN', 'TND') as id`,
        [nom, matriculeDEssai()],
      );
      return rows[0]!.id;
    });

  before(async () => {
    racineEssai = await mkdtemp(path.join(tmpdir(), "malica-miniature-"));
    process.env["STOCKAGE_RACINE"] = racineEssai;
    const { app } = await import("./app.ts");
    const serveur = app.listen(0);
    await new Promise((resoudre) => serveur.once("listening", resoudre));
    base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
    arret = () => new Promise<void>((resoudre) => serveur.close(() => resoudre()));

    const d = await creerCompte(`${marque}-dir@essai.local`, "MotDePasseTresLong2026!");
    const s = await creerCompte(`${marque}-siege@essai.local`, "MotDePasseTresLong2026!");
    const t = await creerCompte(`${marque}-tiers@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(d && s && t);
    dirigeant = d;
    siege = s;
    tiers = t;

    pme = await organisation(dirigeant, `PAPETERIE ESSAI ${marque}`);
    autre = await organisation(tiers, `QUINCAILLERIE ESSAI ${marque}`);
    // Une licence Team ouvre les sièges ; la société passe par la vraie porte.
    await sousIdentiteDuServeur(dirigeant.id, (db) =>
      db.query("select public.forfait_changer('team', $1, current_date)", [pme]),
    );
    await admin((p) =>
      p.query(
        "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'collaborateur')",
        [pme, siege.id],
      ),
    );

    const jpeg = new Uint8Array(await photo());
    dansLaSociete = await deposer(dirigeant, "societe", "entite", "image/jpeg", jpeg);
    privee = await deposer(siege, "privee", "personnel", "image/jpeg", jpeg);
    texte = await deposer(
      dirigeant,
      "texte",
      "entite",
      "application/pdf",
      pdfAvecImage(await photo(200, 200), 200, 200, "logo"),
    );
  });

  after(async () => {
    if (arret) await arret();
    await admin((p) =>
      p.query(
        `update identity.organizations set archived_at = now(),
                archived_reason = 'fixture de test automatisé' where id = any($1)`,
        [[pme, autre]],
      ),
    );
    if (racineEssai) await rm(racineEssai, { recursive: true, force: true });
    await fermerLePool();
  });

  it("rend un petit JPEG de la pièce, et le garde à côté d'elle", async () => {
    const reponse = await fetch(`${base}/pieces/${dansLaSociete}/miniature`, {
      headers: entetes(dirigeant),
    });
    assert.equal(reponse.status, 200);
    assert.equal(reponse.headers.get("content-type"), "image/jpeg");
    assert.equal(reponse.headers.get("cache-control"), "private, no-store");
    const octets = Buffer.from(await reponse.arrayBuffer());
    assert.ok(octets.length > 0 && octets.length < 60_000, `${octets.length} octets`);
    await access(path.join(racineEssai, pme, `${dansLaSociete}.miniature.jpg`));
  });

  it("un membre d'un autre tenant ne la lit pas : 404, jamais 403", async () => {
    const reponse = await fetch(`${base}/pieces/${dansLaSociete}/miniature`, {
      headers: entetes(tiers),
    });
    assert.equal(reponse.status, 404);
  });

  it("le dirigeant ne lit pas la miniature de la pièce PERSONNELLE de son siège", async () => {
    const reponse = await fetch(`${base}/pieces/${privee}/miniature`, {
      headers: entetes(dirigeant),
    });
    assert.equal(reponse.status, 404);
    // Son auteur, lui, la voit.
    const sienne = await fetch(`${base}/pieces/${privee}/miniature`, { headers: entetes(siege) });
    assert.equal(sienne.status, 200);
  });

  it("un PDF de texte n'a pas de miniature : 204, et l'écran garde sa feuille", async () => {
    const reponse = await fetch(`${base}/pieces/${texte}/miniature`, {
      headers: entetes(dirigeant),
    });
    assert.equal(reponse.status, 204);
    // Le constat est gardé : la deuxième demande ne relit pas le PDF.
    const encore = await fetch(`${base}/pieces/${texte}/miniature`, {
      headers: entetes(dirigeant),
    });
    assert.equal(encore.status, 204);
  });

  it("sans jeton, rien", async () => {
    const reponse = await fetch(`${base}/pieces/${dansLaSociete}/miniature`);
    assert.equal(reponse.status, 401);
  });

  it("supprimer la pièce efface aussi sa miniature", async () => {
    const chemin = path.join(racineEssai, pme, `${privee}.miniature.jpg`);
    await access(chemin);
    const supprimee = await sousIdentiteDuServeur(siege.id, (db) =>
      executerRpc(db, { depot: "capture", methode: "supprimer", args: [privee] }, "serveur"),
    );
    assert.equal(supprimee, true);
    await assert.rejects(access(chemin));
  });
});
