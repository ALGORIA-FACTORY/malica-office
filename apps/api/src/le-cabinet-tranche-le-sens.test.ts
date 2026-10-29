/**
 * Le sens d'une pièce se tranche au cabinet, jamais chez la PME.
 *
 * Décision du dirigeant, 29 octobre 2026 : quand la lecture ne dit pas si une
 * pièce est un achat ou une vente, ou qu'elle se contredit (l'émetteur lu
 * n'est pas celui qu'attend le sens lu), c'est le COMPTABLE qui décide. La
 * PME ne confirme rien : jusqu'ici son écran lui demandait encore « Oui,
 * c'est bien une vente de ma société », et sa réponse levait le contrôle
 * `sens_de_la_piece` à la place du cabinet.
 *
 *   - en mandat, avec un cabinet engagé, la PME ne pose plus le sens ;
 *   - le cabinet le tranche en un geste (précision datée, à son nom), et le
 *     Socle propose aussitôt l'écriture ;
 *   - un collaborateur non affecté au dossier est refusé ;
 *   - un dossier autonome garde la main sur ses pièces.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/le-cabinet-tranche-le-sens.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentite, sousIdentiteDuServeur } from "./db.ts";
import { identite } from "./depots/identite.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";
import { contratRpc, executerRpc } from "./rpc.ts";
import { lecture as lectureDEssai } from "./scan/lecture-d-essai.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

interface Proposition {
  ok: boolean;
  empreinte?: string;
  controlesEnDefaut?: string[];
}

describe("le cabinet tranche le sens d'une pièce", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `sens-${Date.now()}`;
  const mdp = "MotDePasseTresLong2026!";
  const dossiers = {
    mandat: { id: "", mf: matriculeDEssai("S", "M") },
    autonome: { id: "", mf: matriculeDEssai("T", "M") },
  };
  let dirigeant: Utilisateur;
  let expert: Utilisateur;
  let collaborateur: Utilisateur;
  let cabinet = "";
  let packId = "";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });

  const rpc = (u: Utilisateur, depot: string, methode: string, ...args: unknown[]) =>
    sousIdentite(u.id, (db) => executerRpc(db, { depot, methode, args }));
  const fait =
    (u: () => Utilisateur) =>
    (methode: string, ...args: unknown[]) => {
      const [depot, nom] = methode.split(".") as [string, string];
      return rpc(u(), depot, nom, ...args);
    };
  const pmeFait = fait(() => dirigeant);
  const cabinetFait = fait(() => expert);
  const collaborateurFait = fait(() => collaborateur);

  let n = 0;
  /**
   * Une facture d'achat (émise par un fournisseur, adressée au dossier) que
   * la lecture dit « vente » : le sens se contredit. Envoyée au cabinet en
   * mandat ; gardée à la société dans un dossier autonome.
   */
  const contredite = async (mode: keyof typeof dossiers) => {
    n += 1;
    const d = dossiers[mode];
    const l = lectureDEssai({ clientMf: d.mf, numero: `SENS-${n}` });
    const p = (await pmeFait("capture.enregistrer", {
      tenantId: d.id,
      source: "pdf",
      vis: "entite",
      idempotencyKey: `${marque}-${n}`,
      contentType: "application/pdf",
      pageCount: 1,
    })) as { id: string };
    await sousIdentiteDuServeur(dirigeant.id, (db) =>
      executerRpc(
        db,
        {
          depot: "capture",
          methode: "persisterLecture",
          args: [
            {
              pieceId: p.id,
              packId,
              tokens: l.tokens,
              contract: "extract.v1",
              extract: { ...l.extract, document_kind: "facture_vente" },
              citations: l.citations,
              flags: [],
              articles: [],
              documentKind: "facture_vente",
              documentDate: l.extract.document_date,
              mode: "pdf-text",
              confianceParChamp: { "totals.ttc": 0.95 },
            },
          ],
        },
        "serveur",
      ),
    );
    await pmeFait("capture.analyser", p.id);
    if (mode === "mandat") await pmeFait("collab.setPieceVis", p.id, "partage");
    return p.id;
  };

  const proposition = (u: Utilisateur, id: string) =>
    rpc(u, "office", "propositionDePiece", id) as Promise<Proposition>;
  const precisionsDuSens = async (id: string) =>
    (
      await admin.query<{ valeur: string; decided_by: string; decided_at: Date }>(
        `select valeur, decided_by, decided_at from capture.precisions
          where piece_id = $1 and champ = 'document_kind' order by decided_at`,
        [id],
      )
    ).rows;

  before(async () => {
    dirigeant = (await creerCompte(`dirigeant-${marque}@essai.local`, mdp))!;
    expert = (await creerCompte(`expert-${marque}@essai.local`, mdp))!;
    collaborateur = (await creerCompte(`collab-${marque}@essai.local`, mdp))!;
    assert.ok(dirigeant && expert && collaborateur);
    const creer = (u: Utilisateur, kind: string, nom: string, mode: string, mf: string | null) =>
      sousIdentite(u.id, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `select public.create_organization($1, $2, $3, $4, 'TN', 'TND') as id`,
          [kind, nom, mode, mf],
        );
        return rows[0]!.id;
      });
    cabinet = await creer(expert, "cabinet", `CABINET D'ESSAI ${marque}`, "mandate", null);
    // Un collaborateur du cabinet, affecté à AUCUN dossier.
    await admin.query(
      `insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'collaborateur')`,
      [cabinet, collaborateur.id],
    );
    for (const mode of ["mandat", "autonome"] as const) {
      const d = dossiers[mode];
      d.id = await creer(
        dirigeant,
        "pme",
        `PME ${mode.toUpperCase()} ${marque}`,
        mode === "mandat" ? "mandate" : "autonome",
        d.mf,
      );
      if (mode === "mandat") {
        await sousIdentite(expert.id, (db) => identite.proposerMandat(db, cabinet, d.mf));
        const [propose] = await sousIdentite(dirigeant.id, (db) =>
          identite.mandatsProposes(db, d.id),
        );
        await sousIdentite(dirigeant.id, (db) => identite.repondreAuMandat(db, propose!.id, true));
      }
    }
    packId = (
      await admin.query<{ id: string }>(
        `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
          order by effective_from desc limit 1`,
      )
    ).rows[0]!.id;
  });

  after(async () => {
    try {
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = any($1::uuid[]) and archived_at is null`,
        [[cabinet, dossiers.mandat.id, dossiers.autonome.id].filter(Boolean)],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  it("la lecture contredite ne propose rien : le sens est en défaut", async () => {
    const id = await contredite("mandat");
    const p = await proposition(expert, id);
    assert.equal(p.ok, false);
    assert.ok(p.controlesEnDefaut?.includes("sens_de_la_piece"), JSON.stringify(p));
  });

  it("en mandat, la PME ne pose plus le sens — ni achat, ni vente", async () => {
    const id = await contredite("mandat");
    for (const sens of ["facture_achat", "facture_vente"])
      await assert.rejects(
        pmeFait("capture.preciser", id, "document_kind", sens),
        /refus\.sens\.reserve_au_cabinet/,
        sens,
      );
    assert.deepEqual(await precisionsDuSens(id), [], "aucune précision n'est écrite");
    // Et la méthode du cabinet lui est fermée.
    await assert.rejects(pmeFait("office.trancherLeSens", id, "facture_achat"), /supervision/);
    // Ranger la pièce ailleurs qu'en achat ou vente reste à la PME.
    await pmeFait("capture.preciser", id, "document_kind", "ticket_caisse");
    await assert.rejects(
      pmeFait("capture.preciser", id, "document_kind", "facture_achat"),
      /refus\.sens\.reserve_au_cabinet/,
    );
  });

  it("le cabinet tranche, à son nom et daté ; le Socle propose, et il valide", async () => {
    const id = await contredite("mandat");
    const avant = new Date();
    const r = (await cabinetFait("office.trancherLeSens", id, "facture_achat")) as {
      type: string;
    };
    assert.equal(r.type, "facture_achat");
    const [precision] = await precisionsDuSens(id);
    assert.equal(precision?.valeur, "facture_achat");
    assert.equal(precision?.decided_by, expert.id);
    assert.ok(precision!.decided_at.getTime() >= avant.getTime() - 1000);
    const { rows: trace } = await admin.query<{ actor: string; par: boolean }>(
      `select actor, (payload ->> 'par_le_cabinet')::boolean as par from audit.event_log
        where action = 'piece.precisee' and payload ->> 'piece_id' = $1`,
      [id],
    );
    assert.deepEqual(trace, [{ actor: expert.id, par: true }]);

    // Le jugement suit la décision : une écriture se propose, et se valide.
    const p = await proposition(expert, id);
    assert.equal(p.ok, true, JSON.stringify(p));
    const ecriture = await cabinetFait("office.valider", id, p.empreinte ?? null);
    assert.equal(typeof ecriture, "string");
    // Une écriture vit : le sens ne se retranche plus ici, il se force.
    await assert.rejects(
      cabinetFait("office.trancherLeSens", id, "facture_vente"),
      /refus\.sens\.ecriture_vivante/,
    );
  });

  it("le sens ne bloque jamais le forçage", async () => {
    const id = await contredite("mandat");
    const forcee = await cabinetFait("office.forcer", {
      pieceId: id,
      journal: "ACH",
      date: "2026-09-10",
      libelle: "Achat FOURNISSEUR SA",
      lignes: [
        { account_code: "601", libelle: "Achat", debit: "1470.126", credit: "0", tax_code: null },
        {
          account_code: "401",
          libelle: "Fournisseur",
          debit: "0",
          credit: "1470.126",
          tax_code: null,
        },
      ],
      typeDeDocument: "facture_achat",
    });
    assert.equal(typeof forcee, "string");
  });

  it("un collaborateur non affecté au dossier ne tranche pas", async () => {
    const id = await contredite("mandat");
    await assert.rejects(
      collaborateurFait("office.trancherLeSens", id, "facture_achat"),
      /supervision/,
    );
    assert.deepEqual(await precisionsDuSens(id), []);
  });

  it("un dossier autonome garde la main : son dirigeant pose le sens", async () => {
    const id = await contredite("autonome");
    await pmeFait("capture.preciser", id, "document_kind", "facture_achat");
    await pmeFait("capture.analyser", id);
    const p = await proposition(dirigeant, id);
    assert.equal(p.ok, true, JSON.stringify(p));
    const [precision] = await precisionsDuSens(id);
    assert.equal(precision?.decided_by, dirigeant.id);
  });

  it("le contrat expose le geste du cabinet, et la PME lit qui tient ses livres", async () => {
    assert.ok(contratRpc()["office"]!.includes("trancherLeSens"));
    const mandat = (await pmeFait("identite.monCabinet", dossiers.mandat.id)) as {
      tientLesLivres: boolean;
    };
    assert.equal(mandat.tientLesLivres, true);
  });
});
