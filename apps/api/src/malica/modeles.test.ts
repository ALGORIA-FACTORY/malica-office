/**
 * Le code et la table des tarifs doivent être d'accord.
 *
 * R8 n'exige pas que le nom d'un modèle vive dans la base — `modeles.ts` dit
 * pourquoi il doit rester figé par le code. Elle exige que tout modèle que le
 * code peut appeler ait une ligne de tarif EN VIGUEUR. Sans elle,
 * `agents_run_log` refuse d'écrire un coût sans origine : l'appel s'exécute,
 * et ne laisse ni coût ni latence. Le plafond de `agents.budgets` ne peut alors
 * pas mordre sur la dépense qu'il est censé borner.
 *
 * Ce test est écrit comme `db/registre.mjs` : il NOMME les écarts, et il porte
 * une liste d'écarts ACCEPTÉS, datés et motivés. Un accepté qui n'est plus
 * constaté rend le test rouge — sinon une dette se referme sans que personne ne
 * retire sa dispense, et la dispense couvre alors un défaut nouveau.
 */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { fermerLePool, horsRlsAuthentificationSeule } from "../db.ts";
import { DEEPSEEK_MODELS, modeleOcr } from "./modeles.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

/** Ce que le code peut appeler, et sous quel rôle la table doit le tarifer. */
const ATTENDUS: Array<{ modele: string; role: string; quoi: string }> = [
  { modele: DEEPSEEK_MODELS.reasoner, role: "reasoner", quoi: "le raisonneur qui désigne" },
  { modele: DEEPSEEK_MODELS.chat, role: "chat", quoi: "la voix de Malica" },
  { modele: modeleOcr(), role: "vision", quoi: "l'œil qui relève" },
];

/**
 * Les écarts acceptés — chacun daté, motivé, et destiné à disparaître.
 *
 * D31 : le prix de Qwen-VL-OCR n'a jamais été relevé dans la console du
 * fournisseur, donc aucune migration ne peut l'inscrire sans l'inventer, ce que
 * R11 interdit. Conséquence assumée et mesurée : la passe de relevé ne se
 * journalise pas. Le jour où le prix est connu, une migration datée l'inscrit
 * ET cette ligne disparaît — le test le rappellera.
 */
const ACCEPTES: Array<{ modele: string; depuis: string; raison: string }> = [
  {
    modele: "qwen-vl-ocr-2025-11-20",
    depuis: "2026-09-18",
    raison: "D31 — prix non relevé chez le fournisseur ; R11 interdit de l'inventer",
  },
];

async function tarifsEnVigueur(): Promise<Set<string>> {
  return horsRlsAuthentificationSeule(async (db) => {
    await db.query("set local role authenticated");
    const { rows } = await db.query<{ model: string; role: string }>(
      `select model, role from agents.model_pricing
        where effective_from <= current_date
          and (effective_to is null or effective_to >= current_date)`,
    );
    return new Set(rows.map((r) => `${r.model}|${r.role}`));
  });
}

describe("les modèles du code et la table des tarifs", { skip: !BASE_CONFIGUREE }, () => {
  after(async () => {
    await fermerLePool();
  });

  it("tout modèle appelable a un tarif en vigueur, ou une dispense datée", async () => {
    const enVigueur = await tarifsEnVigueur();
    const sansTarif = ATTENDUS.filter((a) => !enVigueur.has(`${a.modele}|${a.role}`));
    const inattendus = sansTarif.filter((a) => !ACCEPTES.some((x) => x.modele === a.modele));

    assert.deepEqual(
      inattendus.map((a) => `${a.modele} (${a.role}) — ${a.quoi}`),
      [],
      "modèle(s) sans tarif en vigueur : l'appel ne laissera ni coût ni latence",
    );
  });

  it("une dispense qui n'a plus lieu d'être rend ce test rouge", async () => {
    const enVigueur = await tarifsEnVigueur();
    const perimes = ACCEPTES.filter((x) =>
      ATTENDUS.some((a) => a.modele === x.modele && enVigueur.has(`${a.modele}|${a.role}`)),
    );

    assert.deepEqual(
      perimes.map((x) => `${x.modele} — dispense du ${x.depuis} : ${x.raison}`),
      [],
      "le tarif existe désormais : retirez la dispense de ACCEPTES",
    );
  });

  it("aucun rôle n'est tarifé deux fois le même jour", async () => {
    const doubles = await horsRlsAuthentificationSeule(async (db) => {
      await db.query("set local role authenticated");
      const { rows } = await db.query<{ role: string; n: string }>(
        `select role, count(*) n from agents.model_pricing
          where effective_from <= current_date
            and (effective_to is null or effective_to >= current_date)
          group by role having count(*) > 1`,
      );
      return rows;
    });

    // Deux lignes en vigueur pour un rôle, et `agents_run_log` en choisit une
    // par `order by effective_from desc limit 1` : le coût dépendrait d'un
    // détail d'ordre plutôt que d'une décision.
    assert.deepEqual(
      doubles.map((d) => `${d.role} : ${d.n} tarifs en vigueur`),
      [],
    );
  });
});
