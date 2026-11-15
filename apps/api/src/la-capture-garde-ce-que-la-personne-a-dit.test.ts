/**
 * La capture garde ce que la personne a dit (recette du 13 novembre 2026).
 *
 * Trois faits que l'écran de capture a perdus, et que la base doit porter pour
 * qu'il ne les perde plus :
 *
 *  - G2 · une pièce « Pour moi », rangée dans un rayon et gardée, n'est vue de
 *    personne d'autre — ni le dirigeant, ni un autre siège, ni le comptable —
 *    et aucune lecture ne s'y consomme. Le rayon par défaut est « autres » ;
 *  - G5 · la liste dit si la société a une comptabilité (un mandat en vigueur) :
 *    sans elle, « À envoyer » n'a pas de destinataire, et le statut le sait ;
 *  - G6c · le type déclaré à l'import revient à l'étape « Vérifier » quand la
 *    lecture n'en dit pas.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/la-capture-garde-ce-que-la-personne-a-dit.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { BASE_CONFIGUREE, monterUneSociete, type SocieteDEssai } from "./circuit-d-essai.ts";
import { fermerLePool, sousIdentiteDuServeur } from "./db.ts";
import { lireLaPieceDEssai } from "./lecture-d-essai.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";

interface LignePiece {
  id: string;
  vis: string;
  status: string;
  gardeeLe: string | null;
  kind: string | null;
  comptabilite?: boolean;
}

describe("la capture garde ce que la personne a dit", { skip: !BASE_CONFIGUREE }, () => {
  let s: SocieteDEssai;
  let seule = "";
  const marque = `capture-dit-${Date.now()}`;
  let n = 0;

  const deposerAvecType = async (organisation: string, qui: "sami", type: string | null) => {
    const p = (await s.fait(qui, "capture.enregistrer", {
      tenantId: organisation,
      source: "photo",
      vis: "entite",
      idempotencyKey: `${marque}-${type ?? "sans"}-${++n}`,
      contentType: "image/jpeg",
      pageCount: 1,
      documentKind: type,
    })) as { id: string };
    return p.id;
  };

  before(async () => {
    s = await monterUneSociete(marque);
    // Une seconde société de la même personne, sans mandat : Basic, sans comptabilité.
    seule = await sousIdentiteDuServeur(s.gens.amel.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', $1, 'autonome', $2, 'TN', 'TND') as id`,
        [`SANS COMPTA ${marque}`, matriculeDEssai()],
      );
      return rows[0]!.id;
    });
  });

  after(async () => {
    await s.admin.query(
      `update identity.organizations set archived_at = now(),
              archived_reason = 'fixture de test automatisé' where id = $1`,
      [seule],
    );
    await s.fermer();
    await fermerLePool();
  });

  describe("G2 · une pièce « Pour moi » reste à soi, rangée dans « autres », jamais lue", () => {
    let privee = "";

    before(async () => {
      privee = await s.deposer("amel", "personnel");
      // Le propriétaire (seul à pouvoir « garder ») fait le choix « Pour moi » ;
      // ce que l'écran inscrit DÈS ce choix, avant le rayon.
      await s.fait("amel", "capture.rangerPrive", privee, "autres", null);
      await s.fait("amel", "collab.garderPiece", privee);
    });

    it("elle est gardée, privée, rangée dans « autres » — et son auteur la lit", async () => {
      const liste = (await s.fait("amel", "capture.listAvecLecture", s.pme)) as LignePiece[];
      const p = liste.find((x) => x.id === privee);
      assert.ok(p, "son auteur la retrouve");
      assert.equal(p.vis, "personnel");
      assert.equal(p.status, "capturee", "jamais lue");
      assert.ok(p.gardeeLe, "la décision est inscrite : l'écran ne la repose pas");
      const rangements = (await s.fait("amel", "capture.mesRangementsPrives", s.pme)) as Array<{
        pieceId: string;
        rayon: string;
      }>;
      assert.equal(rangements.find((r) => r.pieceId === privee)?.rayon, "autres");
    });

    for (const qui of ["bilel", "sami", "sonia", "expert"] as const) {
      it(`${qui} ne la voit pas, ni sa lecture`, async () => {
        const liste = (await s
          .fait(qui, "capture.listAvecLecture", s.pme)
          .catch(() => [])) as LignePiece[];
        assert.equal(
          liste.find((x) => x.id === privee),
          undefined,
        );
        const { rows } = await sousIdentiteDuServeur(s.gens[qui].id, (db) =>
          db.query<{ n: string }>(
            `select (select count(*) from capture.pieces where id = $1)
                  + (select count(*) from capture.extractions where piece_id = $1) as n`,
            [privee],
          ),
        );
        assert.equal(Number(rows[0]!.n), 0);
        await assert.rejects(
          sousIdentiteDuServeur(s.gens[qui].id, (db) =>
            db.query("select public.lecture_autorisee($1)", [privee]),
          ),
          /refus\.introuvable\.piece$/,
        );
      });
    }

    it("aucune lecture ne s'y consomme : ni lecture, ni travail", async () => {
      const { rows } = await s.admin.query<{ n: string }>(
        `select (select count(*) from capture.extractions where piece_id = $1)
              + (select count(*) from fabrique.travaux where piece_id = $1) as n`,
        [privee],
      );
      assert.equal(Number(rows[0]!.n), 0);
    });
  });

  describe("G5 · la liste dit si la société a une comptabilité", () => {
    it("avec un mandat en vigueur : comptabilité = vrai", async () => {
      const id = await s.deposer("sami", "entite");
      const liste = (await s.fait("amel", "capture.listAvecLecture", s.pme)) as LignePiece[];
      assert.equal(liste.find((x) => x.id === id)?.comptabilite, true);
    });

    it("sans mandat : comptabilité = faux, et la pièce n'a nulle part où partir", async () => {
      const p = (await s.fait("amel", "capture.enregistrer", {
        tenantId: seule,
        source: "photo",
        vis: "entite",
        idempotencyKey: `${marque}-seule`,
        contentType: "image/jpeg",
        pageCount: 1,
      })) as { id: string };
      const liste = (await s.fait("amel", "capture.listAvecLecture", seule)) as LignePiece[];
      assert.equal(liste.find((x) => x.id === p.id)?.comptabilite, false);
    });
  });

  describe("G6c · le type déclaré à l'import revient à « Vérifier »", () => {
    it("la lecture ne dit rien : le type choisi à l'import est rendu", async () => {
      const id = await deposerAvecType(s.pme, "sami", "facture_vente");
      await sousIdentiteDuServeur(s.gens.sami.id, (db) => lireLaPieceDEssai(db, id, {}));
      const liste = (await s.fait("amel", "capture.listAvecLecture", s.pme)) as LignePiece[];
      assert.equal(liste.find((x) => x.id === id)?.kind, "facture_vente");
    });

    it("la lecture tranche quand elle sait : le type déclaré n'est qu'une intention", async () => {
      const id = await deposerAvecType(s.pme, "sami", "facture_vente");
      await sousIdentiteDuServeur(s.gens.sami.id, (db) =>
        lireLaPieceDEssai(db, id, { document_kind: "facture_achat" }),
      );
      const liste = (await s.fait("amel", "capture.listAvecLecture", s.pme)) as LignePiece[];
      assert.equal(liste.find((x) => x.id === id)?.kind, "facture_achat");
    });
  });
});
