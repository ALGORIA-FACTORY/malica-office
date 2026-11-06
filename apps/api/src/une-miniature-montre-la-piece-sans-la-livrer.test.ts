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
 *   — tout PDF donne sa première page, rendue : un scan, une page de texte,
 *     un scan en plusieurs images ; seul un PDF chiffré, cassé ou sans page
 *     n'en donne pas (204 : l'écran garde sa feuille esquissée) ;
 *   — un « pas de miniature » gardé AVANT le rendu des PDF se refait ;
 *   — la RLS est la même que celle du contenu : un membre d'un autre tenant ne
 *     la lit pas, ni le dirigeant la pièce PERSONNELLE de son siège (404) ;
 *   — supprimer la pièce efface aussi sa miniature.
 */
import assert from "node:assert/strict";
import { access, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it, mock } from "node:test";
import { deflateSync } from "node:zlib";

import { createCanvas, loadImage } from "@napi-rs/canvas";
import pg from "pg";

import { creerCompte, emettreJeton, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentiteDuServeur } from "./db.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";
import { fabrique, fabriquerMiniature, limitesDuRenduPdf } from "./miniature.ts";
import { executerRpc } from "./rpc.ts";
import { disque } from "./stockage.ts";

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

/** Un objet PDF : son corps, en morceaux de texte ou d'octets. */
type Objet = (string | Buffer)[];

/**
 * Un PDF d'UNE page : catalogue (1), arbre des pages (2), la page (3), son
 * contenu (4), puis les `objets` donnés, numérotés à partir de 5.
 */
function unePage(o: {
  contenu: string;
  ressources?: string;
  boite?: string;
  objets?: Objet[];
  /** Ce qu'on ajoute au `trailer` (un `/Encrypt`, par exemple). */
  trailer?: string;
  /** Sans page du tout : l'arbre est vide. */
  sansPage?: boolean;
}): Uint8Array {
  const objets: Objet[] = [
    ["<< /Type /Catalog /Pages 2 0 R >>"],
    [
      o.sansPage
        ? "<< /Type /Pages /Kids [] /Count 0 >>"
        : "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    ],
    [
      `<< /Type /Page /Parent 2 0 R /MediaBox [${o.boite ?? "0 0 595 842"}] ` +
        `/Resources << ${o.ressources ?? ""} >> /Contents 4 0 R >>`,
    ],
    [`<< /Length ${Buffer.byteLength(o.contenu, "latin1")} >>\nstream\n${o.contenu}endstream`],
    ...(o.objets ?? []),
  ];
  const morceaux: Buffer[] = [];
  const offsets: number[] = [];
  let taille = 0;
  const pousser = (m: string | Buffer) => {
    const b = typeof m === "string" ? Buffer.from(m, "latin1") : m;
    morceaux.push(b);
    taille += b.length;
  };
  pousser("%PDF-1.7\n");
  objets.forEach((corps, i) => {
    offsets[i] = taille;
    pousser(`${i + 1} 0 obj\n`);
    for (const c of corps) pousser(c);
    pousser("\nendobj\n");
  });
  const debut = taille;
  pousser(`xref\n0 ${objets.length + 1}\n0000000000 65535 f \n`);
  for (const off of offsets) pousser(`${String(off).padStart(10, "0")} 00000 n \n`);
  pousser(
    `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R ${o.trailer ?? ""} >>\n` +
      `startxref\n${debut}\n%%EOF\n`,
  );
  return new Uint8Array(Buffer.concat(morceaux));
}

/** Une image JPEG en objet PDF. */
const imageJpeg = (jpeg: Buffer, largeur: number, hauteur: number): Objet => [
  `<< /Type /XObject /Subtype /Image /Width ${largeur} /Height ${hauteur} ` +
    `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
  jpeg,
  "\nendstream",
];

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
  return unePage({
    contenu: `q ${place} cm /Im1 Do Q\n`,
    ressources: "/XObject << /Im1 5 0 R >>",
    objets: [imageJpeg(jpeg, largeur, hauteur)],
  });
}

/** Une facture de TEXTE seul, en Helvetica non embarquée (une police standard). */
const pdfDeTexte = () =>
  unePage({
    contenu:
      "BT /F1 64 Tf 40 700 Td (FACTURE) Tj ET\n" +
      "BT /F1 64 Tf 40 560 Td (N 2026-0042) Tj ET\n" +
      "BT /F1 64 Tf 40 420 Td (TOTAL 118,000) Tj ET\n",
    ressources: "/Font << /F1 5 0 R >>",
    objets: [["<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]],
  });

/**
 * Un PDF chiffré : un `/Encrypt` standard dont le mot de passe d'ouverture
 * n'est pas vide. Sans le mot de passe, rien ne s'en lit.
 */
const pdfChiffre = () =>
  unePage({
    contenu: "BT /F1 24 Tf 40 700 Td (SECRET) Tj ET\n",
    objets: [
      [`<< /Filter /Standard /V 1 /R 2 /O <${"ab".repeat(32)}> /U <${"cd".repeat(32)}> /P -4 >>`],
    ],
    trailer: `/Encrypt 5 0 R /ID [<${"01".repeat(16)}> <${"01".repeat(16)}>]`,
  });

/** La taille d'une miniature, et combien de ses pixels sont sombres (de l'encre). */
async function lire(mini: Buffer) {
  const image = await loadImage(mini);
  const toile = createCanvas(image.width, image.height);
  const ctx = toile.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, image.width, image.height);
  let sombres = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i]! < 100) sombres += 1;
  return { largeur: image.width, hauteur: image.height, sombres };
}

describe("fabriquer une miniature", () => {
  it("réduit une photo dans sa boîte, en JPEG, bien plus léger", async () => {
    const source = await photo();
    const mini = await fabriquerMiniature(new Uint8Array(source));
    assert.ok(mini, "une photo donne une miniature");
    const image = await loadImage(mini);
    assert.equal(image.width, 360);
    assert.equal(image.height, 480);
    assert.ok(mini.length * 5 < source.length, `${mini.length} o contre ${source.length} o`);
  });

  it("n'agrandit jamais une petite image", async () => {
    const mini = await fabriquerMiniature(new Uint8Array(await photo(120, 160)));
    assert.ok(mini);
    const image = await loadImage(mini);
    assert.equal(image.width, 120);
  });

  it("montre la première page d'un PDF scanné", async () => {
    const pdf = pdfAvecImage(await photo(600, 848), 600, 848, "page");
    const mini = await fabriquerMiniature(pdf);
    assert.ok(mini, "un scan donne sa page");
    const image = await loadImage(mini);
    assert.ok(image.height <= 480 && image.width <= 360);
  });

  /*
   * ================================================ TOUT PDF A SA PAGE
   *
   * Vu sur staging le 29 octobre 2026 : un PDF de 4,7 Mo (%PDF-1.7) rendait
   * 204, et la liste montrait une feuille esquissée au lieu de sa page. La
   * miniature ne venait que d'un PDF dont la page 1 ÉTAIT une seule image ;
   * un PDF de texte, ou un scan en plusieurs bandes, n'en avait aucune.
   */
  describe("rend la première page de tout PDF", () => {
    it("un PDF de texte seul : sa page, avec son encre, dans la boîte", async () => {
      const mini = await fabriquerMiniature(pdfDeTexte());
      assert.ok(mini, "un PDF de texte donne sa page");
      const { largeur, hauteur, sombres } = await lire(mini);
      assert.ok(largeur <= 360 && hauteur <= 480, `${largeur} × ${hauteur}`);
      // A4 dans 360 × 480 : la hauteur remplit la boîte.
      assert.equal(hauteur, 480);
      assert.ok(sombres > 500, `le texte est dessiné (${sombres} pixels d'encre)`);
    });

    it("un PDF de texte qui porte un logo : la page, pas le logo", async () => {
      const mini = await fabriquerMiniature(pdfAvecImage(await photo(200, 200), 200, 200, "logo"));
      assert.ok(mini);
      const { largeur, hauteur } = await lire(mini);
      assert.ok(hauteur > largeur, "la forme d'une page A4, pas celle d'un logo carré");
    });

    it("un scan en plusieurs images : la page entière", async () => {
      const haut = await photo(600, 424);
      const bas = await photo(600, 424);
      const mini = await fabriquerMiniature(
        unePage({
          contenu: "q 595 0 0 421 0 421 cm /Im1 Do Q q 595 0 0 421 0 0 cm /Im2 Do Q\n",
          ressources: "/XObject << /Im1 5 0 R /Im2 6 0 R >>",
          objets: [imageJpeg(haut, 600, 424), imageJpeg(bas, 600, 424)],
        }),
      );
      assert.ok(mini, "un scan en bandes donne sa page");
      const { largeur, hauteur } = await lire(mini);
      assert.ok(largeur <= 360 && hauteur <= 480 && hauteur > largeur);
    });

    it("un PDF chiffré, cassé ou sans page : rien, et c'est durable (pas d'exception)", async () => {
      const bruit = Buffer.alloc(4096);
      for (let i = 0; i < bruit.length; i += 1) bruit[i] = (i * 2654435761) >>> 24;
      for (const [nom, pdf] of [
        ["chiffré", pdfChiffre()],
        ["cassé", new Uint8Array(Buffer.concat([Buffer.from("%PDF-1.7\n"), bruit]))],
        ["sans page", unePage({ contenu: "", sansPage: true })],
      ] as const) {
        assert.equal(await fabriquerMiniature(pdf), null, nom);
      }
    });

    /*
     * Une page de 14 400 points de côté (le plus grand format permis) et une
     * image de 7 100 × 7 100 (plus de 50 mégapixels), noire, sur toute la
     * page. La miniature est faite à la taille de la boîte, jamais à celle
     * de la page ; et l'image, au-delà du plafond, n'est pas décodée : la
     * page reste BLANCHE. Décodée, elle serait noire.
     */
    it("une page immense : rendue dans la boîte, et l'image hors plafond jamais décodée", async () => {
      const cote = 7100;
      const noire = deflateSync(Buffer.alloc(Math.ceil(cote / 8) * cote));
      const t0 = Date.now();
      const mini = await fabriquerMiniature(
        unePage({
          boite: "0 0 14400 14400",
          contenu: "q 14400 0 0 14400 0 0 cm /Im1 Do Q\n",
          ressources: "/XObject << /Im1 5 0 R >>",
          objets: [
            [
              `<< /Type /XObject /Subtype /Image /Width ${cote} /Height ${cote} ` +
                `/ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /FlateDecode ` +
                `/Length ${noire.length} >>\nstream\n`,
              noire,
              "\nendstream",
            ],
          ],
        }),
      );
      assert.ok(mini);
      const { largeur, hauteur, sombres } = await lire(mini);
      assert.deepEqual([largeur, hauteur], [360, 360]);
      assert.equal(sombres, 0, "l'image au-delà du plafond n'a pas été décodée");
      assert.ok(Date.now() - t0 < 5000, `${Date.now() - t0} ms`);
    });

    /*
     * pdf.js 6 colle une image RGB par bandes, en un temps qui croît comme le
     * carré de sa hauteur (voir `elargirLesImagesRgb`). Une image haute de
     * 12 000 lignes y passait plusieurs secondes ; élargie en RGBA d'abord,
     * une fraction de seconde.
     */
    it("une image RGB très haute se rend en temps linéaire", async () => {
      const [largeur, hauteur] = [400, 12_000];
      const grise = deflateSync(Buffer.alloc(largeur * hauteur * 3, 0x40));
      const t0 = Date.now();
      const mini = await fabriquerMiniature(
        unePage({
          contenu: "q 595 0 0 842 0 0 cm /Im1 Do Q\n",
          ressources: "/XObject << /Im1 5 0 R >>",
          objets: [
            [
              `<< /Type /XObject /Subtype /Image /Width ${largeur} /Height ${hauteur} ` +
                `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode ` +
                `/Length ${grise.length} >>\nstream\n`,
              grise,
              "\nendstream",
            ],
          ],
        }),
      );
      const duree = Date.now() - t0;
      assert.ok(mini);
      assert.ok((await lire(mini)).sombres > 100_000, "l'image grise est dessinée");
      assert.ok(duree < 2500, `${duree} ms`);
    });

    /*
     * pdf.js travaille en microtâches : dans le fil de l'API, aucune minuterie
     * ne l'aurait interrompu. Le rendu tourne dans un fil à part, terminé à
     * son délai. Le délai est resserré ici, et le PDF porte assez de tracés
     * pour le dépasser.
     */
    it("un PDF trop lourd est arrêté à son délai : rien, sans attendre la fin", async () => {
      const delai = limitesDuRenduPdf.delaiMs;
      limitesDuRenduPdf.delaiMs = 100;
      try {
        const t0 = Date.now();
        const mini = await fabriquerMiniature(
          unePage({ contenu: "0 0 m 595 842 l 0 842 l h f\n".repeat(400_000) }),
        );
        assert.equal(mini, null);
        assert.ok(Date.now() - t0 < 2000, `${Date.now() - t0} ms`);
      } finally {
        limitesDuRenduPdf.delaiMs = delai;
      }
    });
  });

  /*
   * ============================================ L'ORIENTATION EXIF
   *
   * Un téléphone enregistre souvent la photo couchée et écrit dans l'EXIF
   * comment la redresser. Une miniature qui l'ignorerait montrerait la
   * facture de travers. Mesuré le 28 octobre 2026 : `@napi-rs/canvas`
   * applique le tag au décodage — aucun redressement n'est donc écrit dans
   * `miniature.ts`, et ces épreuves gardent ce fait sous surveillance.
   *
   * La photo source est faite de quatre quarts de couleur (rouge, bleu en
   * haut ; vert, jaune en bas) : la couleur des deux coins du haut de la
   * miniature dit, sans ambiguïté, laquelle des huit transformations a été
   * appliquée.
   */
  describe("redresse la photo selon son orientation EXIF", () => {
    async function quartiers(): Promise<Buffer> {
      const toile = createCanvas(200, 100);
      const ctx = toile.getContext("2d");
      for (const [couleur, x, y] of [
        ["#FF0000", 0, 0],
        ["#0000FF", 100, 0],
        ["#00FF00", 0, 50],
        ["#FFFF00", 100, 50],
      ] as const) {
        ctx.fillStyle = couleur;
        ctx.fillRect(x, y, 100, 50);
      }
      return toile.encode("jpeg", 95);
    }

    /** Un segment APP1 « Exif » minimal : un IFD0 qui ne porte que l'orientation. */
    function avecOrientation(jpeg: Buffer, orientation: number): Buffer {
      const tiff = Buffer.from([
        0x4d,
        0x4d,
        0x00,
        0x2a,
        0x00,
        0x00,
        0x00,
        0x08,
        0x00,
        0x01,
        0x01,
        0x12,
        0x00,
        0x03,
        0x00,
        0x00,
        0x00,
        0x01,
        0x00,
        orientation,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
      ]);
      const corps = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
      const longueur = corps.length + 2;
      const app1 = Buffer.from([0xff, 0xe1, longueur >> 8, longueur & 0xff]);
      return Buffer.concat([jpeg.subarray(0, 2), app1, corps, jpeg.subarray(2)]);
    }

    function couleurEn(ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>, x: number) {
      const [r, g, b] = ctx.getImageData(x, 5, 1, 1).data;
      const fort = (v: number | undefined) => (v ?? 0) > 160;
      if (fort(r) && fort(g) && !fort(b)) return "jaune";
      if (fort(r)) return "rouge";
      if (fort(g)) return "vert";
      if (fort(b)) return "bleu";
      return "?";
    }

    // [orientation, largeur, hauteur, coin haut-début, coin haut-fin]
    const attendus = [
      [1, 200, 100, "rouge", "bleu"],
      [2, 200, 100, "bleu", "rouge"],
      [3, 200, 100, "jaune", "vert"],
      [4, 200, 100, "vert", "jaune"],
      [5, 100, 200, "rouge", "vert"],
      [6, 100, 200, "vert", "rouge"],
      [7, 100, 200, "jaune", "bleu"],
      [8, 100, 200, "bleu", "jaune"],
    ] as const;

    for (const [orientation, largeur, hauteur, gauche, droite] of attendus) {
      it(`orientation ${orientation}`, async () => {
        const source = avecOrientation(await quartiers(), orientation);
        const mini = await fabriquerMiniature(new Uint8Array(source));
        assert.ok(mini);
        const image = await loadImage(mini);
        assert.deepEqual([image.width, image.height], [largeur, hauteur]);
        const toile = createCanvas(image.width, image.height);
        const ctx = toile.getContext("2d");
        ctx.drawImage(image, 0, 0);
        assert.deepEqual([couleurEn(ctx, 5), couleurEn(ctx, image.width - 6)], [gauche, droite]);
      });
    }
  });

  it("n'invente rien d'un contenu sans signature reconnue", async () => {
    assert.equal(await fabriquerMiniature(new Uint8Array([1, 2, 3, 4, 5])), null);
  });

  it("lit le format dans les octets : un WebP passe, comme un PNG", async () => {
    const toile = createCanvas(300, 400);
    toile.getContext("2d").fillRect(0, 0, 300, 400);
    for (const format of ["webp", "png"] as const) {
      const mini = await fabriquerMiniature(new Uint8Array(await toile.encode(format as "webp")));
      assert.ok(mini, format);
      assert.equal((await loadImage(mini)).width, 300);
    }
  });

  /*
   * ========================================== CE QUI NE DOIT PAS ENTRER
   *
   * Relu le 29 octobre 2026 : une SVG de 70 octets déclarant 200 000 × 200 000
   * abattait le processus de l'API (Skia, `tryAllocPixels`, assertion fatale
   * qu'aucun `try` ne rattrape). Avant la correction, l'épreuve SVG ci-dessous
   * ne rendait pas un échec : elle tuait le lanceur d'épreuves.
   */
  describe("refuse ce qui ferait tomber le décodeur", () => {
    it("une SVG, quelle que soit sa taille déclarée : jamais décodée", async () => {
      for (const svg of [
        '<svg xmlns="http://www.w3.org/2000/svg" width="200000" height="200000"/>',
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><image href="file:///etc/hostname" width="100" height="100"/></svg>',
      ]) {
        assert.equal(await fabriquerMiniature(new TextEncoder().encode(svg)), null);
      }
    });

    it("un PNG qui annonce 60 000 × 60 000 n'est pas décodé", async () => {
      const png = Buffer.from(await createCanvas(10, 10).encode("png"));
      png.writeUInt32BE(60_000, 16);
      png.writeUInt32BE(60_000, 20);
      const t0 = Date.now();
      assert.equal(await fabriquerMiniature(new Uint8Array(png)), null);
      assert.ok(Date.now() - t0 < 200, "refusé à l'en-tête, sans décodage");
    });

    it("un JPEG qui annonce 65 000 × 65 000 n'est pas décodé", async () => {
      const jpeg = Buffer.from(await photo(16, 16));
      // Le premier SOFn porte la hauteur en +5 et la largeur en +7.
      let i = 2;
      while (!(jpeg[i + 1]! >= 0xc0 && jpeg[i + 1]! <= 0xc3)) i += 2 + jpeg.readUInt16BE(i + 2);
      jpeg.writeUInt16BE(65_000, i + 5);
      jpeg.writeUInt16BE(65_000, i + 7);
      assert.equal(await fabriquerMiniature(new Uint8Array(jpeg)), null);
    });

    it("un PNG annoncé en tête d'un en-tête tronqué n'est pas décodé", async () => {
      const tronque = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
      assert.equal(await fabriquerMiniature(tronque), null);
    });
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
  /** Un PDF de texte : sa page se rend. */
  let texte = "";
  /** Un PDF chiffré : aucune miniature à en tirer. */
  let chiffre = "";

  const admin = async <T>(f: (p: pg.Pool) => Promise<T>) => {
    const p = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
    try {
      return await f(p);
    } finally {
      await p.end();
    }
  };

  const entetes = (qui: Utilisateur) => ({
    Authorization: `Bearer ${emettreJeton(qui, new Date())}`,
  });

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
    texte = await deposer(dirigeant, "texte", "entite", "application/pdf", pdfDeTexte());
    chiffre = await deposer(dirigeant, "chiffre", "entite", "application/pdf", pdfChiffre());
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

  it("un PDF de texte a sa miniature : sa page, en JPEG", async () => {
    const reponse = await fetch(`${base}/pieces/${texte}/miniature`, {
      headers: entetes(dirigeant),
    });
    assert.equal(reponse.status, 200);
    assert.equal(reponse.headers.get("content-type"), "image/jpeg");
    await reponse.arrayBuffer();
  });

  it("un PDF chiffré n'a pas de miniature : 204, gardé, jamais refait", async () => {
    const espion = mock.method(fabrique, "miniature");
    try {
      const reponse = await fetch(`${base}/pieces/${chiffre}/miniature`, {
        headers: entetes(dirigeant),
      });
      assert.equal(reponse.status, 204);
      // Le constat est gardé : la deuxième demande ne relit pas le PDF.
      const encore = await fetch(`${base}/pieces/${chiffre}/miniature`, {
        headers: entetes(dirigeant),
      });
      assert.equal(encore.status, 204);
      assert.equal(espion.mock.callCount(), 1);
    } finally {
      espion.mock.restore();
    }
  });

  /*
   * Avant le rendu des PDF, un PDF de texte gardait « pas de miniature » : un
   * fichier VIDE à la place de la miniature. Après le déploiement, ces
   * constats-là sont périmés et la miniature se refait à la demande suivante.
   */
  it("un « pas de miniature » gardé avant le rendu des PDF se refait", async () => {
    const ancien = await deposer(
      dirigeant,
      "ancien-vide",
      "entite",
      "application/pdf",
      pdfDeTexte(),
    );
    await writeFile(miniatureSurDisque(ancien), Buffer.alloc(0));
    const reponse = await demander(ancien);
    assert.equal(reponse.status, 200);
    assert.equal(reponse.headers.get("content-type"), "image/jpeg");
    await reponse.arrayBuffer();
    const gardee = await readFile(miniatureSurDisque(ancien));
    assert.deepEqual([...gardee.subarray(0, 3)], [0xff, 0xd8, 0xff], "un JPEG, gardé à sa place");
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

  /** Une pièce neuve, sans miniature encore : chaque épreuve de charge a la sienne. */
  const neuve = async (cle: string) =>
    deposer(dirigeant, cle, "entite", "image/jpeg", new Uint8Array(await photo()));
  const demander = (id: string) =>
    fetch(`${base}/pieces/${id}/miniature`, { headers: entetes(dirigeant) });
  const miniatureSurDisque = (id: string) => path.join(racineEssai, pme, `${id}.miniature.jpg`);

  /*
   * ============================================ AVEC LES VERSIONS (LOT 1)
   *
   * « Reprendre la photo » remplace : la nouvelle prend la place de
   * l'ancienne, qui reste comme version précédente (`pieces_v.remplacee_par`).
   * La miniature suit la pièce sur les trois points où une version change
   * quelque chose : les listes, les droits de lecture, l'effacement.
   */
  async function reprendre(ancienne: string, cle: string): Promise<string> {
    const p = (await sousIdentiteDuServeur(dirigeant.id, (db) =>
      executerRpc(
        db,
        {
          depot: "capture",
          methode: "enregistrer",
          args: [
            {
              tenantId: pme,
              source: "photo",
              vis: "entite",
              idempotencyKey: `${marque}-${cle}`,
              contentType: "image/jpeg",
              pageCount: 1,
              remplace: ancienne,
            },
          ],
        },
        "serveur",
      ),
    )) as { id: string };
    const depot = await fetch(`${base}/pieces/${p.id}/contenu`, {
      method: "POST",
      headers: { ...entetes(dirigeant), "Content-Type": "image/jpeg" },
      body: new Uint8Array(await photo(900, 1200)),
    });
    assert.equal(depot.status, 201);
    return p.id;
  }

  it("une version précédente ne paraît dans aucune liste (Vos documents, Mon espace)", async () => {
    const ancienne = await neuve("v-liste");
    const nouvelle = await reprendre(ancienne, "v-liste-reprise");
    const lues = (await sousIdentiteDuServeur(dirigeant.id, (db) =>
      executerRpc(db, { depot: "capture", methode: "listAvecLecture", args: [pme] }, "serveur"),
    )) as { id: string }[];
    const ids = lues.map((p) => p.id);
    assert.ok(ids.includes(nouvelle));
    assert.ok(!ids.includes(ancienne), "la version précédente n'a pas de miniature de liste");
  });

  it("la miniature d'une version suit les droits de ses octets, à la lettre", async () => {
    const ancienne = await neuve("v-droits");
    const nouvelle = await reprendre(ancienne, "v-droits-reprise");
    for (const qui of [dirigeant, siege, tiers]) {
      for (const id of [ancienne, nouvelle]) {
        const octets = await fetch(`${base}/pieces/${id}/contenu`, { headers: entetes(qui) });
        const mini = await fetch(`${base}/pieces/${id}/miniature`, { headers: entetes(qui) });
        await octets.arrayBuffer();
        await mini.arrayBuffer();
        // Lisible : 200 des deux côtés ; illisible : 404 des deux côtés.
        assert.equal(
          mini.status === 404,
          octets.status === 404,
          `${qui === tiers ? "tiers" : qui === siege ? "siège" : "dirigeant"} sur ${
            id === ancienne ? "l'ancienne" : "la nouvelle"
          } : octets ${octets.status}, miniature ${mini.status}`,
        );
      }
    }
    assert.equal(
      (await fetch(`${base}/pieces/${ancienne}/miniature`, { headers: entetes(tiers) })).status,
      404,
    );
  });

  it("effacer la pièce efface la miniature de chacune de ses versions", async () => {
    const ancienne = await neuve("v-efface");
    assert.equal((await demander(ancienne)).status, 200);
    const nouvelle = await reprendre(ancienne, "v-efface-reprise");
    assert.equal((await demander(nouvelle)).status, 200);
    await access(miniatureSurDisque(ancienne));
    await access(miniatureSurDisque(nouvelle));

    const supprimee = await sousIdentiteDuServeur(dirigeant.id, (db) =>
      executerRpc(db, { depot: "capture", methode: "supprimer", args: [nouvelle] }, "serveur"),
    );
    assert.equal(supprimee, true);
    for (const id of [ancienne, nouvelle]) {
      await assert.rejects(access(miniatureSurDisque(id)), `miniature de ${id} restée`);
      await assert.rejects(access(path.join(racineEssai, pme, id)), `octets de ${id} restés`);
    }
  });

  it("vingt demandes simultanées de la même pièce : une seule fabrication", async () => {
    const id = await neuve("meme");
    const espion = mock.method(fabrique, "miniature");
    try {
      const reponses = await Promise.all(Array.from({ length: 20 }, () => demander(id)));
      assert.deepEqual(new Set(reponses.map((r) => r.status)), new Set([200]));
      assert.equal(espion.mock.callCount(), 1);
    } finally {
      espion.mock.restore();
    }
  });

  it("vingt pièces différentes à la fois : jamais plus de deux fabrications", async (t) => {
    const ids = await Promise.all(Array.from({ length: 20 }, (_, i) => neuve(`charge-${i}`)));
    const original = fabrique.miniature;
    let enCours = 0;
    let pic = 0;
    const espion = mock.method(fabrique, "miniature", async (octets: Uint8Array) => {
      enCours += 1;
      pic = Math.max(pic, enCours);
      try {
        return await original(octets);
      } finally {
        enCours -= 1;
      }
    });
    try {
      const t0 = performance.now();
      const reponses = await Promise.all(ids.map((id) => demander(id)));
      const duree = Math.round(performance.now() - t0);
      assert.deepEqual(new Set(reponses.map((r) => r.status)), new Set([200]));
      assert.equal(espion.mock.callCount(), 20);
      assert.ok(pic <= 2, `pic de ${pic} fabrications simultanées`);
      // Rendre ensuite les vingt, déjà gardées, ne refabrique rien.
      const t1 = performance.now();
      await Promise.all(ids.map((id) => demander(id)));
      const dureeGardees = Math.round(performance.now() - t1);
      assert.equal(espion.mock.callCount(), 20);
      t.diagnostic(
        `20 miniatures neuves (photos 1200×1600) : ${duree} ms, pic ${pic} ; ` +
          `les mêmes, gardées : ${dureeGardees} ms`,
      );
    } finally {
      espion.mock.restore();
    }
  });

  it("une pièce supprimée PENDANT la fabrication ne laisse pas de miniature", async () => {
    const id = await neuve("supprimee-pendant");
    const original = fabrique.miniature;
    let lacher: () => void = () => {};
    const lachee = new Promise<void>((r) => (lacher = r));
    let entree: () => void = () => {};
    const entreeFaite = new Promise<void>((r) => (entree = r));
    const espion = mock.method(fabrique, "miniature", async (octets: Uint8Array) => {
      entree();
      await lachee;
      return original(octets);
    });
    try {
      const reponse = demander(id);
      await entreeFaite;
      const supprimee = await sousIdentiteDuServeur(dirigeant.id, (db) =>
        executerRpc(db, { depot: "capture", methode: "supprimer", args: [id] }, "serveur"),
      );
      assert.equal(supprimee, true);
      lacher();
      assert.equal((await reponse).status, 404);
      await assert.rejects(access(miniatureSurDisque(id)));
    } finally {
      espion.mock.restore();
    }
  });

  /*
   * Relu par Codex sur la PR #128 : la source était lue AVANT d'attendre son
   * tour de décodage. Deux décodeurs permis, vingt demandes : vingt photos
   * entières en mémoire à la fois (jusqu'à 40 Mio chacune). Le sémaphore ne
   * bornait que le décodage, pas la mémoire.
   */
  it("vingt pièces à la fois : jamais plus de deux sources en mémoire", async () => {
    const ids = await Promise.all(Array.from({ length: 20 }, (_, i) => neuve(`memoire-${i}`)));
    const original = fabrique.miniature;
    const lire = disque.lire;
    let tenues = 0;
    let pic = 0;
    const lecture = mock.method(disque, "lire", async (chemin: string) => {
      const octets = await lire(chemin);
      tenues += 1;
      pic = Math.max(pic, tenues);
      return octets;
    });
    const decodage = mock.method(fabrique, "miniature", async (octets: Uint8Array) => {
      try {
        // Un décodage lent : les demandes s'empilent pendant qu'il tourne.
        await new Promise((r) => setTimeout(r, 30));
        return await original(octets);
      } finally {
        tenues -= 1;
      }
    });
    try {
      const reponses = await Promise.all(ids.map((id) => demander(id)));
      assert.deepEqual(new Set(reponses.map((r) => r.status)), new Set([200]));
      assert.equal(lecture.mock.callCount(), 20);
      assert.ok(pic <= 2, `${pic} sources tenues en mémoire à la fois`);
    } finally {
      lecture.mock.restore();
      decodage.mock.restore();
    }
  });

  /*
   * Relu par Codex sur la PR #128 : un échec passager rendait le même 204
   * qu'un document SANS miniature, et l'écran le gardait pour toujours.
   */
  it("un échec passager rend 503, sans rien garder ; la demande suivante réussit", async () => {
    const id = await neuve("passager");
    const espion = mock.method(fabrique, "miniature", async () => {
      throw new Error("mémoire insuffisante, un instant");
    });
    try {
      const reponse = await demander(id);
      assert.equal(reponse.status, 503);
      assert.deepEqual(await reponse.json(), { erreur: "miniature.indisponible" });
      await assert.rejects(access(miniatureSurDisque(id)));
      const restes = (await readdir(path.join(racineEssai, pme))).filter((f) =>
        f.endsWith(".partiel"),
      );
      assert.deepEqual(restes, []);
    } finally {
      espion.mock.restore();
    }
    assert.equal((await demander(id)).status, 200);
  });
});
