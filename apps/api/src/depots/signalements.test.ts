/**
 * Les signalements : chacun dépose les siens, personne ne les relit sauf
 * l'opérateur. Éprouvé sous la RLS, par le registre des dépôts.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentite } from "../db.ts";
import { executerRpc } from "../rpc.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

describe("les signalements", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `signalement-${Date.now()}`;
  let a: Utilisateur;
  let b: Utilisateur;

  before(async () => {
    const compteA = await creerCompte(`a-${marque}@essai.local`, "MotDePasseTresLong2026!");
    const compteB = await creerCompte(`b-${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(compteA && compteB);
    a = compteA;
    b = compteB;
  });

  after(async () => {
    await fermerLePool();
  });

  const compter = (utilisateur: Utilisateur, id: string) =>
    sousIdentite(utilisateur.id, async (db) => {
      const { rows } = await db.query<{ n: string }>(
        `select count(*)::text as n from app.signalements where id = $1`,
        [id],
      );
      return Number(rows[0]!.n);
    });

  it("se dépose, et ne se relit pas — ni par un autre, ni par soi-même", async () => {
    const depose = (await sousIdentite(a.id, (db) =>
      executerRpc(db, {
        depot: "signalements",
        methode: "deposer",
        args: [
          {
            versionClient: "coque-android/0.1.0",
            appareil: "Infinix X6525",
            ou: "/pme/list",
            message: "La liste reste vide après la photo.",
          },
        ],
      }),
    )) as { id: string; creeLe: string };
    assert.match(depose.id, /^[0-9a-f-]{36}$/);
    assert.ok(!Number.isNaN(Date.parse(depose.creeLe)));

    // Seul l'opérateur de la plateforme relit : ni l'auteur, ni un tiers.
    assert.equal(await compter(a, depose.id), 0);
    assert.equal(await compter(b, depose.id), 0);
  });

  it("refuse un message vide ou une version absente, avant la base", async () => {
    await assert.rejects(
      sousIdentite(a.id, (db) =>
        executerRpc(db, {
          depot: "signalements",
          methode: "deposer",
          args: [{ versionClient: "coque-android/0.1.0", message: "   " }],
        }),
      ),
    );
    await assert.rejects(
      sousIdentite(a.id, (db) =>
        executerRpc(db, {
          depot: "signalements",
          methode: "deposer",
          args: [{ message: "sans version" }],
        }),
      ),
    );
  });
});
