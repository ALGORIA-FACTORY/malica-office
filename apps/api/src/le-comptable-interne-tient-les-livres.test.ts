/**
 * Le comptable interne tient les livres de sa société (décision du dirigeant
 * du 12 novembre 2026, point 7.2).
 *
 * Un salarié comptable est un MEMBRE de la société, au rôle « comptable ». Il
 * a les droits de travail d'une comptabilité sur CETTE société, jamais
 * l'abonnement, les places ni les sociétés, jamais le Privé des autres. Sa
 * place est comprise dans chaque offre, dès Basic, hors des places payantes.
 *
 * Qui valide (règle par défaut, à confirmer par le dirigeant) : sans
 * comptabilité externe, le comptable interne ; avec un mandat externe actif,
 * la comptabilité externe — le comptable interne prépare seulement.
 *
 * Tout passe par les vraies portes, sous l'identité de chacun (R6) : la base
 * décide, l'API ne filtre rien.
 *
 *   node --experimental-strip-types --test src/le-comptable-interne-tient-les-livres.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import type { MonAcces, PieceLue, PlaceComptable } from "@malica/socle/ports/repositories";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { BASE_CONFIGUREE, monterUneSociete, type SocieteDEssai } from "./circuit-d-essai.ts";
import { fermerLePool, sousIdentiteDuServeur } from "./db.ts";
import { identite } from "./depots/identite.ts";
import { lireLaPieceDEssai } from "./lecture-d-essai.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";
import { executerRpc } from "./rpc.ts";

const MOT_DE_PASSE = "MotDePasseTresLong2026!";

/** Le code d'un refus de la base, tel que l'API le rend. */
async function refus(promesse: Promise<unknown>): Promise<string> {
  try {
    await promesse;
  } catch (e) {
    return (e as Error).message;
  }
  return "accepte";
}

describe("le comptable interne tient les livres", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `comptable-interne-${Date.now()}`;
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
  let dirigeant: Utilisateur;
  let comptable: Utilisateur;
  let second: Utilisateur;
  let pme = "";
  let autre = "";
  let pack = "";
  const motifs: Record<string, string> = {};
  /** La société confiée à une comptabilité externe, avec son comptable interne. */
  let externe: SocieteDEssai;
  let comptableDeLExterne: Utilisateur;

  const fait = (u: Utilisateur, methode: string, ...args: unknown[]) => {
    const [depot, nom] = methode.split(".") as [string, string];
    return sousIdentiteDuServeur(u.id, (db) => executerRpc(db, { depot, methode: nom, args }));
  };
  const lit = (u: Utilisateur, table: string, id: string, colonne = "id") =>
    sousIdentiteDuServeur(u.id, async (db) => {
      const { rows } = await db.query(`select 1 from ${table} where ${colonne} = $1`, [id]);
      return rows.length > 0;
    });

  let n = 0;
  const deposer = async (u: Utilisateur, tenantId: string, vis: "personnel" | "entite") => {
    n += 1;
    const p = (await fait(u, "capture.enregistrer", {
      tenantId,
      source: "photo",
      vis,
      idempotencyKey: `${marque}-${n}`,
      contentType: "image/jpeg",
      pageCount: 1,
    })) as { id: string };
    await sousIdentiteDuServeur(u.id, (db) => lireLaPieceDEssai(db, p.id));
    return p.id;
  };

  /** Le type établi, une écriture proposée : ce que prépare une comptabilité. */
  const preparer = async (u: Utilisateur, pieceId: string) => {
    await sousIdentiteDuServeur(u.id, (db) =>
      db.query(`select public.piece_type_etabli_par_le_cabinet($1)`, [pieceId]),
    );
    return (await fait(u, "office.propose", {
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
    })) as string;
  };

  /** Le propriétaire invite, le comptable accepte : la place « comptable ». */
  const embaucher = async (proprietaire: Utilisateur, u: Utilisateur, tenantId: string) => {
    await fait(proprietaire, "facturation.inviterComptableInterne", u.email, tenantId);
    const recues = (await fait(u, "collab.invitationsPourMoi")) as Array<{
      id: string;
      cabinetTenantId: string;
      role: string;
    }>;
    const inv = recues.find((i) => i.cabinetTenantId === tenantId);
    assert.ok(inv, "l'invitation arrive au comptable");
    assert.equal(inv.role, "comptable");
    await fait(u, "collab.repondreAInvitation", inv.id, true);
  };

  before(async () => {
    const compte = async (qui: string, prenom: string) => {
      const u = await creerCompte(`${marque}-${qui}@essai.local`, MOT_DE_PASSE);
      assert.ok(u, qui);
      await sousIdentiteDuServeur(u.id, (db) => identite.ecrireMonProfil(db, prenom, "Essai"));
      return u;
    };
    dirigeant = await compte("dirigeant", "Hela");
    comptable = await compte("comptable", "Nour");
    second = await compte("second", "Omar");
    comptableDeLExterne = await compte("comptable-externe", "Rim");

    const creer = (u: Utilisateur, nom: string) =>
      sousIdentiteDuServeur(u.id, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `select public.create_organization('pme', $1, 'autonome', $2, 'TN', 'TND') as id`,
          [nom, matriculeDEssai()],
        );
        return rows[0]!.id;
      });
    // Une société en Basic, sans comptabilité externe.
    pme = await creer(dirigeant, `SOCIETE ${marque}`);
    // Une autre société, que le comptable ne tient pas.
    autre = await creer(second, `AUTRE ${marque}`);

    pack = (
      await admin.query<{ id: string }>(
        `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
          order by effective_from desc limit 1`,
      )
    ).rows[0]!.id;
    for (const m of (
      await admin.query<{ id: string; code: string }>(
        `select id, code from ref.rejet_motifs where usage = 'retour'`,
      )
    ).rows)
      motifs[m.code] = m.id;

    externe = await monterUneSociete(`${marque}-ext`);
  });

  after(async () => {
    try {
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = any($1::uuid[]) and archived_at is null`,
        [[pme, autre]],
      );
      await externe?.fermer();
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  /* ============================================ 1 · LA PLACE « COMPTABLE » */

  it("chaque offre de la grille comprend au moins une place « comptable »", async () => {
    const { rows } = await admin.query<{ code: string; n: number }>(
      `select distinct on (code) code, places_comptable_incluses as n
         from ref.offres where effective_from <= current_date
        order by code, effective_from desc`,
    );
    assert.ok(rows.length >= 4);
    for (const r of rows) assert.ok(Number(r.n) >= 1, r.code);
  });

  it("en Basic, le propriétaire offre la place comprise ; la deuxième est refusée", async () => {
    const offre = await admin.query<{ offre_code: string }>(
      `select d.offre_code from facturation.droits_v d
         join facturation.licence_organisations lo on lo.licence_id = d.licence_id
        where lo.tenant_id = $1`,
      [pme],
    );
    assert.equal(offre.rows[0]!.offre_code, "basic");

    const avant = (await fait(dirigeant, "facturation.placeComptable", pme)) as PlaceComptable;
    assert.equal(avant.incluses, 1);
    assert.equal(avant.engagees, 0);

    const inv = (await fait(
      dirigeant,
      "facturation.inviterComptableInterne",
      comptable.email,
      pme,
    )) as { role: string; deja: boolean };
    assert.equal(inv.role, "comptable");
    // La même adresse est rendue telle quelle ; une autre ne trouve plus de place.
    assert.equal(
      (
        (await fait(dirigeant, "facturation.inviterComptableInterne", comptable.email, pme)) as {
          deja: boolean;
        }
      ).deja,
      true,
    );
    assert.match(
      await refus(
        fait(dirigeant, "facturation.inviterComptableInterne", `${marque}-bis@essai.local`, pme),
      ),
      /refus\.place\.comptable_prise/,
    );
    const pendant = (await fait(dirigeant, "facturation.placeComptable", pme)) as PlaceComptable;
    assert.equal(pendant.engagees, 1);
    assert.equal(pendant.invitations.length, 1);
  });

  it("le comptable accepte : il prend la place comprise, pas une place payante", async () => {
    const sieges = async () =>
      Number(
        (
          await admin.query<{ n: number }>(
            `select p.sieges_occupes as n from facturation.places_v p
               join facturation.licence_organisations lo on lo.licence_id = p.licence_id
              where lo.tenant_id = $1`,
            [pme],
          )
        ).rows[0]!.n,
      );
    const avant = await sieges();
    const recues = (await fait(comptable, "collab.invitationsPourMoi")) as Array<{
      id: string;
      cabinetTenantId: string;
    }>;
    const inv = recues.find((i) => i.cabinetTenantId === pme);
    assert.ok(inv);
    await fait(comptable, "collab.repondreAInvitation", inv.id, true);
    assert.equal(await sieges(), avant, "aucune place payante n'est prise");

    const acces = (await fait(comptable, "acces.monAcces", pme)) as MonAcces;
    assert.equal(acces.role, "comptable");
    assert.ok(acces.droits.includes("livres.tenir"));
    assert.ok(!acces.droits.includes("envoi.cabinet"), "il reçoit, il n'envoie pas");

    const place = (await fait(dirigeant, "facturation.placeComptable", pme)) as PlaceComptable;
    assert.deepEqual(
      place.comptables.map((c) => c.nom),
      ["Nour Essai"],
    );
    assert.equal(place.invitations.length, 0);
    // Le comptable lit la place, jamais les invitations du propriétaire.
    const vue = (await fait(comptable, "facturation.placeComptable", pme)) as PlaceComptable;
    assert.equal(vue.invitations.length, 0);
  });

  /* ======================== 2 · SANS COMPTABILITÉ EXTERNE, IL TIENT LES LIVRES */

  it("la pièce transmise par le propriétaire lui arrive, et il la comptabilise", async () => {
    const id = await deposer(dirigeant, pme, "entite");
    const envoi = (await fait(dirigeant, "collab.envoyer", id)) as { chez: string };
    assert.equal(envoi.chez, "cabinet", "la société n'est plus autonome : la pièce part");
    assert.equal(await lit(comptable, "capture.pieces", id), true);

    const ecriture = await preparer(comptable, id);
    await fait(comptable, "office.book", ecriture);
    assert.equal(await lit(comptable, "socle.ecritures", ecriture), true);
    const { rows } = await admin.query<{ status: string; booked_by: string }>(
      `select status, booked_by from socle.ecritures where id = $1`,
      [ecriture],
    );
    assert.equal(rows[0]!.status, "booked");
    assert.equal(rows[0]!.booked_by, comptable.id);
    // Valider : le second regard est à lui.
    await sousIdentiteDuServeur(comptable.id, (db) =>
      db.query(`select public.socle_ecriture_review($1, 'valide')`, [ecriture]),
    );
  });

  it("le propriétaire n'inscrit plus lui-même : les livres sont au comptable", async () => {
    const id = await deposer(dirigeant, pme, "entite");
    await fait(dirigeant, "collab.envoyer", id);
    const ecriture = await preparer(comptable, id);
    assert.match(
      await refus(fait(dirigeant, "office.book", ecriture)),
      /refus\.inscription\.reservee_au_cabinet/,
    );
  });

  it("il retourne une pièce au propriétaire, avec son motif", async () => {
    const id = await deposer(dirigeant, pme, "entite");
    await fait(dirigeant, "collab.envoyer", id);
    const motif = Object.values(motifs)[0]!;
    await fait(comptable, "supervision.retourner", {
      pieceId: id,
      motifId: motif,
      note: "Illisible",
    });
    const { rows } = await admin.query<{ status: string }>(
      `select status from capture.pieces where id = $1`,
      [id],
    );
    assert.equal(rows[0]!.status, "retournee");
  });

  it("il exporte les écritures de sa société, et l'export est journalisé", async () => {
    const exercices = (await fait(comptable, "exports.exercices", pme, pme)) as unknown[];
    assert.ok(exercices.length > 0);
    const fichier = (await fait(
      comptable,
      "exports.generer",
      pme,
      pme,
      "2026-01-01",
      "2026-12-31",
      "csv_ecritures",
    )) as { lignes: number };
    assert.ok(fichier.lignes >= 2, "l'écriture inscrite sort dans l'export");
    // Le propriétaire, qui ne tient pas les livres, n'exporte pas par ce chemin.
    assert.match(
      await refus(
        fait(dirigeant, "exports.generer", pme, pme, "2026-01-01", "2026-12-31", "csv_ecritures"),
      ),
      /refus\.introuvable/,
    );
  });

  /* ============================================== 3 · CE QUI LUI EST REFUSÉ */

  it("le Privé du propriétaire lui reste fermé", async () => {
    const id = await deposer(dirigeant, pme, "personnel");
    assert.equal(await lit(comptable, "capture.pieces", id), false);
    const liste = (await fait(comptable, "capture.listAvecLecture", pme)) as PieceLue[];
    assert.ok(!liste.some((p) => p.id === id));
  });

  it("l'abonnement, les places et les sociétés lui sont refusés", async () => {
    assert.match(
      await refus(
        sousIdentiteDuServeur(comptable.id, (db) =>
          db.query("select public.forfait_changer('team', $1, current_date)", [pme]),
        ),
      ),
      /refus\./,
    );
    assert.match(
      await refus(fait(comptable, "facturation.inviterSiege", `${marque}-s@essai.local`, pme)),
      /refus\.reserve/,
    );
    assert.match(
      await refus(
        fait(comptable, "facturation.inviterComptableInterne", `${marque}-c@essai.local`, pme),
      ),
      /refus\.reserve/,
    );
    // La société ne se renomme pas : aucun client n'écrit une table (R6).
    assert.match(
      await refus(
        sousIdentiteDuServeur(comptable.id, (db) =>
          db.query(`update identity.organizations set name = 'X' where id = $1`, [pme]),
        ),
      ),
      /permission denied/,
    );
    assert.equal(await fait(comptable, "facturation.mesPrixEnPlus", pme), null);
  });

  it("une autre société lui est fermée", async () => {
    const id = await deposer(second, autre, "entite");
    await fait(second, "collab.envoyer", id).catch(() => undefined);
    assert.equal(await lit(comptable, "capture.pieces", id), false);
    assert.match(await refus(preparer(comptable, id)), /refus\./);
  });

  /* ==================== 4 · AVEC UNE COMPTABILITÉ EXTERNE, IL PRÉPARE SEULEMENT */

  it("sous mandat externe (B) : la comptabilité externe prépare et inscrit, il ne tient plus les livres", async () => {
    await embaucher(externe.gens.amel, comptableDeLExterne, externe.pme);
    const id = await externe.deposer("amel", "entite");
    await externe.lire("amel", id);
    await externe.fait("amel", "collab.envoyer", id);
    assert.equal(await lit(comptableDeLExterne, "capture.pieces", id), true);

    // Il ne prépare plus : la proposition est refusée.
    assert.notEqual(
      await refus(preparer(comptableDeLExterne, id)),
      "accepte",
      "le comptable interne ne prépare pas sous un mandat externe",
    );
    // La comptabilité externe prépare et inscrit.
    const ecriture = await preparer(externe.gens.expert, id);
    await externe.fait("expert", "office.book", ecriture);
    // Il ne lit plus les écritures de cette société : droits de lecture à confirmer
    // (propriétaire non principal, place payée : décision ouverte).
    assert.equal(await lit(comptableDeLExterne, "socle.ecritures", ecriture), false);
    // Il ne valide pas, et ne retourne pas.
    assert.match(
      await refus(
        sousIdentiteDuServeur(comptableDeLExterne.id, (db) =>
          db.query(`select public.socle_ecriture_review($1, 'valide')`, [ecriture]),
        ),
      ),
      /refus\./,
    );
    const autrePiece = await externe.deposer("amel", "entite");
    await externe.lire("amel", autrePiece);
    await externe.fait("amel", "collab.envoyer", autrePiece);
    assert.match(
      await refus(
        fait(comptableDeLExterne, "supervision.retourner", {
          pieceId: autrePiece,
          motifId: Object.values(motifs)[0]!,
          note: "Illisible",
        }),
      ),
      /refus\.supervision\.reservee/,
    );
    // Sa société sous mandat externe ne s'ouvre plus dans son espace de comptabilité.
    const mes = (await fait(comptableDeLExterne, "supervision.listMyCabinets")) as Array<{
      id: string;
    }>;
    assert.ok(
      !mes.some((o) => o.id === externe.pme),
      "pas d'espace de comptabilité sous mandat externe",
    );
  });
});
