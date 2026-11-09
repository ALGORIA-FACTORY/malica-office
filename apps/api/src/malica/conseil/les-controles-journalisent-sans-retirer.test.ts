/**
 * Les contrôles du chat, tels qu'ils agissent AUJOURD'HUI — section 11, figée
 * avant la reconstruction.
 *
 * `controles.test.ts` dit QUELS verdicts naissent (article inventé, édition
 * périmée, statut, portée d'une note, lecture incertaine, édition plus
 * récente, chiffre sans source). Cette épreuve dit ce que ces verdicts FONT
 * dans `askMalica` et `repondreAuCabinet` :
 *
 *   - ils sont journalisés (`conversations.journaliserControles`), sur le
 *     message déjà rangé ;
 *   - ils ne retirent rien : une réponse marquée « retirer » est rangée, et
 *     rendue, mot pour mot (constat 4) ;
 *   - ils partent au navigateur dans `controles` ;
 *   - leur propre panne ne casse pas la réponse ;
 *   - au cabinet, seuls les « signaler » remontent, dans `signale`.
 *
 * FIGÉ COMME COMPORTEMENT ACTUEL. La mission du dirigeant prévoit que la
 * reconstruction change le premier point — un verdict « retirer » devra
 * retirer. Ce jour-là, cette épreuve tombe, et c'est voulu : elle se réécrit
 * avec le nouveau comportement, elle ne se supprime pas en silence.
 *
 *   node --experimental-strip-types --test src/malica/conseil/les-controles-journalisent-sans-retirer.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { askMalica, repondreAuCabinet } from "./ask.ts";
import {
  apiEnMemoire,
  simulerLesFournisseurs,
  TENANT_SIMULE,
  unFragment,
} from "./fournisseurs-simules.ts";

const INVENTEE = "Le taux est de 37 %, selon l'article 99 du code de l'IRPP, depuis toujours.";

async function demander(
  reponse: string,
  memoire = apiEnMemoire({ fragments: [unFragment({ corpus: "CIRPPIS", numero: "52" })] }),
) {
  const sim = simulerLesFournisseurs({ reponse: { reponse, conseil: false } });
  try {
    const r = await askMalica(memoire.api, {
      tenantId: TENANT_SIMULE,
      question: "Et pour les hôtels ?",
      locale: "fr",
      conversationId: "fil-1",
    });
    return { r, memoire };
  } finally {
    sim.restaurer();
  }
}

describe("les contrôles du chat journalisent, ils ne retirent rien (comportement actuel)", () => {
  it("deux verdicts « retirer » : la réponse est rangée et rendue intacte, les verdicts vont au journal", async () => {
    const { r, memoire } = await demander(INVENTEE);

    assert.deepEqual(
      r.controles.map((v) => [v.code, v.suite]),
      [
        ["article_non_fourni", "retirer"],
        ["chiffre_sans_source", "retirer"],
      ],
    );
    // Rien n'est retiré : ni dans le fil, ni dans ce qui part au navigateur.
    const range = memoire.premierArgument("conversations.ajouter") as Record<string, unknown>;
    assert.equal(range["reponse"], INVENTEE);
    assert.equal(r.answer, INVENTEE);

    // Le journal reçoit chaque verdict, sur le message qu'on vient d'écrire.
    assert.deepEqual(memoire.premierArgument("conversations.journaliserControles"), {
      tenantId: TENANT_SIMULE,
      messageId: "message-simule",
      verdicts: r.controles.map((v) => ({ code: v.code, suite: v.suite, detail: v.detail })),
    });
    assert.equal(r.messageId, "message-simule");
  });

  it("les contrôles tournent APRÈS que la réponse est rangée", async () => {
    const { memoire } = await demander(INVENTEE);
    const ordre = memoire.appels.map((a) => a.rpc);
    const i = (rpc: string) => ordre.indexOf(rpc);
    assert.ok(i("conversations.ajouter") >= 0);
    assert.ok(i("conversations.ajouter") < i("corpus.editionsPlusRecentes"));
    assert.ok(i("corpus.editionsPlusRecentes") < i("conversations.dernierMessage"));
    assert.ok(i("conversations.dernierMessage") < i("conversations.journaliserControles"));
  });

  it("une réponse saine n'écrit aucune ligne : l'absence est le vert", async () => {
    const { r, memoire } = await demander("Je n'ai pas ce texte sous les yeux.");
    assert.deepEqual(r.controles, []);
    assert.equal(memoire.premierArgument("conversations.journaliserControles"), undefined);
  });

  it("un contrôle qui ne peut pas tourner ne casse pas la réponse", async () => {
    const memoire = apiEnMemoire({ fragments: [unFragment({ corpus: "CIRPPIS", numero: "52" })] });
    const rpc = memoire.api.rpc.bind(memoire.api);
    memoire.api.rpc = async <T>(depot: string, methode: string, args?: unknown[]): Promise<T> => {
      if (`${depot}.${methode}` === "corpus.editionsPlusRecentes") throw new Error("base tombée");
      return rpc<T>(depot, methode, args);
    };
    const { r } = await demander(INVENTEE, memoire);
    assert.equal(r.answer, INVENTEE);
    assert.deepEqual(r.controles, []);
    assert.equal(r.messageId, null);
  });

  it("au cabinet, seuls les « signaler » remontent, et la réponse reste entière", async () => {
    const sim = simulerLesFournisseurs({
      reponse: {
        reponse: "Selon l'art. 7 et l'article 99, le taux est de 37 %.",
        conseil: true,
        portee: "generale",
        certitude: 0.8,
        sources: [{ corpus: "CTVA", numero: "7" }],
      },
    });
    try {
      const memoire = apiEnMemoire({ fragments: [unFragment({ provenance: "partiel" })] });
      const r = await repondreAuCabinet(memoire.api, {
        tenantId: TENANT_SIMULE,
        question: "Quel taux pour les hôtels ?",
        locale: "fr",
      });
      assert.equal(r.reponse, "Selon l'art. 7 et l'article 99, le taux est de 37 %.");
      // article_non_fourni et chiffre_sans_source (retirer) ne remontent pas ;
      // lecture_incertaine (signaler) remonte.
      assert.deepEqual(r.signale, ["CTVA art. 7 : lecture « partiel »"]);
    } finally {
      sim.restaurer();
    }
  });
});
