/**
 * Le sudoku, sous de vraies identités — pas en superutilisateur.
 *
 * Ce que le banc du moteur ne voit pas : qui peut lire la grille, qui peut
 * écrire ce que le sudoku a lu, et qui peut le relire. Tout passe par les
 * vraies portes (`executerRpc`), sous l'identité d'une personne d'une société
 * d'essai, et sous celle d'un inconnu.
 *
 *   — la grille et le pack se lisent par les vues, AU JOUR de la pièce, et le
 *     mode vient du réglage du dossier ;
 *   — un navigateur n'atteint ni le contexte ni l'inscription (méthodes du serveur) ;
 *   — un client ne peut ni insérer directement, ni appeler la porte hors serveur ;
 *   — le serveur inscrit par la porte : la grille et ses champs résolus à la
 *     date de la pièce, le rang et le taux dans leurs colonnes, une inscription
 *     sous un seul `lecture_id` ; seule la société relit ses champs ;
 *   — une valeur sans citation, un statut nul, un champ ou une grille inconnus
 *     sont refusés par la porte, et la table elle-même les refuse ;
 *   — ce qui est inscrit ne se réécrit pas (R7).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte } from "./auth.ts";
import { BASE_CONFIGUREE, monterUneSociete, type SocieteDEssai } from "./circuit-d-essai.ts";
import { sousIdentite, sousIdentiteDuServeur } from "./db.ts";
import type { ChampsLusAInscrire, ContexteDuSudokuBranche } from "./malica/lecture/sudoku.ts";
import { executerRpc } from "./rpc.ts";

describe("le sudoku s'inscrit par sa porte", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `sudoku-${Date.now()}`;
  /** Le jour de la pièce : les règles s'y lisent. */
  const JOUR = "2026-09-15";
  let s: SocieteDEssai;
  let admin: pg.Pool;
  let piece = "";
  let inconnu = "";

  const serveur = (qui: string, methode: string, ...args: unknown[]) =>
    sousIdentiteDuServeur(qui, (db) =>
      executerRpc(db, { depot: "capture", methode, args }, "serveur"),
    );

  const lecture = (champs: ChampsLusAInscrire["champs"], autre: Partial<ChampsLusAInscrire> = {}) =>
    ({
      pieceId: piece,
      packId: s.pack,
      jour: JOUR,
      grille: "facture",
      issue: "ambigue",
      champs,
      ...autre,
    }) satisfies ChampsLusAInscrire;

  const ligne = (
    champ: string | null,
    valeur: string | null,
    statut: string | null,
    citations: ChampsLusAInscrire["champs"][number]["citations"] = [],
    place: { rang?: number; instance?: string } = {},
  ) => ({
    champ,
    rang: place.rang ?? null,
    instance: place.instance ?? null,
    valeur,
    statut,
    citations,
  });

  const cite = [{ page: 1, ordinal: 3 }];
  const champs = [
    ligne("total_ht", null, "signale"),
    ligne("droit_timbre", "1000", "prouve", cite),
    ligne("montant_tva_par_taux", "190000", "prouve", [{ page: 1, ordinal: 5 }], {
      instance: "TVA19",
    }),
    ligne("quantite", "3000", "prouve", [{ page: 1, ordinal: 9 }], { rang: 3 }),
  ];

  before(async () => {
    admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
    s = await monterUneSociete(marque);
    piece = await s.deposer("amel", "entite");
    const u = await creerCompte(`${marque}-inconnu@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(u);
    inconnu = u.id;
  });
  after(async () => {
    await s.fermer();
    await admin.end();
  });

  it("la grille et le pack se lisent au jour de la pièce, et le mode vient du réglage", async () => {
    const c = (await serveur(
      s.gens.amel.id,
      "contexteSudoku",
      s.pme,
      s.pack,
      "facture",
      "TND",
      JOUR,
    )) as ContexteDuSudokuBranche;
    assert.equal(c.jour, JOUR);
    assert.ok(c.grille.champs.length > 0, "les champs de la grille");
    assert.ok(
      c.grille.preuves.some((p) => (p.expression as { op?: string }).op === "somme"),
      "une preuve exécutable",
    );
    assert.ok(c.pack.baremes["tva"]!.length > 0, "le barème de TVA du pack");
    assert.ok(
      c.pack.charges.some((ch) => ch.montant_fixe !== null),
      "un droit fixe du pack",
    );
    // Le défaut du pack : il observe.
    assert.equal(c.mode, "observe");
    // Avant la date d'effet de la grille, rien n'est en vigueur : le jour est lu, pas la date du jour.
    await assert.rejects(
      serveur(s.gens.amel.id, "contexteSudoku", s.pme, s.pack, "facture", "TND", "2020-06-01"),
      /0 en vigueur/,
    );
  });

  it("un navigateur n'atteint ni le contexte ni l'inscription", async () => {
    for (const methode of ["contexteSudoku", "inscrireChampsLus"]) {
      await assert.rejects(
        s.fait("amel", `capture.${methode}`, lecture(champs)),
        /méthode inconnue/,
      );
    }
  });

  it("un client n'insère pas directement, ni n'appelle la porte hors serveur", async () => {
    await assert.rejects(
      sousIdentite(s.gens.amel.id, (db) =>
        db.query(
          `insert into capture.champs_lus
             (tenant_id, piece_id, lecture_id, champ_code, statut, issue)
           values ($1, $2, gen_random_uuid(), 'total_ht', 'prouve', 'prouvee')`,
          [s.pme, piece],
        ),
      ),
      /permission denied|42501/,
    );
    await assert.rejects(
      sousIdentite(s.gens.amel.id, (db) =>
        db.query(
          `select public.capture_champs_lus_inscrire($1, $2, $3::date, 'facture', 'prouvee', $4::jsonb)`,
          [piece, s.pack, JOUR, JSON.stringify(champs)],
        ),
      ),
      /refus\.reserve\.serveur/,
    );
  });

  it("le serveur inscrit par la porte : grille et champs résolus, rang et taux en colonne", async () => {
    const r = (await serveur(s.gens.amel.id, "inscrireChampsLus", lecture(champs))) as {
      inscrits: number;
    };
    assert.equal(r.inscrits, 4);
    // Une seconde inscription : un autre lecture_id, commun à toutes ses lignes.
    await serveur(s.gens.amel.id, "inscrireChampsLus", lecture([ligne(null, null, null)]));

    const relus = (qui: string) =>
      sousIdentiteDuServeur(qui, async (db) => {
        const { rows } = await db.query<{
          lecture_id: string;
          champ_code: string | null;
          rang: number | null;
          instance: string | null;
          valeur: string | null;
          resolu: boolean;
        }>(
          `select l.lecture_id, l.champ_code, l.rang, l.instance, l.valeur,
                  (l.grille_champ_id is not null and gc.code = l.champ_code
                   and g.code = 'facture' and g.valid_from <= $2::date) as resolu
             from capture.champs_lus l
             join ref.grilles g on g.id = l.grille_id
             left join ref.grille_champs gc on gc.id = l.grille_champ_id
            where l.piece_id = $1
            order by l.created_at, l.champ_code nulls last, l.rang`,
          [piece, JOUR],
        );
        return rows;
      });
    const lus = await relus(s.gens.amel.id);
    assert.deepEqual(
      lus.map((x) => [x.champ_code, x.rang, x.instance, x.valeur, x.resolu]),
      [
        ["droit_timbre", null, null, "1000", true],
        ["montant_tva_par_taux", null, "TVA19", "190000", true],
        ["quantite", 3, null, "3000", true],
        ["total_ht", null, null, null, true],
        [null, null, null, null, false],
      ],
    );
    assert.equal(new Set(lus.slice(0, 4).map((x) => x.lecture_id)).size, 1);
    assert.notEqual(lus[4]!.lecture_id, lus[0]!.lecture_id);
    assert.deepEqual(await relus(inconnu), [], "un inconnu ne relit rien");
  });

  it("une valeur sans citation, un statut nul, une saisie mal formée : refusés", async () => {
    const refuse = (champs: ChampsLusAInscrire["champs"], autre = {}) =>
      assert.rejects(
        serveur(s.gens.amel.id, "inscrireChampsLus", lecture(champs, autre)),
        /refus\.saisie\.mal_formee/,
      );
    await refuse([ligne("total_ht", "1000", "prouve", [])]);
    await refuse([ligne("total_ht", null, null)]);
    await refuse([ligne(null, "1000", null, cite)]);
    await refuse([ligne("quantite", "1", "prouve", cite, { rang: 0 })]);
    await refuse([]);
    await refuse(champs, { issue: "peut-etre" });
    // Et la table elle-même, même en superutilisateur : la contrainte tient.
    await assert.rejects(
      admin.query(
        `insert into capture.champs_lus
           (tenant_id, piece_id, lecture_id, grille_id, grille_code, grille_champ_id, champ_code,
            valeur, statut, citations, issue)
         select $1, $2, gen_random_uuid(), g.id, g.code, gc.id, gc.code, '1000', 'prouve',
                '[]'::jsonb, 'prouvee'
           from ref.grilles g join ref.grille_champs gc on gc.grille_id = g.id
          where g.pack_version_id = $3 and g.code = 'facture' and gc.code = 'total_ht'`,
        [s.pme, piece, s.pack],
      ),
      /champs_lus_valeur_citee/,
    );
  });

  it("un champ ou une grille inconnus, ou une grille hors de sa date : refusés", async () => {
    const refuse = (champs: ChampsLusAInscrire["champs"], autre = {}) =>
      assert.rejects(
        serveur(s.gens.amel.id, "inscrireChampsLus", lecture(champs, autre)),
        /refus\.lecture\.champ_inconnu/,
      );
    await refuse([ligne("champ_qui_n_existe_pas", null, "signale")]);
    await refuse(champs, { grille: "grille_qui_n_existe_pas" });
    await refuse(champs, { jour: "2020-06-01" });
  });

  it("un inconnu n'inscrit pas sur la pièce d'une autre société, et n'en relit rien", async () => {
    await assert.rejects(
      serveur(inconnu, "inscrireChampsLus", lecture(champs)),
      /refus\.introuvable\.piece/,
    );
  });

  it("ce qui est inscrit ne se réécrit pas, ne s'efface pas (R7)", async () => {
    for (const geste of [
      `update capture.champs_lus set valeur = '0' where piece_id = $1`,
      `delete from capture.champs_lus where piece_id = $1`,
    ]) {
      await assert.rejects(
        sousIdentiteDuServeur(s.gens.amel.id, (db) => db.query(geste, [piece])),
        /permission denied|42501|refus/i,
      );
    }
    // Même en superutilisateur, le déclencheur refuse la réécriture.
    await assert.rejects(
      admin.query(`update capture.champs_lus set valeur = '0' where piece_id = $1`, [piece]),
      /refus|interdit|R7|mutation/i,
    );
  });
});
