/**
 * Le matricule saisi par une comptabilité se reconnaît en base, dès qu'il est
 * complet (recette du 11 novembre 2026, 3.8), et une lettre de contrôle fausse
 * se signale, à la saisie comme à l'import (3.4).
 *
 * La règle de la lettre vient du pack de la juridiction
 * (`ref.identifiant_controles`), jamais du code (R4). La base et le Socle
 * (`lettreDeControle`, celui de la lecture des pièces) doivent dire la même
 * chose : l'épreuve les confronte.
 *
 *   node --experimental-strip-types --test src/le-matricule-se-reconnait-a-la-saisie.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { lettreDeControle, normaliserMatricule } from "@malica/socle/matricule";
import pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentiteDuServeur } from "./db.ts";
import { identite } from "./depots/identite.ts";
import {
  lireLesReglesDeLecture,
  type ReglesDeLecture,
} from "./malica/lecture/regles-de-lecture.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

describe("le matricule se reconnaît à la saisie", { skip: !BASE_CONFIGUREE }, () => {
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
  const marque = `matricule-${Date.now()}`;
  let expert: Utilisateur;
  let dirigeant: Utilisateur;
  let cabinet = "";
  let pme = "";
  let regles: ReglesDeLecture;
  let juste = "";
  let faux = "";

  /** Le même noyau, avec la lettre que le Socle juge conforme, puis une autre. */
  const deuxLettres = (base: string) => {
    const [noyau, ...reste] = base.split("/");
    const chiffres = noyau!.slice(0, -1);
    const avec = (l: string) => [`${chiffres}${l}`, ...reste].join("/");
    const verdict = (l: string) =>
      lettreDeControle(normaliserMatricule(avec(l), regles.matricule), regles.matricule);
    const alphabet = regles.matricule.controle!.alphabet;
    const bonne = [...alphabet].find((l) => verdict(l) === "conforme")!;
    const mauvaise = [...alphabet].find((l) => verdict(l) === "discordante")!;
    return { juste: avec(bonne), faux: avec(mauvaise) };
  };
  const examiner = (valeur: string) =>
    sousIdentiteDuServeur(expert.id, (db) => identite.examinerMatricule(db, cabinet, valeur));
  const creer = (u: Utilisateur, kind: string, nom: string, mf: string | null) =>
    sousIdentiteDuServeur(u.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization($1, $2, 'autonome', $3, 'TN', 'TND') as id`,
        [kind, nom, mf],
      );
      return rows[0]!.id;
    });

  before(async () => {
    const e = await creerCompte(`${marque}-expert@essai.local`, "MotDePasseTresLong2026!");
    const d = await creerCompte(`${marque}-dirigeant@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(e && d);
    expert = e;
    dirigeant = d;
    const pack = (
      await admin.query<{ id: string }>(
        `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
          order by effective_from desc limit 1`,
      )
    ).rows[0]!.id;
    regles = await sousIdentiteDuServeur(expert.id, (db) =>
      lireLesReglesDeLecture(db, pack, new Date().toISOString().slice(0, 10)),
    );
    assert.ok(regles.matricule.controle, "le pack TN porte la règle de la lettre");
    ({ juste, faux } = deuxLettres(matriculeDEssai()));
    cabinet = await creer(expert, "cabinet", `COMPTA ${marque}`, null);
    pme = await creer(dirigeant, "pme", `PME ${marque}`, juste);
  });

  after(async () => {
    try {
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = any($1::uuid[]) and archived_at is null`,
        [[pme, cabinet].filter(Boolean)],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  it("3.8 — incomplet, rien n'est dit ; complet, la société déjà dans Malica se reconnaît", async () => {
    assert.deepEqual(await examiner(juste.slice(0, 7)), { complet: false });
    assert.deepEqual(await examiner(juste), {
      complet: true,
      lettre: "conforme",
      societe: "existante",
    });
    // En minuscules, comme on le tape.
    assert.equal(
      ((await examiner(juste.toLowerCase())) as { societe: string }).societe,
      "existante",
    );
  });

  it("3.8 — demandée, elle est « déjà cliente » ; un matricule libre est « nouvelle »", async () => {
    await sousIdentiteDuServeur(expert.id, (db) => identite.proposerMandat(db, cabinet, juste));
    assert.equal(((await examiner(juste)) as { societe: string }).societe, "deja_cliente");
    const libre = deuxLettres(matriculeDEssai()).juste;
    assert.deepEqual(await examiner(libre), {
      complet: true,
      lettre: "conforme",
      societe: "nouvelle",
    });
  });

  it("3.8 — seul l'expert de la comptabilité examine", async () => {
    await assert.rejects(
      sousIdentiteDuServeur(dirigeant.id, (db) => identite.examinerMatricule(db, cabinet, juste)),
      /refus\.reserve\.expert$/,
    );
  });

  it("3.4 — une lettre fausse se signale, comme le Socle la juge, sans arrêter la ligne", async () => {
    assert.equal(((await examiner(faux)) as { lettre: string }).lettre, "discordante");
    const [ligne] = await sousIdentiteDuServeur(expert.id, (db) =>
      identite.verifierDossiers(db, cabinet, [
        { matricule: faux, raison_sociale: "Société à lettre fausse", email: "a@essai.local" },
      ]),
    );
    assert.equal(ligne?.statut, "pret");
    assert.equal(ligne?.avertissement, "cab.cli.matricule.lettre");
    const [bonne] = await sousIdentiteDuServeur(expert.id, (db) =>
      identite.verifierDossiers(db, cabinet, [
        {
          matricule: deuxLettres(matriculeDEssai()).juste,
          raison_sociale: "Société juste",
          email: "b@essai.local",
        },
      ]),
    );
    assert.equal(bonne?.avertissement, null);
  });
});
