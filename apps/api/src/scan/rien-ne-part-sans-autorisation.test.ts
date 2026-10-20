/**
 * Rien ne part sans autorisation — dans aucun des deux sens.
 *
 * ================================================================= POURQUOI
 *
 * 11 octobre 2026 : « jamais de transfert vers espace privé ou cabinet sans
 * autorisation, ou de l'espace privé vers cabinet ».
 *
 * La règle était tenue pour la PIÈCE : sa politique de lecture borne le
 * cabinet aux pièces `partage`, et son retour exige un accord. Elle ne l'était
 * pas pour ce qui lui est ATTACHÉ.
 *
 * Relevé en comparant les politiques, le 11 octobre au soir :
 *
 *   pieces      → member_orgs OR (vis = 'partage' AND engaged_orgs)
 *   paiements   → member_orgs OR engaged_orgs
 *
 * Le cabinet lisait donc les paiements de TOUTES les pièces d'un dossier sous
 * mandat, y compris celles que le dirigeant avait décidé de garder : le moyen,
 * le montant, la date, et l'existence d'un justificatif. Une facture gardée au
 * coffre disait au cabinet « payée 613,493 par chèque le 9 octobre ».
 *
 * ========================= POURQUOI LA VISIBILITÉ SE DÉDUIT DE LA PIÈCE
 *
 * `capture.paiements` porte bien une colonne `vis`, recopiée de la pièce À
 * L'INSERTION. Elle ne pouvait pas servir : la table est en ajout seul, donc
 * cette copie ne se met jamais à jour. Une pièce gardée puis transmise aurait
 * laissé ses paiements invisibles au cabinet pour toujours — l'erreur inverse,
 * et aussi fausse.
 *
 * La politique interroge donc la PIÈCE, qui est la seule vérité sur sa
 * visibilité. Un seul endroit décide, et il se met à jour tout seul.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentite } from "../db.ts";
import { executerRpc } from "../rpc.ts";

import { matriculeDEssai } from "../matricule-d-essai.ts";
const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

describe("ce que le cabinet lit d'une pièce gardée", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `fuite-${Date.now()}`;
  let dirigeant: Utilisateur;
  let expert: Utilisateur;
  let pme = "";
  let cabinet = "";
  let packId = "";
  let gardee = "";
  let transmise = "";

  const parMoi = (u: Utilisateur, depot: string, methode: string, ...args: unknown[]) =>
    sousIdentite(u.id, (db) => executerRpc(db, { depot, methode, args }));

  const admin = async <T>(f: (p: pg.Pool) => Promise<T>) => {
    const p = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
    try {
      return await f(p);
    } finally {
      await p.end();
    }
  };

  async function pieceAvecPaiement(cle: string) {
    const p = (await parMoi(dirigeant, "capture", "enregistrer", {
      tenantId: pme,
      source: "photo",
      vis: "personnel",
      idempotencyKey: `${marque}-${cle}`,
      contentType: "image/jpeg",
      pageCount: 1,
    })) as { id: string };
    await parMoi(dirigeant, "capture", "enregistrerPaiement", {
      pieceId: p.id,
      packId,
      moyenCode: "cheque",
      montantMineur: 613_493,
      devise: "TND",
      payeLe: "2026-10-09",
    });
    return p.id;
  }

  before(async () => {
    const d = await creerCompte(`${marque}-pme@essai.local`, "MotDePasseTresLong2026!");
    const e = await creerCompte(`${marque}-cab@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(d && e);
    dirigeant = d;
    expert = e;

    pme = await sousIdentite(dirigeant.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', 'ALGORIA FACTORY SUARL', 'autonome',
                                           '${matriculeDEssai("A", "M")}', 'TN', 'TND') as id`,
      );
      return rows[0]!.id;
    });
    cabinet = await sousIdentite(expert.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('cabinet', 'AUDICORP', 'autonome',
                                           '${matriculeDEssai("B", "C")}', 'TN', 'TND') as id`,
      );
      return rows[0]!.id;
    });
    await admin((p) =>
      p.query(
        `insert into identity.engagements (cabinet_org_id, pme_org_id, status, starts_on)
         values ($1, $2, 'actif', current_date - 1)`,
        [cabinet, pme],
      ),
    );
    packId = await admin(async (p) => {
      const { rows } = await p.query<{ id: string }>(
        `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
          order by effective_from desc limit 1`,
      );
      return rows[0]!.id;
    });

    gardee = await pieceAvecPaiement("gardee");
    transmise = await pieceAvecPaiement("transmise");
  });

  after(async () => {
    await admin((p) =>
      p.query(
        `update identity.organizations set archived_at = now(),
                archived_reason = 'fixture de test automatisé' where id = any($1)`,
        [[pme, cabinet]],
      ),
    );
    await fermerLePool();
  });

  it("la pièce gardée ne lui est pas lisible — c'était déjà vrai", async () => {
    await assert.rejects(() => parMoi(expert, "capture", "dossier", gardee), /not_found|autoris/);
  });

  it("et SON PAIEMENT ne l'est pas davantage", async () => {
    /*
     * C'est la fuite. Le cabinet lisait « payée 613,493 par chèque le
     * 9 octobre » d'une facture que le dirigeant avait décidé de garder.
     */
    const vus = (await parMoi(expert, "capture", "paiementsDUnePiece", gardee)) as unknown[];
    assert.equal(vus.length, 0, "un paiement d'une pièce gardée ne sort pas du coffre");
  });

  it("une fois la pièce transmise, le paiement devient lisible", async () => {
    // L'erreur inverse serait aussi fausse : le moyen de paiement décide du
    // compte de trésorerie, et le cabinet doit l'avoir pour imputer.
    await parMoi(dirigeant, "collab", "setPieceVis", transmise, "partage");
    const vus = (await parMoi(expert, "capture", "paiementsDUnePiece", transmise)) as Array<{
      moyenCode: string;
    }>;
    assert.equal(vus.length, 1);
    assert.equal(vus[0]!.moyenCode, "cheque");
  });

  it("et le dirigeant, lui, voit toujours les deux", async () => {
    assert.equal(
      ((await parMoi(dirigeant, "capture", "paiementsDUnePiece", gardee)) as unknown[]).length,
      1,
      "la règle protège du cabinet, pas du dirigeant lui-même",
    );
  });

  it("la pièce transmise ne revient pas d'elle-même : l'autre sens demande un accord", async () => {
    // Les deux sens sont désormais tenus par la base, et par elle seule.
    await assert.rejects(
      () => parMoi(dirigeant, "collab", "setPieceVis", transmise, "personnel"),
      /que par accord du cabinet/,
    );
  });
});
