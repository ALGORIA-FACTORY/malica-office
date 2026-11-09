/**
 * Le chat de Malica, de bout en bout, tel qu'il est le 9 novembre 2026 —
 * la section 11 du dirigeant, figée AVANT la reconstruction.
 *
 * Une PME mandatée par un cabinet, l'application réelle sur un port local, la
 * base réelle sous RLS. Seuls les fournisseurs sont simulés
 * (`malica/conseil/fournisseurs-simules.ts`) : aucun appel payant.
 *
 * Ce que ces épreuves tiennent, et que la reconstruction doit garder :
 *
 *   1. un fil rouvert se relit de la base, à l'identique, et c'est lui que le
 *      modèle relit ;
 *   2. une réponse retenue entre dans la file du cabinet, que l'écran du
 *      conseil lit avec ses statistiques ;
 *   3. le thème, la certitude, le doute et les sources sont rangés — et la
 *      portée, aujourd'hui, ne l'est pas ;
 *   5. les verdicts des contrôles sont écrits en base, la réponse intacte ;
 *   7. le ton du cabinet change ce qui part au modèle (briefing) ;
 *   9. le jugement juste/faux est rangé, une fois par personne ;
 *  10. l'appel de réponse journalise son coût au prix de la base ;
 *  11. le raisonnement ne part jamais au navigateur ;
 *  12. PV, briefing et carte fiscale répondent par leurs routes actuelles.
 *
 *   node --experimental-strip-types --env-file=.env --env-file=.env.test \
 *     --import ./src/garde-base-de-test.ts --test src/le-chat-de-malica-section-11.test.ts
 */
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { texte } from "@malica/socle/conseil";
import type { StatistiquesConseil } from "@malica/socle/ports/repositories";

import { creerCompte, emettreJeton, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentite } from "./db.ts";
import { identite } from "./depots/identite.ts";
import { parametrage } from "./depots/parametrage.ts";
import { creerAppelLocal, type AppelApi } from "./malica/appel-local.ts";
import { askMalica } from "./malica/conseil/ask.ts";
import {
  simulerLesFournisseurs,
  unFragment,
  type OptionsDeSimulation,
  type Simulation,
} from "./malica/conseil/fournisseurs-simules.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

describe("le chat de Malica — section 11", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `chat-s11-${Date.now()}`;
  const legalId = matriculeDEssai();
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
  /** Ce que le modèle simulé rend : chaque épreuve le pose avant de demander. */
  const modele: OptionsDeSimulation = {};
  let sim: Simulation;
  let base = "";
  let arret: (() => Promise<void>) | null = null;
  let dirigeant: Utilisateur;
  let expert: Utilisateur;
  let pme = "";
  let cabinet = "";

  const jeton = (u: Utilisateur) => `Bearer ${emettreJeton(u, new Date())}`;

  const rpc = async <T>(u: Utilisateur, depot: string, methode: string, args: unknown[]) => {
    const r = await fetch(`${base}/rpc`, {
      method: "POST",
      headers: { authorization: jeton(u), "content-type": "application/json" },
      body: JSON.stringify({ depot, methode, args }),
    });
    const brut = await r.text();
    assert.equal(r.status, 200, `${depot}.${methode} : ${r.status} ${brut}`);
    return { corps: (JSON.parse(brut) as { resultat: T }).resultat, brut };
  };

  const route = async (u: Utilisateur, chemin: string, corps: unknown) => {
    const r = await fetch(`${base}/malica${chemin}`, {
      method: "POST",
      headers: { authorization: jeton(u), "content-type": "application/json" },
      body: JSON.stringify(corps),
    });
    const brut = await r.text();
    return { statut: r.status, brut, corps: JSON.parse(brut) as Record<string, unknown> };
  };

  const demander = async (question: string, conversationId: string | null = null) => {
    const r = await route(dirigeant, "/demander", {
      tenantId: pme,
      question,
      locale: "fr",
      mode: "reasoner",
      conversationId,
    });
    assert.equal(r.statut, 200, r.brut);
    return r;
  };

  /**
   * L'API interne sous l'identité du dirigeant — la vraie base, la vraie RLS —
   * où seule la recherche vectorielle rend un texte : la base de test n'a pas
   * de corpus encodé, et une source n'a de sens que si un texte a été transmis.
   */
  const apiAvecUnTexte = (u: Utilisateur): AppelApi => {
    const reelle = creerAppelLocal((travail) => sousIdentite(u.id, travail));
    return {
      contenu: (id) => reelle.contenu(id),
      rpc: <T>(depot: string, methode: string, args?: unknown[]) =>
        `${depot}.${methode}` === "corpus.rechercher"
          ? Promise.resolve([unFragment()] as T)
          : reelle.rpc<T>(depot, methode, args),
    };
  };

  before(async () => {
    process.env["STOCKAGE_RACINE"] = await mkdtemp(path.join(tmpdir(), "malica-chat-s11-"));
    sim = simulerLesFournisseurs(modele);
    const { app } = await import("./app.ts");
    const serveur = app.listen(0);
    await new Promise((r) => serveur.once("listening", r));
    base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
    arret = () => new Promise<void>((r) => serveur.close(() => r()));

    const mdp = "MotDePasseTresLong2026!";
    const [d, x] = await Promise.all([
      creerCompte(`dirigeant-${marque}@essai.local`, mdp),
      creerCompte(`expert-${marque}@essai.local`, mdp),
    ]);
    assert.ok(d && x);
    dirigeant = d;
    expert = x;
    const creer = (u: Utilisateur, kind: string, nom: string, mf: string | null) =>
      sousIdentite(u.id, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `select public.create_organization($1, $2, 'autonome', $3, 'TN', 'TND') as id`,
          [kind, nom, mf],
        );
        return rows[0]!.id;
      });
    pme = await creer(dirigeant, "pme", `PME ${marque}`, legalId);
    cabinet = await creer(expert, "cabinet", `COMPTA ${marque}`, null);
    await sousIdentite(expert.id, (db) => identite.proposerMandat(db, cabinet, legalId));
    const [propose] = await sousIdentite(dirigeant.id, (db) => identite.mandatsProposes(db, pme));
    await sousIdentite(dirigeant.id, (db) => identite.repondreAuMandat(db, propose!.id, true));
  });

  after(async () => {
    sim.restaurer();
    try {
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = any($1::uuid[]) and archived_at is null`,
        [[pme, cabinet].filter(Boolean)],
      );
    } finally {
      await admin.end();
      await arret?.();
      await fermerLePool();
    }
  });

  /* ------------------------------------------------------------------ 1 */
  it("1 — un fil rouvert se relit de la base, à l'identique, et c'est lui que le modèle relit", async () => {
    modele.reponse = { reponse: "Première réponse.", conseil: false };
    const q1 = await demander("Combien de pièces attendent ?");
    const fil = q1.corps["conversationId"] as string;
    modele.reponse = { reponse: "Seconde réponse.", conseil: false };
    const appelsAvant = sim.auModele().length;
    await demander("Et le mois dernier ?", fil);

    // Le second appel au modèle a relu le premier échange en base.
    const seconde = sim
      .auModele()
      .slice(appelsAvant)
      .find((s) => s.corps["response_format"]);
    const messages = seconde!.corps["messages"] as Array<{ role: string; content: string }>;
    assert.deepEqual(
      messages.filter((m) => m.role !== "system").map((m) => `${m.role}:${m.content}`),
      [
        "user:Combien de pièces attendent ?",
        "assistant:Première réponse.",
        "user:Et le mois dernier ?",
      ],
    );

    // Rouvert, deux fois : le même fil, dans l'ordre où il a été dit.
    const { corps: relu } = await rpc<Array<Record<string, unknown>>>(
      dirigeant,
      "conversations",
      "ouvrir",
      [fil],
    );
    assert.deepEqual(
      relu.map((m) => `${String(m["role"])}:${String(m["contenu"])}`),
      [
        "user:Combien de pièces attendent ?",
        "assistant:Première réponse.",
        "user:Et le mois dernier ?",
        "assistant:Seconde réponse.",
      ],
    );
    const { corps: reluEncore } = await rpc(dirigeant, "conversations", "ouvrir", [fil]);
    assert.deepEqual(reluEncore, relu);

    // La liste des fils le nomme (titre du premier échange) et le compte.
    const { corps: fils } = await rpc<Array<Record<string, unknown>>>(
      dirigeant,
      "conversations",
      "lister",
      [pme],
    );
    const ligne = fils.find((f) => f["id"] === fil);
    assert.equal(ligne?.["titre"], "Titre simulé");
    assert.equal(ligne?.["messages"], 4);
  });

  /* ------------------------------------------------------------- 2 et 3 */
  it("2, 3 — une réponse retenue entre dans la file du cabinet, avec thème, certitude, doute et sources", async () => {
    modele.reponse = {
      reponse: "Dans votre cas, la TVA sur ce véhicule ne se déduit pas.",
      conseil: true,
      portee: "dossier",
      theme: "Déduction de TVA sur véhicule",
      certitude: 0.874,
      sources: [{ corpus: "CTVA", numero: "7" }],
      doute: "Le véhicule est-il utilitaire ?",
    };
    const r = await askMalica(apiAvecUnTexte(dirigeant), {
      tenantId: pme,
      question: "Puis-je déduire la TVA de ma voiture ?",
      locale: "fr",
    });
    assert.equal(r.retenue, true);
    assert.equal(r.answer, texte("fr", "pme.conseil.relecture"));
    assert.deepEqual(r.conseil, {
      conseil: true,
      theme: "Déduction de TVA sur véhicule",
      certitude: 0.87,
      sources: [
        { corpus: "CTVA", numero: "7", validFrom: "2026-01-01", validTo: null, langue: "fr" },
      ],
      doute: "Le véhicule est-il utilitaire ?",
    });
    // La portée décide, mais elle ne part pas au navigateur...
    assert.equal("portee" in (r.conseil ?? {}), false);

    // ...et elle n'est rangée nulle part : la file n'a pas de colonne pour elle.
    const { rows: colonnes } = await admin.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'agents' and table_name = 'arbitrages'`,
    );
    const noms = colonnes.map((c) => c.column_name);
    for (const c of ["theme", "certitude", "doute", "sources", "statut", "langue", "canal"]) {
      assert.ok(noms.includes(c), `la file ne range plus « ${c} »`);
    }
    assert.ok(!noms.includes("portee"), "la portée est désormais rangée : mettre l'épreuve à jour");

    // La file du cabinet, telle que son écran la lit.
    const { corps: file } = await rpc<Array<Record<string, unknown>>>(expert, "conseil", "file", [
      cabinet,
    ]);
    assert.equal(file.length, 1);
    const a = file[0]!;
    assert.equal(a["tenantId"], pme);
    assert.equal(a["client"], `PME ${marque}`);
    assert.equal(a["cabinetTenantId"], cabinet);
    assert.equal(a["conversationId"], r.conversationId);
    assert.ok(a["messageId"], "la question du fil n'est pas reliée");
    assert.equal(a["demandeur"], `dirigeant-${marque}@essai.local`);
    assert.equal(a["question"], "Puis-je déduire la TVA de ma voiture ?");
    assert.equal(a["reponseProposee"], "Dans votre cas, la TVA sur ce véhicule ne se déduit pas.");
    assert.equal(a["certitude"], 0.87);
    assert.equal(a["theme"], "Déduction de TVA sur véhicule");
    assert.equal(a["doute"], "Le véhicule est-il utilitaire ?");
    assert.deepEqual(a["sources"], [
      { corpus: "CTVA", numero: "7", validFrom: "2026-01-01", validTo: null, langue: "fr" },
    ]);
    assert.equal(a["statut"], "en_attente");
    assert.equal(a["canal"], "conversation");
    assert.equal(a["langue"], "fr");

    // Une réponse générale part seule : aucune copie au cabinet.
    modele.reponse = { ...modele.reponse, portee: "generale" };
    const libre = await askMalica(apiAvecUnTexte(dirigeant), {
      tenantId: pme,
      question: "Quel est le taux normal de TVA ?",
      locale: "fr",
    });
    assert.equal(libre.retenue, false);
    assert.equal(libre.answer, "Dans votre cas, la TVA sur ce véhicule ne se déduit pas.");
    const { corps: toujours } = await rpc<unknown[]>(expert, "conseil", "file", [cabinet]);
    assert.equal(toujours.length, 1);

    // Les statistiques de l'écran du conseil.
    const stats = async () =>
      (await rpc<StatistiquesConseil>(expert, "conseil", "statistiques", [cabinet])).corps;
    const avant = await stats();
    assert.deepEqual(
      { ...avant.totaux, plusAncienneEnAttente: Boolean(avant.totaux.plusAncienneEnAttente) },
      {
        enAttente: 1,
        repondues: 0,
        approuvees: 0,
        corrigees: 0,
        ecartees: 0,
        plusAncienneEnAttente: true,
      },
    );
    assert.equal(avant.parClient.length, 1);
    assert.equal(avant.parClient[0]!.client, `PME ${marque}`);
    assert.equal(avant.parClient[0]!.questions, 1);
    assert.equal(avant.parClient[0]!.dernierSujet, "Déduction de TVA sur véhicule");
    assert.deepEqual(avant.sujets, [{ theme: "Déduction de TVA sur véhicule", questions: 1 }]);

    // Le pouce du cabinet : la file et les statistiques suivent.
    await rpc(expert, "conseil", "decider", [a["id"], "approuvee", null, null, "Approuvé."]);
    const apres = await stats();
    assert.equal(apres.totaux.enAttente, 0);
    assert.equal(apres.totaux.approuvees, 1);
  });

  /* ------------------------------------------------------------------ 5 */
  it("5 — les verdicts des contrôles s'écrivent en base ; la réponse est rangée intacte (comportement actuel)", async () => {
    // Un montant à décimales qu'aucun nombre du dossier réel ne peut autoriser
    // (`chiffresDuDossier` prend tout ce qui ressemble à un nombre, uuid compris).
    const inventee = "Vous devez 9 876 543,219 dinars, selon l'article 99 du code de l'IRPP.";
    modele.reponse = { reponse: inventee, conseil: false };
    const { corps } = await demander("Quel taux pour les loyers ?");
    const messageId = corps["messageId"] as string;
    assert.equal(corps["answer"], inventee);

    const { rows: message } = await admin.query<{ contenu: string }>(
      `select contenu from agents.conversation_messages where id = $1`,
      [messageId],
    );
    assert.equal(message[0]?.contenu, inventee);
    const { rows: controles } = await admin.query<{ controle: string; suite: string }>(
      `select controle, suite from agents.reponse_controles
        where message_id = $1 order by controle`,
      [messageId],
    );
    assert.deepEqual(
      controles.map((c) => `${c.controle}:${c.suite}`),
      ["article_non_fourni:retirer", "chiffre_sans_source:retirer"],
    );
  });

  /* ------------------------------------------------------------------ 9 */
  it("9 — le jugement juste/faux est rangé, une fois par personne et par message", async () => {
    modele.reponse = { reponse: "Une réponse à juger.", conseil: false };
    const { corps } = await demander("Une question à juger ?");
    const messageId = corps["messageId"] as string;
    await rpc(dirigeant, "conversations", "juger", [
      { tenantId: pme, messageId, verdict: "faux", attendu: "La bonne réponse." },
    ]);
    // Un second geste ne remplace pas le premier.
    await rpc(dirigeant, "conversations", "juger", [
      { tenantId: pme, messageId, verdict: "juste", attendu: null },
    ]);
    const { rows } = await admin.query<{ verdict: string; attendu: string; created_by: string }>(
      `select verdict, attendu, created_by from agents.reponse_verdicts where message_id = $1`,
      [messageId],
    );
    assert.deepEqual(rows, [
      { verdict: "faux", attendu: "La bonne réponse.", created_by: dirigeant.id },
    ]);
  });

  /* ----------------------------------------------------------------- 10 */
  it("10 — l'appel de réponse journalise son coût au prix de la base ; le titre, lui, ne se journalise pas", async () => {
    modele.reponse = { reponse: "Réponse au coût mesuré.", conseil: false };
    modele.usage = { prompt_tokens: 12_345, completion_tokens: 678 };
    const avant = sim.auModele().length;
    let corps: Record<string, unknown>;
    try {
      ({ corps } = await demander("Combien coûte cette question ?"));
    } finally {
      delete modele.usage;
    }
    const runId = corps["runId"] as string;
    assert.ok(runId);

    const { rows } = await admin.query<Record<string, string | number>>(
      `select r.agent, r.model, r.status, r.tokens_in, r.tokens_out, r.cost::text as cout,
              round((r.tokens_in::numeric / 1000000) * p.price_in_per_mtok
                  + (r.tokens_out::numeric / 1000000) * p.price_out_per_mtok, 8)::text as attendu
         from agents.agent_runs r
         join agents.model_pricing p
           on p.model = r.model and p.role = 'reasoner'
          and p.effective_from <= current_date
          and (p.effective_to is null or p.effective_to >= current_date)
        where r.id = $1`,
      [runId],
    );
    assert.equal(rows.length, 1, "le journal n'a pas de tarif en vigueur pour ce modèle");
    const run = rows[0]!;
    assert.equal(run["agent"], "malica.conseil");
    assert.equal(run["model"], "deepseek-reasoner");
    assert.equal(run["status"], "ok");
    assert.equal(run["tokens_in"], 12_345);
    assert.equal(run["tokens_out"], 678);
    assert.equal(Number(run["cout"]), Number(run["attendu"]));
    assert.ok(Number(run["cout"]) > 0);

    // Deux appels au modèle (la réponse, puis le titre du fil neuf), une seule ligne au journal.
    const appels = sim.auModele().slice(avant);
    assert.deepEqual(
      appels.map(
        (s) => `${String(s.corps["model"])}:${s.corps["response_format"] ? "json" : "texte"}`,
      ),
      ["deepseek-reasoner:json", "deepseek-chat:texte"],
    );
    const { rows: duFil } = await admin.query<{ n: string }>(
      `select count(*)::text as n from agents.agent_runs
        where tenant_id = $1 and created_at >= (select created_at from agents.agent_runs where id = $2)`,
      [pme, runId],
    );
    assert.equal(duFil[0]?.n, "1");
  });

  /* ----------------------------------------------------------------- 11 */
  it("11 — le raisonnement ne part jamais au navigateur, ni à la réponse, ni au fil rouvert", async () => {
    const secret = "RAISONNEMENT-INTERNE-S11";
    modele.reponse = { reponse: "Réponse sans raisonnement.", conseil: false };
    modele.raisonnement = secret;
    let r: Awaited<ReturnType<typeof demander>>;
    try {
      r = await demander("Montre-moi ton raisonnement ?");
    } finally {
      modele.raisonnement = null;
    }
    assert.equal(r.corps["reasoning"], null);
    assert.ok(!r.brut.includes(secret));
    // Ce qui part aujourd'hui avec la réponse (constat 10), figé tel quel.
    assert.deepEqual(Object.keys(r.corps).sort(), [
      "answer",
      "conseil",
      "controles",
      "conversationId",
      "latencyMs",
      "messageId",
      "model",
      "reasoning",
      "retenue",
      "runId",
      "titre",
      "tokensIn",
      "tokensOut",
    ]);

    const fil = r.corps["conversationId"] as string;
    const { corps: relu, brut } = await rpc<Array<Record<string, unknown>>>(
      dirigeant,
      "conversations",
      "ouvrir",
      [fil],
    );
    assert.ok(!brut.includes(secret));
    assert.deepEqual(
      relu.map((m) => m["raisonnement"]),
      [null, null],
    );
    // PR #298 adds `sources` and `propositions` to a reopened thread: display data, so
    // that a reopened thread shows its sources (the director's mission). Reasoning still
    // never leaves the server (asserted above).
    assert.deepEqual(Object.keys(relu[1]!).sort(), [
      "contenu",
      "createdAt",
      "id",
      "latencyMs",
      "model",
      "propositions",
      "raisonnement",
      "role",
      "sources",
      "tokensIn",
      "tokensOut",
    ]);
    // Il est gardé en base, pour la tour : seul le navigateur ne le reçoit pas.
    const { rows } = await admin.query<{ raisonnement: string | null }>(
      `select raisonnement from agents.conversation_messages
        where conversation_id = $1 and role = 'assistant'`,
      [fil],
    );
    assert.equal(rows[0]?.raisonnement, secret);
  });

  /* ------------------------------------------------------------ 7 et 12 */
  it("12 — le PV répond par sa route : un PV inconnu rend « introuvable », sans appel au modèle", async () => {
    const avant = sim.auModele().length;
    const r = await route(expert, "/pv", {
      pvId: "00000000-0000-4000-8000-0000000000aa",
      locale: "fr",
    });
    assert.equal(r.statut, 200, r.brut);
    assert.deepEqual(r.corps, { ok: false, raison: "introuvable", pv: null });
    assert.equal(sim.auModele().length, avant);
  });

  it("12, 7 — le briefing répond par sa route, depuis les faits, au ton du cabinet", async () => {
    modele.texte = "Le dossier est à jour.";
    try {
      const sobre = await route(expert, "/briefing", {
        cabinetId: cabinet,
        clientId: pme,
        collaborateur: "collaborateur@essai.local",
        langue: "fr",
      });
      assert.equal(sobre.statut, 200, sobre.brut);
      assert.equal(sobre.corps["texte"], "Le dossier est à jour.");
      const faits = sobre.corps["faits"] as Array<{ label: string; valeur: string }>;
      assert.deepEqual(faits[0], { label: "Client", valeur: `PME ${marque}`, source: "mandat" });
      const systeme = () => {
        const dernier = sim.auModele().at(-1)!;
        return (dernier.corps["messages"] as Array<{ content: string }>)[0]!.content;
      };
      assert.match(systeme(), /sur un ton sobre et précis\./);

      // Le cabinet règle un ton chaleureux : le même briefing part autrement.
      const reglages = await sousIdentite(expert.id, (db) =>
        parametrage.reglagesCabinet(db, cabinet),
      );
      await sousIdentite(expert.id, (db) =>
        parametrage.definirReglagesCabinet(db, {
          tenantId: cabinet,
          ...reglages,
          ton: "chaleureux",
        }),
      );
      const chaleureux = await route(expert, "/briefing", {
        cabinetId: cabinet,
        clientId: pme,
        collaborateur: "collaborateur@essai.local",
        langue: "fr",
      });
      assert.equal(chaleureux.statut, 200, chaleureux.brut);
      assert.match(systeme(), /sur un ton chaleureux et direct\./);
    } finally {
      delete modele.texte;
    }
  });

  it("12 — la carte fiscale répond par sa route : un envoi vide est refusé avant toute lecture", async () => {
    const avant = sim.sortants.length;
    const r = await fetch(`${base}/malica/carte?jurisdiction=TN`, {
      method: "POST",
      headers: { authorization: jeton(dirigeant), "content-type": "image/jpeg" },
      body: new Uint8Array(0),
    });
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), { erreur: "carte.vide" });
    assert.equal(sim.sortants.length, avant);
  });
});
