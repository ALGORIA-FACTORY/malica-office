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
 * Vide depuis le 4 octobre 2026. D31 y figurait : le prix de Qwen-VL-OCR
 * n'avait jamais été relevé chez le fournisseur, et R11 interdisait de
 * l'inventer. Il l'a été, `20261004120000_le_prix_de_l_oeil.sql` l'inscrit, et
 * la dispense est tombée d'elle-même — c'est le deuxième test ci-dessous qui
 * l'aurait exigé si on l'avait oubliée.
 */
const ACCEPTES: Array<{ modele: string; depuis: string; raison: string }> = [];

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

  it("le tarif d'un modèle se désigne sans ambiguïté", async () => {
    /*
     * Le bon grain d'analyse est le COUPLE (modèle, rôle), pas le rôle seul.
     * `public.agents_run_log` cherche `where model = p_model and role = p_role`,
     * puis `order by effective_from desc limit 1`. Deux modèles distincts
     * peuvent donc parfaitement servir le même rôle en même temps — `pdf-text`
     * et `qwen-vl-ocr-2025-11-20` le font pour la vision, l'un quand le PDF
     * porte sa couche de texte, l'autre sinon.
     *
     * Deux erreurs successives ont mené ici, et elles valent d'être dites.
     * D'abord « un seul tarif en vigueur par rôle » : la CI l'a cassée, car le
     * jour d'une bascule l'ancien et le nouveau sont tous deux en vigueur,
     * bornes inclusives. Ensuite « deux tarifs du même rôle ouverts le même
     * jour » : toujours trop large, puisque deux modèles différents peuvent
     * naître le même jour sans se disputer quoi que ce soit.
     *
     * L'ambiguïté réelle est étroite : le MÊME modèle, le MÊME rôle, deux
     * lignes en vigueur ouvertes le même jour. Là, `desc limit 1` départage sur
     * rien, et le coût d'un appel dépendrait de l'ordre physique des lignes.
     */
    const ambigus = await horsRlsAuthentificationSeule(async (db) => {
      await db.query("set local role authenticated");
      const { rows } = await db.query<{ modele: string; role: string; jour: string; n: string }>(
        `select model modele, role, effective_from::text jour, count(*) n
           from agents.model_pricing
          where effective_from <= current_date
            and (effective_to is null or effective_to >= current_date)
          group by model, role, effective_from
         having count(*) > 1
          order by 1, 2`,
      );
      return rows;
    });

    assert.deepEqual(
      ambigus.map((a) => `${a.modele} (${a.role}) : ${a.n} tarifs ouverts le ${a.jour}`),
      [],
      "deux tarifs du même modèle ouverts le même jour : rien ne les départage",
    );
  });
});
