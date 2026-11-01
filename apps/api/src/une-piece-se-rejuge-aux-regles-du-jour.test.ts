/**
 * Une pièce se rejuge aux règles du jour.
 *
 * 30 octobre 2026 (PR 142) : le Socle propose bien plus souvent. Mais les
 * pièces déjà jugées gardaient leur ANCIEN jugement dans `capture.analyses`
 * (ajout seul, le dernier fait foi), et le cabinet lisait encore « le Socle
 * ne propose rien » là où les règles du jour proposent.
 *
 * L'ancien jugement se simule par une analyse posée à la main, sans marqueur
 * de règles — exactement ce que portent les pièces jugées avant.
 *
 *   - rejugée, la pièce devient proposable ;
 *   - une pièce qui porte une écriture vivante n'est pas touchée ;
 *   - rejouer n'ajoute rien ;
 *   - un cabinet ne rejuge pas le client d'un autre cabinet ;
 *   - une pièce archivée ou remplacée est écartée ;
 *   - ouvrir une pièce au jugement périmé la rejuge ;
 *   - l'essai n'écrit rien.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/une-piece-se-rejuge-aux-regles-du-jour.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { lireUnRefus } from "@malica/socle/refus-a-dire";
import pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentite, sousIdentiteDuServeur } from "./db.ts";
import { identite } from "./depots/identite.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";
import { contratRpc, executerRpc } from "./rpc.ts";
import { REGLES_DU_JUGEMENT } from "./scan/analyse.ts";
import { lecture as lectureDEssai } from "./scan/lecture-d-essai.ts";
import { rejugerALOuverture, type BilanDuRejeu } from "./scan/rejeu.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

describe("une pièce se rejuge aux règles du jour", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `rejeu-${Date.now()}`;
  const mdp = "MotDePasseTresLong2026!";
  const mfDossier = matriculeDEssai("A", "M");
  const mfAutre = matriculeDEssai("B", "M");
  let dirigeant: Utilisateur;
  let expert: Utilisateur;
  let autreExpert: Utilisateur;
  let collaborateur: Utilisateur;
  let pme = "";
  let autrePme = "";
  let cabinet = "";
  let autreCabinet = "";
  let packId = "";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });

  const rpc = (u: Utilisateur, depot: string, methode: string, ...args: unknown[]) =>
    sousIdentite(u.id, (db) => executerRpc(db, { depot, methode, args }));
  const rejuger = (u: Utilisateur, tenant: string | null, essai = false) =>
    rpc(u, "office", "rejugerLesPieces", tenant, null, essai) as Promise<BilanDuRejeu>;
  const proposition = (u: Utilisateur, id: string) =>
    rpc(u, "office", "propositionDePiece", id) as Promise<{ ok: boolean; empreinte?: string }>;

  let n = 0;
  /** Une facture d'achat lue, jugée aux règles du jour, transmise au cabinet. */
  const transmise = async (tenant: string, mf: string, date?: string) => {
    n += 1;
    const l = lectureDEssai({ clientMf: mf, numero: `RJ-${n}` });
    const extract = date ? { ...l.extract, document_date: date } : l.extract;
    const p = (await rpc(dirigeant, "capture", "enregistrer", {
      tenantId: tenant,
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
              extract,
              citations: l.citations,
              flags: [],
              articles: [],
              documentKind: "facture_achat",
              documentDate: extract.document_date,
              mode: "pdf-text",
              confianceParChamp: { "totals.ttc": 0.95 },
            },
          ],
        },
        "serveur",
      ),
    );
    // Une pièce qu'aucun pack ne couvre ne se juge pas : on la garde sans jugement.
    if (!date) await rpc(dirigeant, "capture", "analyser", p.id);
    await rpc(dirigeant, "collab", "setPieceVis", p.id, "partage");
    return p.id;
  };

  /**
   * L'ancien jugement : celui que les règles d'avant rendaient — montants qui
   * ne se recoupent pas, rien à proposer —, posé APRÈS le jugement du jour
   * pour faire foi, sans marqueur de règles.
   */
  const jugeeALAncienne = async (piece: string) => {
    const motif = [
      {
        code: "coherence_montants",
        statut: "anomalie",
        motif: "Les montants ne se recoupent pas.",
      },
    ];
    await admin.query(
      `insert into capture.analyses (tenant_id, piece_id, extraction_id, pack_version_id,
                                     normalisation, controles, verdict, motifs)
       select p.tenant_id, p.id, x.id, $2,
              jsonb_build_object('etat', 'illisible', 'raison', 'règles d''avant'),
              $3::jsonb, 'anomalie à signaler', $3::jsonb
         from capture.pieces p
         join lateral (select id from capture.extractions e where e.piece_id = p.id
                        order by e.created_at desc limit 1) x on true
        where p.id = $1`,
      [piece, packId, JSON.stringify(motif)],
    );
  };

  const analyses = async (piece: string) =>
    (
      await admin.query<{ verdict: string; regles: string | null }>(
        `select verdict, regles from capture.analyses where piece_id = $1 order by created_at`,
        [piece],
      )
    ).rows;
  /**
   * Un jugement d'avant le marqueur qui dit exactement ce que les règles du
   * jour diraient : le dernier jugement, recopié sans `regles`.
   */
  const jugeeALAncienneALIdentique = async (piece: string) => {
    await admin.query(
      `insert into capture.analyses (tenant_id, piece_id, extraction_id, pack_version_id,
                                     normalisation, controles, verdict, motifs,
                                     doublon_numero, doublon_mf, doublon_lu)
       select tenant_id, piece_id, extraction_id, pack_version_id, normalisation, controles,
              verdict, motifs, doublon_numero, doublon_mf, doublon_lu
         from capture.analyses where piece_id = $1 order by created_at desc limit 1`,
      [piece],
    );
  };
  /** Les analyses et les vérifications des deux dossiers : tout ce que le rejeu peut écrire. */
  const ceQueLeRejeuEcrit = async () =>
    (
      await admin.query<{ analyses: string; verifications: string }>(
        `select (select count(*) from capture.analyses where tenant_id = any($1::uuid[])) as analyses,
                (select count(*) from capture.analyses_verifiees where tenant_id = any($1::uuid[]))
                  as verifications`,
        [[pme, autrePme]],
      )
    ).rows[0];

  const toutesLesAnalyses = async () =>
    Number(
      (
        await admin.query<{ n: string }>(
          `select count(*) as n from capture.analyses where tenant_id = any($1::uuid[])`,
          [[pme, autrePme]],
        )
      ).rows[0]!.n,
    );

  before(async () => {
    dirigeant = (await creerCompte(`dirigeant-${marque}@essai.local`, mdp))!;
    expert = (await creerCompte(`expert-${marque}@essai.local`, mdp))!;
    autreExpert = (await creerCompte(`autre-expert-${marque}@essai.local`, mdp))!;
    collaborateur = (await creerCompte(`collab-${marque}@essai.local`, mdp))!;
    assert.ok(dirigeant && expert && autreExpert && collaborateur);
    const creer = (u: Utilisateur, kind: string, nom: string, mode: string, mf: string | null) =>
      sousIdentite(u.id, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `select public.create_organization($1, $2, $3, $4, 'TN', 'TND') as id`,
          [kind, nom, mode, mf],
        );
        return rows[0]!.id;
      });
    cabinet = await creer(expert, "cabinet", `CABINET REJEU ${marque}`, "mandate", null);
    autreCabinet = await creer(autreExpert, "cabinet", `AUTRE CABINET ${marque}`, "mandate", null);
    // Un collaborateur du cabinet, affecté à AUCUN dossier.
    await admin.query(
      `insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'collaborateur')`,
      [cabinet, collaborateur.id],
    );
    pme = await creer(dirigeant, "pme", `PME REJEU ${marque}`, "mandate", mfDossier);
    autrePme = await creer(dirigeant, "pme", `PME VOISINE ${marque}`, "mandate", mfAutre);
    for (const [cab, ex, tenant, mf] of [
      [cabinet, expert, pme, mfDossier],
      [autreCabinet, autreExpert, autrePme, mfAutre],
    ] as const) {
      await sousIdentite(ex.id, (db) => identite.proposerMandat(db, cab, mf));
      const [propose] = await sousIdentite(dirigeant.id, (db) =>
        identite.mandatsProposes(db, tenant),
      );
      await sousIdentite(dirigeant.id, (db) => identite.repondreAuMandat(db, propose!.id, true));
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
        [[cabinet, autreCabinet, pme, autrePme].filter(Boolean)],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  it("est servi sur /rpc", () => {
    assert.ok(contratRpc()["office"]!.includes("rejugerLesPieces"));
  });

  it("une pièce jugée aux règles d'avant devient proposable une fois rejugée", async () => {
    const id = await transmise(pme, mfDossier);
    await jugeeALAncienne(id);
    assert.equal((await analyses(id)).at(-1)?.verdict, "anomalie à signaler");

    const bilan = await rejuger(expert, pme);
    assert.ok(
      bilan.changements.some((c) => c.pieceId === id && c.proposable),
      JSON.stringify(bilan),
    );
    assert.ok(bilan.changees >= 1 && bilan.proposables >= 1, JSON.stringify(bilan));
    assert.equal(bilan.enEchec, 0);
    assert.equal(bilan.suite, null);
    const derniere = (await analyses(id)).at(-1);
    assert.equal(derniere?.verdict, "à comptabiliser", JSON.stringify(derniere));
    assert.equal(derniere?.regles, REGLES_DU_JUGEMENT);
    assert.equal((await proposition(expert, id)).ok, true);
  });

  it("rejouer n'ajoute rien", async () => {
    const id = await transmise(pme, mfDossier);
    await jugeeALAncienne(id);
    await rejuger(expert, pme);
    const avant = await ceQueLeRejeuEcrit();
    const second = await rejuger(expert, pme);
    assert.equal(second.changees, 0, JSON.stringify(second));
    assert.ok(second.rejugees >= 1);
    assert.deepEqual(await ceQueLeRejeuEcrit(), avant);
  });

  it("une pièce qui porte une écriture vivante n'est pas touchée", async () => {
    const id = await transmise(pme, mfDossier);
    const p = await proposition(expert, id);
    assert.equal(p.ok, true);
    await rpc(expert, "office", "valider", id, p.empreinte ?? null);
    await jugeeALAncienne(id);
    const avant = await analyses(id);

    const bilan = await rejuger(expert, pme);
    assert.ok(!bilan.changements.some((c) => c.pieceId === id));
    // L'ouvrir ne la rejuge pas davantage.
    await proposition(expert, id);
    assert.deepEqual(await analyses(id), avant);
  });

  it("un cabinet ne rejuge pas le client d'un autre cabinet", async () => {
    const id = await transmise(pme, mfDossier);
    await jugeeALAncienne(id);
    const avant = await toutesLesAnalyses();

    const cible = await rejuger(autreExpert, pme);
    assert.equal(cible.rejugees, 0, JSON.stringify(cible));
    const tous = await rejuger(autreExpert, null);
    assert.ok(!tous.changements.some((c) => c.tenantId === pme), JSON.stringify(tous));
    await proposition(autreExpert, id).catch(() => null);
    assert.equal(await toutesLesAnalyses(), avant);
    assert.equal((await analyses(id)).at(-1)?.verdict, "anomalie à signaler");
  });

  it("un collaborateur non affecté au dossier ne le rejuge pas", async () => {
    const id = await transmise(pme, mfDossier);
    await jugeeALAncienne(id);
    const avant = await toutesLesAnalyses();
    const bilan = await rejuger(collaborateur, pme);
    assert.equal(bilan.rejugees + bilan.enEchec, 0, JSON.stringify(bilan));
    assert.equal(await toutesLesAnalyses(), avant);
  });

  it("une pièce archivée ou remplacée est écartée", async () => {
    const archivee = await transmise(pme, mfDossier);
    await jugeeALAncienne(archivee);
    await admin.query(`update capture.pieces set archivee_le = now() where id = $1`, [archivee]);
    const ancienne = await transmise(pme, mfDossier);
    const nouvelle = await transmise(pme, mfDossier);
    await jugeeALAncienne(ancienne);
    await admin.query(
      `insert into capture.remplacements (tenant_id, piece_id, remplacee_par) values ($1, $2, $3)`,
      [pme, ancienne, nouvelle],
    );
    const avant = [await analyses(archivee), await analyses(ancienne)];

    const bilan = await rejuger(expert, pme);
    // Écartées, pas tentées : une version précédente refuserait le jugement.
    assert.equal(bilan.enEchec, 0, JSON.stringify(bilan));
    for (const id of [archivee, ancienne])
      assert.ok(!bilan.changements.some((c) => c.pieceId === id), id);
    assert.deepEqual([await analyses(archivee), await analyses(ancienne)], avant);
  });

  it("ouvrir une pièce au jugement périmé la rejuge, une seule fois", async () => {
    const id = await transmise(pme, mfDossier);
    await jugeeALAncienne(id);
    assert.equal((await proposition(expert, id)).ok, true);
    const apres = await analyses(id);
    assert.equal(apres.at(-1)?.regles, REGLES_DU_JUGEMENT);
    await proposition(expert, id);
    assert.equal((await analyses(id)).length, apres.length);
  });

  it("trois ouvertures d'une pièce ancienne inchangée ne la rejugent qu'une fois", async () => {
    const id = await transmise(pme, mfDossier);
    await jugeeALAncienneALIdentique(id);
    const avant = await analyses(id);

    const issues = [];
    for (let i = 0; i < 3; i += 1)
      issues.push(await sousIdentite(expert.id, (db) => rejugerALOuverture(db, id)));
    // Un seul recalcul : il constate que rien ne change et le dit, les deux
    // ouvertures suivantes lisent le jugement à jour sans rien recalculer.
    assert.deepEqual(issues, ["verifie", "a_jour", "a_jour"]);
    assert.deepEqual(await analyses(id), avant, "aucune analyse ajoutée");
    const { rows } = await admin.query<{ regles: string }>(
      `select regles from capture.analyses_verifiees where piece_id = $1`,
      [id],
    );
    assert.deepEqual(rows, [{ regles: REGLES_DU_JUGEMENT }]);
    // Par l'écran : l'ouverture n'écrit plus rien.
    const ecrit = await ceQueLeRejeuEcrit();
    await proposition(expert, id);
    await proposition(expert, id);
    assert.deepEqual(await ceQueLeRejeuEcrit(), ecrit);
  });

  it("rejouer le lot sur une pièce ancienne inchangée n'ajoute rien la seconde fois", async () => {
    const id = await transmise(pme, mfDossier);
    await jugeeALAncienneALIdentique(id);
    const premier = await rejuger(expert, pme);
    assert.ok(!premier.changements.some((c) => c.pieceId === id), "son jugement ne change pas");
    const ecrit = await ceQueLeRejeuEcrit();
    const second = await rejuger(expert, pme);
    assert.equal(second.changees, 0, JSON.stringify(second));
    assert.deepEqual(await ceQueLeRejeuEcrit(), ecrit);
    const issue = await sousIdentite(expert.id, (db) => rejugerALOuverture(db, id));
    assert.equal(issue, "a_jour");
  });

  it("l'essai dit ce qui changerait, et n'écrit rien", async () => {
    const id = await transmise(pme, mfDossier);
    await jugeeALAncienne(id);
    const avant = await toutesLesAnalyses();
    const essai = await rejuger(expert, pme, true);
    assert.ok(essai.changements.some((c) => c.pieceId === id && c.proposable));
    assert.equal(await toutesLesAnalyses(), avant);
    assert.equal((await analyses(id)).at(-1)?.verdict, "anomalie à signaler");
  });

  it("une pièce qui échoue va au journal des pannes, et n'arrête pas les autres", async () => {
    // Datée avant tout pack : son jugement lève (« aucun pack en vigueur »).
    const enPanne = await transmise(pme, mfDossier, "1990-01-10");
    const id = await transmise(pme, mfDossier);
    await jugeeALAncienne(id);

    const bilan = await rejuger(expert, pme);
    assert.ok(bilan.enEchec >= 1, JSON.stringify(bilan));
    assert.ok(bilan.changements.some((c) => c.pieceId === id && c.proposable));
    const { rows } = await admin.query<{ n: string }>(
      `select count(*) as n from audit.journal_client
        where tenant_id = $1 and ou = 'api/scan/rejeu' and message like '%' || $2 || '%'`,
      [cabinet, enPanne],
    );
    assert.ok(Number(rows[0]!.n) >= 1, "la panne est au journal du cabinet");
  });

  it("une pièce datée hors de tout pack : la proposition le dit par son code, le jugement par sa clé", async () => {
    // Recette (pièce 042) : une date mal lue rendait une 400 et la phrase
    // française « Aucun pack en vigueur pour TN au … » à l'écran.
    const id = await transmise(pme, mfDossier, "1990-01-10");
    const p = (await proposition(expert, id)) as unknown as {
      ok: boolean;
      raisonCode?: string;
      dateHorsReferentiel?: string;
    };
    assert.equal(p.ok, false);
    assert.equal(p.raisonCode, "date_hors_referentiel");
    assert.equal(p.dateHorsReferentiel, "1990-01-10");
    await assert.rejects(rpc(dirigeant, "capture", "analyser", id), (e: Error) => {
      assert.deepEqual(lireUnRefus(e.message), {
        cle: "refus.referentiel.pack_absent_a_la_date",
        valeurs: { juridiction: "TN", date: "1990-01-10" },
      });
      return true;
    });
  });

  it("la société d'un dossier tenu par le cabinet ne rejuge pas", async () => {
    const id = await transmise(pme, mfDossier);
    await jugeeALAncienne(id);
    const bilan = await rejuger(dirigeant, pme);
    assert.equal(bilan.rejugees, 0, JSON.stringify(bilan));
    assert.equal((await analyses(id)).at(-1)?.verdict, "anomalie à signaler");
  });
});
