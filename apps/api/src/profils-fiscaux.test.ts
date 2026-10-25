import { lecture } from "./scan/lecture-d-essai.ts";
import { executerRpc } from "./rpc.ts";
import { office } from "./depots/office.ts";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentite, sousIdentiteDuServeur } from "./db.ts";
import { fiscalite } from "./depots/fiscalite.ts";
import { identite } from "./depots/identite.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";
import type { ConfigurationFiscale, LotFiscal, ProfilFiscal } from "@malica/socle/ports/fiscalite";

const CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["DATABASE_URL_ADMIN"] && process.env["JWT_SECRET"],
);
const configuration: ConfigurationFiscale = {
  activite: "Activité du scénario fiscal",
  regimeImposition: "reel",
  regimeTva: "assujetti",
  prorataTva: null,
  regles: [
    {
      famille: "tva",
      operation: "vente",
      typeOperation: "Opération du scénario",
      code: "ESSAI",
      applicabilite: "applicable",
      mode: "taux",
      valeur: "8.375",
      assiette: "Base du scénario",
      dansBaseTva: null,
      deductibilite: "a_qualifier",
      referenceLegale: "Source de test, sans valeur réglementaire",
      conditions: "",
      justificatif: "",
    },
  ],
};

describe("les profils fiscaux se versionnent sous l'identité réelle", { skip: !CONFIGUREE }, () => {
  const marque = `fiscalite-${Date.now()}`;
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
  let expert: Utilisateur;
  let autre: Utilisateur;
  let dirigeant: Utilisateur;
  let collaborateur: Utilisateur;
  let cabinet = "";
  let autreCabinet = "";
  const clients: string[] = [];
  const supplementaires: string[] = [];
  let aujourd = "";
  let demain = "";
  let apres = "";
  let p: ProfilFiscal;
  let p2: ProfilFiscal;
  const lot = async (version: ProfilFiscal, dateEffet: string): Promise<LotFiscal> => {
    const ds = await sousIdentite(expert.id, (db) =>
      fiscalite.fiscaliteDossiers(db, cabinet, "9999-12-31"),
    );
    return {
      cabinetId: cabinet,
      versionProfilId: version.id,
      dateEffet,
      cibles: clients.map((clientId) => ({
        clientId,
        precedentId: ds.find((d) => d.clientId === clientId)?.id ?? null,
      })),
    };
  };
  before(async () => {
    const e = await creerCompte(`expert-${marque}@essai.local`, "MotDePasseTresLong2026!");
    const a = await creerCompte(`autre-${marque}@essai.local`, "MotDePasseTresLong2026!");
    const d = await creerCompte(`dirigeant-${marque}@essai.local`, "MotDePasseTresLong2026!");
    const coll = await creerCompte(
      `collaborateur-${marque}@essai.local`,
      "MotDePasseTresLong2026!",
    );
    assert.ok(e && a && d && coll);
    collaborateur = coll;
    expert = e;
    autre = a;
    dirigeant = d;
    const dates = (
      await admin.query<{ a: string; b: string; c: string }>(
        `select current_date::text as a, (current_date+1)::text as b, (current_date+2)::text as c`,
      )
    ).rows[0]!;
    aujourd = dates.a;
    demain = dates.b;
    apres = dates.c;
    for (const [u, nom] of [
      [expert, "Compta"],
      [autre, "Autre"],
    ] as const) {
      const r = await sousIdentite(u.id, (db) =>
        identite.createOrganization(db, {
          kind: "cabinet",
          name: `${nom} ${marque}`,
          jurisdiction: "TN",
          currency: "TND",
          validationMode: "mandate",
          defaultEntityName: "Siège",
        }),
      );
      if (u.id === expert.id) cabinet = r;
      else autreCabinet = r;
    }
    await admin.query(
      `insert into identity.memberships (tenant_id, user_id, role) values ($1,$2,'collaborateur')`,
      [cabinet, collaborateur.id],
    );
    for (let n = 0; n < 2; n++) {
      const r = await sousIdentite(expert.id, (db) =>
        identite.ouvrirDossier(db, {
          cabinetTenantId: cabinet,
          name: `Client ${n} ${marque}`,
          legalId: matriculeDEssai(),
          adresse: null,
        }),
      );
      clients.push(r.id);
    }
    await admin.query(
      `insert into identity.memberships (tenant_id, user_id, role) values ($1,$2,'dirigeant')`,
      [clients[0], dirigeant.id],
    );
    p = await sousIdentite(expert.id, (db) =>
      fiscalite.enregistrerProfilFiscal(db, {
        cabinetId: cabinet,
        profilId: null,
        precedentId: null,
        nom: "Profil test",
        categorie: "Catégorie test",
        jurisdiction: "TN",
        dateEffet: aujourd,
        configuration,
      }),
    );
  });
  after(async () => {
    try {
      await admin.query(
        `update identity.organizations set archived_at = now(), archived_reason = 'scénario fiscal terminé' where id = any($1::uuid[]) and archived_at is null`,
        [[cabinet, autreCabinet, ...clients, ...supplementaires].filter(Boolean)],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });
  it("prévisualise puis applique le même instantané aux deux dossiers, sans doublon", async () => {
    const l = await lot(p, aujourd);
    const preview = await sousIdentite(expert.id, (db) => fiscalite.apercuFiscal(db, l));
    assert.deepEqual(
      preview.map((r) => r.statut),
      ["eligible", "eligible"],
    );
    assert.deepEqual(
      await sousIdentite(expert.id, (db) => fiscalite.appliquerProfilFiscal(db, l)),
      { appliques: 2, ignores: 0 },
    );
    assert.deepEqual(
      await sousIdentite(expert.id, async (db) =>
        fiscalite.appliquerProfilFiscal(db, await lot(p, aujourd)),
      ),
      { appliques: 0, ignores: 2 },
    );
    const fiche = await sousIdentite(expert.id, (db) => identite.ficheCourante(db, clients[1]!));
    assert.equal(fiche?.regimeTva, "assujetti");
  });
  it("préserve la personnalisation et versionne uniquement l'autre dossier", async () => {
    const ds = await sousIdentite(expert.id, (db) =>
      fiscalite.fiscaliteDossiers(db, cabinet, "9999-12-31"),
    );
    const d = ds.find((d) => d.clientId === clients[0])!;
    await sousIdentite(expert.id, (db) =>
      fiscalite.personnaliserFiscalite(db, {
        cabinetId: cabinet,
        clientId: d.clientId,
        versionProfilId: p.id,
        precedentId: d.id,
        dateEffet: aujourd,
        configuration: {
          ...configuration,
          regles: [{ ...configuration.regles[0]!, valeur: "8.376" }],
        },
      }),
    );
    p2 = await sousIdentite(expert.id, (db) =>
      fiscalite.enregistrerProfilFiscal(db, {
        cabinetId: cabinet,
        profilId: p.profilId,
        precedentId: p.id,
        nom: p.nom,
        categorie: p.categorie,
        jurisdiction: p.jurisdiction,
        dateEffet: demain,
        configuration: {
          ...configuration,
          regles: [{ ...configuration.regles[0]!, valeur: "8.377" }],
        },
      }),
    );
    const l = await lot(p2, demain);
    assert.deepEqual(
      (await sousIdentite(expert.id, (db) => fiscalite.apercuFiscal(db, l))).map((r) => r.statut),
      ["personnalise", "eligible"],
    );
    assert.deepEqual(
      await sousIdentite(expert.id, (db) => fiscalite.appliquerProfilFiscal(db, l)),
      { appliques: 1, ignores: 1 },
    );
    const avant = await sousIdentite(expert.id, (db) =>
      fiscalite.fiscaliteDossiers(db, cabinet, aujourd),
    );
    const futur = await sousIdentite(expert.id, (db) =>
      fiscalite.fiscaliteDossiers(db, cabinet, demain),
    );
    assert.equal(avant.find((d) => d.clientId === clients[1])!.versionProfilId, p.id);
    assert.equal(futur.find((d) => d.clientId === clients[1])!.versionProfilId, p2.id);
  });
  it("refuse un lot périmé et ne laisse aucune application partielle", async () => {
    const l = await lot(p2, demain);
    l.cibles[0]!.precedentId = null;
    const avant = await sousIdentite(expert.id, (db) =>
      fiscalite.historiqueFiscal(db, cabinet, clients[1]!),
    );
    await assert.rejects(
      sousIdentite(expert.id, (db) => fiscalite.appliquerProfilFiscal(db, l)),
      /changé/,
    );
    const apres = await sousIdentite(expert.id, (db) =>
      fiscalite.historiqueFiscal(db, cabinet, clients[1]!),
    );
    assert.equal(apres.length, avant.length);
  });
  it("un régime futur n'avance ni la fiche courante ni les règles du jour", async () => {
    const p3 = await sousIdentite(expert.id, (db) =>
      fiscalite.enregistrerProfilFiscal(db, {
        cabinetId: cabinet,
        profilId: p2.profilId,
        precedentId: p2.id,
        nom: p2.nom,
        categorie: p2.categorie,
        jurisdiction: p2.jurisdiction,
        dateEffet: apres,
        configuration: { ...configuration, regimeTva: "non_assujetti" },
      }),
    );
    const l = await lot(p3, apres);
    l.cibles = [l.cibles[1]!];
    assert.equal(
      (await sousIdentite(expert.id, (db) => fiscalite.appliquerProfilFiscal(db, l))).appliques,
      1,
    );
    const fiche = await sousIdentite(expert.id, (db) => identite.ficheCourante(db, clients[1]!));
    assert.equal(fiche?.regimeTva, "assujetti");
    assert.equal(fiche?.validTo, apres);
    const h = await sousIdentite(expert.id, (db) =>
      fiscalite.historiqueFiscal(db, cabinet, clients[1]!),
    );
    assert.equal(h.length, 3);
    assert.equal(h[0]!.configuration.regimeTva, "non_assujetti");
  });
  it("le dirigeant, un autre cabinet et un collaborateur ne peuvent pas modifier la fiscalité", async () => {
    assert.deepEqual(
      await sousIdentite(autre.id, (db) => fiscalite.profilsFiscaux(db, cabinet)),
      [],
    );
    for (const user of [dirigeant, autre, collaborateur])
      await assert.rejects(
        sousIdentite(user.id, (db) =>
          fiscalite.appliquerProfilFiscal(db, {
            cabinetId: cabinet,
            versionProfilId: p.id,
            dateEffet: aujourd,
            cibles: [{ clientId: clients[0]!, precedentId: null }],
          }),
        ),
        /expert/,
      );
    await assert.rejects(
      sousIdentite(autre.id, (db) =>
        db.query(
          `insert into parametrage.fiscalite_dossiers (tenant_id,cabinet_id,version_profil_id,categorie,personnalise,date_effet,configuration) values ($1,$2,$3,'Catégorie test',false,$4,$5::jsonb)`,
          [clients[0], autreCabinet, p.id, aujourd, JSON.stringify(configuration)],
        ),
      ),
    );
    await assert.rejects(
      sousIdentite(expert.id, (db) =>
        db.query(`update parametrage.profils_fiscaux set nom = 'réécrit' where id = $1`, [p.id]),
      ),
    );
  });
  it("le référentiel proposé ne mélange pas taxes fixes, TVA et FODEC", async () => {
    const c = await sousIdentite(expert.id, (db) => fiscalite.catalogueFiscal(db, "TN", aujourd));
    assert.ok(c.some((r) => r.famille === "tva" && r.mode === "taux"));
    assert.ok(c.some((r) => r.famille === "timbre" && r.mode === "montant"));
    assert.ok(c.some((r) => r.famille === "fodec" && r.mode === "taux"));
    assert.ok(
      c.some(
        (r) => r.famille === "retenue" && r.operation === "paiement_emis" && r.seuil !== undefined,
      ),
    );
  });

  it("préserve la fiche fiscale antérieure jusqu'à une reprise individuelle explicite", async () => {
    const d = await sousIdentite(expert.id, (db) =>
      identite.ouvrirDossier(db, {
        cabinetTenantId: cabinet,
        name: `Particularité ${marque}`,
        legalId: matriculeDEssai(),
        adresse: null,
      }),
    );
    supplementaires.push(d.id);
    await admin.query(
      `insert into identity.fiches_fiscales (tenant_id, regime_tva, secteur, source, valid_from, created_by) values ($1, 'non_assujetti', 'Activité propre au client', 'saisie', current_date-1, $2)`,
      [d.id, expert.id],
    );
    const l: LotFiscal = {
      cabinetId: cabinet,
      versionProfilId: p.id,
      dateEffet: aujourd,
      cibles: [{ clientId: d.id, precedentId: null }],
    };
    const preview = await sousIdentite(expert.id, (db) => fiscalite.apercuFiscal(db, l));
    assert.equal(preview[0]!.statut, "personnalise");
    assert.equal(preview[0]!.avant!.regimeTva, "non_assujetti");
    assert.deepEqual(
      await sousIdentite(expert.id, (db) => fiscalite.appliquerProfilFiscal(db, l)),
      { appliques: 0, ignores: 1 },
    );
    assert.equal(
      (await sousIdentite(expert.id, (db) => identite.ficheCourante(db, d.id)))!.regimeTva,
      "non_assujetti",
    );
    assert.equal(
      (
        await sousIdentite(expert.id, (db) =>
          fiscalite.appliquerProfilFiscal(db, { ...l, remplacerPersonnalisation: true }),
        )
      ).appliques,
      1,
    );
    assert.equal(
      (await sousIdentite(expert.id, (db) => identite.ficheCourante(db, d.id)))!.regimeTva,
      "assujetti",
    );
  });
  it("deux applications concurrentes d'un aperçu ne créent qu'une version", async () => {
    const d = await sousIdentite(expert.id, (db) =>
      identite.ouvrirDossier(db, {
        cabinetTenantId: cabinet,
        name: `Concurrence ${marque}`,
        legalId: matriculeDEssai(),
        adresse: null,
      }),
    );
    supplementaires.push(d.id);
    const l: LotFiscal = {
      cabinetId: cabinet,
      versionProfilId: p.id,
      dateEffet: aujourd,
      cibles: [{ clientId: d.id, precedentId: null }],
    };
    const rs = await Promise.allSettled(
      [1, 2].map(() => sousIdentite(expert.id, (db) => fiscalite.appliquerProfilFiscal(db, l))),
    );
    assert.equal(rs.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(rs.filter((r) => r.status === "rejected").length, 1);
    assert.equal(
      (await sousIdentite(expert.id, (db) => fiscalite.historiqueFiscal(db, cabinet, d.id))).length,
      1,
    );
  });
  it("les règles du dossier contrôlent réellement la proposition et la version utilisée est tracée", async () => {
    const d = await sousIdentite(expert.id, (db) =>
      identite.ouvrirDossier(db, {
        cabinetTenantId: cabinet,
        name: `Pièce ${marque}`,
        legalId: matriculeDEssai(),
        adresse: null,
      }),
    );
    supplementaires.push(d.id);
    await admin.query(
      `insert into identity.memberships (tenant_id, user_id, role) values ($1,$2,'dirigeant')`,
      [d.id, dirigeant.id],
    );
    const catalogue = await sousIdentite(expert.id, (db) =>
      fiscalite.catalogueFiscal(db, "TN", aujourd),
    );
    const tva = catalogue.find((r) => r.operation === "achat" && r.code === "TVA19")!;
    const timbre = catalogue.find((r) => r.operation === "achat" && r.famille === "timbre")!;
    const config: ConfigurationFiscale = {
      ...configuration,
      regles: [tva, timbre].map((r) => ({
        famille: r.famille,
        operation: r.operation,
        typeOperation: "Scénario d'intégration",
        code: r.code,
        applicabilite: "applicable",
        mode: r.mode,
        valeur: r === tva ? "8.375" : r.valeur,
        assiette: r.assiette || "Base de la pièce du scénario",
        dansBaseTva: r.dansBaseTva,
        deductibilite: "oui",
        referenceLegale: "Source du scénario de test",
        conditions: "",
        justificatif: "",
      })),
    };
    const premier = await sousIdentite(expert.id, (db) =>
      fiscalite.enregistrerProfilFiscal(db, {
        cabinetId: cabinet,
        profilId: null,
        precedentId: null,
        nom: "Profil pièce",
        categorie: "Intégration",
        jurisdiction: "TN",
        dateEffet: aujourd,
        configuration: config,
      }),
    );
    await sousIdentite(expert.id, (db) =>
      fiscalite.appliquerProfilFiscal(db, {
        cabinetId: cabinet,
        versionProfilId: premier.id,
        dateEffet: aujourd,
        cibles: [{ clientId: d.id, precedentId: null }],
      }),
    );
    const packId = (
      await admin.query<{ id: string }>(
        `select id from ref.jurisdiction_packs where jurisdiction = 'TN' and effective_from <= current_date order by effective_from desc limit 1`,
      )
    ).rows[0]!.id;
    const rpc = (depot: string, methode: string, ...args: unknown[]) =>
      sousIdentiteDuServeur(dirigeant.id, (db) =>
        executerRpc(db, { depot, methode, args }, "serveur"),
      );
    const l = lecture({ clientMf: d.legalId, numero: `F-${marque}` });
    l.extract.document_date = aujourd;
    l.tokens[5]!.text = aujourd.split("-").reverse().join("/");
    const piece = (await rpc("capture", "enregistrer", {
      tenantId: d.id,
      source: "pdf",
      vis: "partage",
      idempotencyKey: marque,
      contentType: "application/pdf",
      pageCount: 1,
    })) as { id: string };
    await rpc("capture", "persisterLecture", {
      pieceId: piece.id,
      packId,
      tokens: l.tokens,
      contract: "extract.v1",
      extract: l.extract,
      citations: l.citations,
      flags: [],
      articles: [],
      documentKind: "facture_achat",
      documentDate: aujourd,
      mode: "pdf-text",
      confianceParChamp: { "totals.ttc": 0.95 },
    });
    const refusee = await sousIdentite(expert.id, (db) => office.propositionDePiece(db, piece.id));
    assert.equal(refusee.ok, false);
    if (!refusee.ok) assert.match(refusee.raison, /TVA incohérente/);
    const corrigee = await sousIdentite(expert.id, (db) =>
      fiscalite.enregistrerProfilFiscal(db, {
        cabinetId: cabinet,
        profilId: premier.profilId,
        precedentId: premier.id,
        nom: premier.nom,
        categorie: premier.categorie,
        jurisdiction: "TN",
        dateEffet: aujourd,
        configuration: {
          ...config,
          regles: config.regles.map((r) =>
            r.famille === "tva" ? { ...r, valeur: tva.valeur } : r,
          ),
        },
      }),
    );
    const h = await sousIdentite(expert.id, (db) => fiscalite.historiqueFiscal(db, cabinet, d.id));
    await sousIdentite(expert.id, (db) =>
      fiscalite.appliquerProfilFiscal(db, {
        cabinetId: cabinet,
        versionProfilId: corrigee.id,
        dateEffet: aujourd,
        cibles: [{ clientId: d.id, precedentId: h[0]!.id }],
      }),
    );
    const accepte = await sousIdentite(expert.id, (db) => office.propositionDePiece(db, piece.id));
    assert.equal(accepte.ok, true, !accepte.ok ? accepte.raison : "");
    const ecriture = await sousIdentite(expert.id, (db) =>
      office.proposerDepuisPiece(db, piece.id),
    );
    const traces = await admin.query<{ version: string }>(
      `select payload->>'version_dossier' as version from audit.event_log where action = 'fiscalite.appliquee' and object_id = $1`,
      [ecriture],
    );
    assert.equal(traces.rows.length, 1);
    assert.notEqual(traces.rows[0]!.version, h[0]!.id);
    const dernier = await sousIdentite(expert.id, (db) =>
      fiscalite.historiqueFiscal(db, cabinet, d.id),
    );
    const modifie = await sousIdentite(expert.id, (db) =>
      fiscalite.enregistrerProfilFiscal(db, {
        cabinetId: cabinet,
        profilId: corrigee.profilId,
        precedentId: corrigee.id,
        nom: corrigee.nom,
        categorie: corrigee.categorie,
        jurisdiction: "TN",
        dateEffet: aujourd,
        configuration: config,
      }),
    );
    await sousIdentite(expert.id, (db) =>
      fiscalite.appliquerProfilFiscal(db, {
        cabinetId: cabinet,
        versionProfilId: modifie.id,
        dateEffet: aujourd,
        cibles: [{ clientId: d.id, precedentId: dernier[0]!.id }],
      }),
    );
    await assert.rejects(
      sousIdentite(expert.id, (db) => office.book(db, ecriture)),
      /TVA incohérente/,
    );
  });
});
