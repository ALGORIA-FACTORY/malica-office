/**
 * Le coureur — ce qui fait tourner la file durable des lectures.
 *
 * ================================================================= POURQUOI
 *
 * `fabrique/travaux.ts` et `travaux-execution.ts` savent prendre un travail,
 * l'exécuter et inscrire son issue. Personne ne les appelait : la file
 * existait, vide, et la lecture d'arrière-plan restait une promesse en
 * mémoire du processus. Ce fichier est le seul consommateur réel des deux,
 * et il tient en une boucle.
 *
 * Depuis le 20 octobre, il en fait tourner DEUX natures : la lecture d'une
 * pièce, et la GÉNÉRATION d'une recette. C'est ce qui met la fabrique de
 * lecteurs en marche — elle était inerte, faute de quoi que ce soit qui
 * déclenche une génération en production. La nature décide, dans le corps de
 * la boucle, et nulle part ailleurs.
 *
 * ========================================================= CE QU'IL N'EST PAS
 *
 * Ce n'est pas un démon. Il ne balaie pas les organisations, et il ne tourne
 * pas tout seul au démarrage — parce qu'il tourne SOUS L'IDENTITÉ de
 * l'appelant, et qu'un balayage de toutes les organisations exigerait une
 * identité de service qui n'existe pas dans ce dépôt. « Aucun chemin
 * utilisateur n'emprunte un rôle privilégié » (R6), et inventer ce rôle ici
 * se déciderait ailleurs qu'au fond d'un fichier.
 *
 * La conséquence est donc nommée, et elle n'est pas cachée : un travail
 * laissé en plan par un redémarrage redevient prenable tout seul passé son
 * âge d'abandon — la base le fait —, mais il attend le prochain appel d'un
 * membre de cette organisation pour être REPRIS. C'est strictement mieux
 * qu'aujourd'hui, où il n'existait pas du tout, et c'est moins qu'un démon.
 *
 * ========================================================== POURQUOI IL DRAINE
 *
 * La boucle rappelle `executerUnTravail` tant qu'il rend quelque chose. Un
 * appel qui ne prendrait QUE son propre travail laisserait derrière lui ceux
 * qu'un redémarrage a abandonnés : la reprise n'arriverait jamais. Le
 * drainage est borné par un plafond de tours, pour qu'une file qui se
 * remplit plus vite qu'elle ne se vide ne retienne pas ce processus pour
 * toujours.
 */

import { creerAppelLocal } from "../appel-local.ts";
import { sousIdentite, sousIdentiteDuServeur } from "../../db.ts";
import { generateurDeepSeek } from "../../fabrique/generateur-modele.ts";
import { executerUneGeneration } from "../../fabrique/travail-de-generation.ts";
import { executerUnTravail } from "../../fabrique/travaux-execution.ts";
import type { NatureDeTravail } from "../../fabrique/travaux.ts";

import { registre } from "./lectures-en-cours.ts";
import { readPieceFlow } from "./read-flow.ts";

/**
 * Combien de travaux un seul appel accepte d'enchaîner.
 *
 * Ce n'est pas un seuil métier — rien n'en dépend qu'une personne puisse
 * avoir à régler, et R4 vise les constantes réglementaires. C'est une borne
 * de boucle : elle garantit que cette fonction se termine.
 */
const TOURS_MAX = 20;

/** Un coureur par organisation à la fois, dans ce processus. */
const enCours = new Set<string>();

/**
 * Ce que ce coureur SAIT exécuter, ici et maintenant.
 *
 * La génération n'y entre que si un générateur est configuré. Ce n'est pas
 * une précaution de style : sans clé, une génération prise échouerait trois
 * fois — la borne du référentiel — puis passerait « épuisée », et son format
 * n'en aurait plus jamais. Ne pas la prendre la laisse « à faire », et elle
 * partira au premier appel qui suivra la configuration de la clé.
 */
function cequejepeuxfaire(): NatureDeTravail[] {
  const natures: NatureDeTravail[] = ["lecture_piece"];
  if (process.env["DEEPSEEK_API_KEY"]) natures.push("generation_recette");
  return natures;
}

/**
 * Fait tourner la file de l'organisation à laquelle appartient cette pièce.
 *
 * Ne lève jamais : l'appelant a déjà répondu « en cours » et il n'y a plus
 * personne à qui rendre une erreur. Tout ce qui tombe se crie dans le
 * journal du serveur — et chaque issue, elle, est inscrite en base par
 * `executerUnTravail`, qui est le seul endroit où l'on apprend qu'un travail
 * a échoué.
 */
export function coureurDeLectures(utilisateurId: string, pieceId: string): void {
  void courir(utilisateurId, pieceId).catch((e: unknown) => {
    console.error(
      `[coureur] la file n'a pas tourné — pièce ${pieceId} : ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  });
}

async function courir(utilisateurId: string, pieceId: string): Promise<void> {
  const tenantId = await sousIdentite(utilisateurId, async (db) => {
    const { rows } = await db.query<{ tenant_id: string }>(
      `select tenant_id from pieces_v where id = $1`,
      [pieceId],
    );
    return rows[0]?.tenant_id ?? null;
  });
  // La RLS a répondu non, ou la pièce a disparu : il n'y a pas de file à
  // faire tourner, et surtout pas de message à inventer.
  if (!tenantId || enCours.has(tenantId)) return;

  enCours.add(tenantId);
  try {
    const api = creerAppelLocal(utilisateurId);
    // La file écrit lectures, exécutions et journaux : elle le fait en tant
    // que serveur, sous la RLS de l'utilisateur (`sousIdentiteDuServeur`).
    const avecBase = <T>(travail: Parameters<typeof sousIdentite<T>>[1]): Promise<T> =>
      sousIdentiteDuServeur(utilisateurId, travail);
    for (let tour = 0; tour < TOURS_MAX; tour += 1) {
      const fait = await executerUnTravail(avecBase, tenantId, cequejepeuxfaire(), async (t) => {
        /*
         * LA NATURE DÉCIDE, et elle décide ici seulement. Sans ce
         * branchement, un travail de génération pris par la file serait
         * exécuté comme une lecture — la file portait une seule nature
         * jusqu'au 20 octobre, et `executerUnTravail` n'avait rien à
         * départager.
         */
        if (t.nature === "generation_recette") {
          if (t.signatureCle === null) {
            // La base l'interdit par un `check` : si on arrive ici, c'est un
            // défaut de notre code, et on ne le rejoue pas.
            throw new Error(`travail de génération sans format — travail ${t.travailId}`);
          }
          const cle = process.env["DEEPSEEK_API_KEY"];
          if (!cle) throw new Error("DEEPSEEK_API_KEY absente : aucune recette ne se fabrique");
          const inscrite = await executerUneGeneration(
            avecBase,
            { tenantId, signatureCle: t.signatureCle },
            generateurDeepSeek(cle),
          );
          console.info(
            `[coureur] recette candidate ${inscrite.versionId} (rang ${String(inscrite.rang)}) ` +
              `pour « ${t.signatureCle} »`,
          );
          return;
        }

        /*
         * Le registre en mémoire reste le garde-fou du MÊME processus :
         * si quelqu'un lit la même pièce en attendant la réponse, les deux
         * rejoignent la même lecture au lieu de payer deux fois l'œil. La
         * file, elle, tient le cas que le registre ne peut pas tenir : la
         * mort du processus.
         */
        await registre<Awaited<ReturnType<typeof readPieceFlow>>>().lireOuRejoindre(t.pieceId, () =>
          readPieceFlow(api, t.pieceId),
        );
      });
      if (!fait) return;
      if (fait.issue !== "termine") {
        console.error(
          `[coureur] ${fait.issue} — pièce ${fait.pieceId}, tentative ${String(fait.tentative)} : ${
            fait.motif ?? "(sans motif)"
          }`,
        );
      }
    }
  } finally {
    enCours.delete(tenantId);
  }
}
