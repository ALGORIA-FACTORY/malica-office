// @vitest-environment jsdom
/**
 * Le fil de Malica du cabinet (`MalicaChat.tsx`), tel qu'il est le 9 novembre
 * 2026 — section 11 du dirigeant, figée avant la reconstruction.
 *
 *   6. l'accueil, le champ et l'envoi se rendent en français, en anglais et en
 *      arabe — les vrais dictionnaires ;
 *      ce qui part : `malica.demander` avec la société, la langue, le
 *      raisonneur et le fil ;
 *   9. le pouce du comptable (mode `technique`) appelle `conversations.juger`
 *      une fois, et l'écran dit merci ; hors `technique`, il n'existe pas ;
 *  11. le raisonnement n'est montré que s'il arrive — et l'API le rend nul.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ar } from "@malica/socle/messages-ar";
import { en } from "@malica/socle/messages-en";
import { fr } from "@malica/socle/messages-fr";
import type { ReponseDeMalica } from "@malica/socle/ports/malica";

const demander = vi.fn<(q: Record<string, unknown>) => Promise<ReponseDeMalica>>();

/*
 * Since PR #298 the screen asks through the streamed agent port (`malica.converser`):
 * the same canned answers are replayed as its events — debut, texte, fin with sources.
 * What these tests freeze (greeting, ready questions, "Ce que j'ai utilisé", voice,
 * the thread) is unchanged; only the transport is.
 */
function enFlux(
  ask: (q: Record<string, unknown>) => Promise<ReponseDeMalica>,
): (q: Record<string, unknown>, on: (ev: Record<string, unknown>) => void) => Promise<void> {
  return async (q, on) => {
    const r = await ask(q);
    on({ type: "debut", conversationId: r.conversationId });
    on({ type: "texte", texte: r.answer });
    on({
      type: "fin",
      fin: {
        conversationId: r.conversationId,
        messageId: r.messageId,
        titre: r.titre,
        reponse: r.answer,
        sources: (r.conseil?.sources ?? []).map((s) => ({
          cle: `malica:article:${s.corpus}:${s.numero}`,
          genre: "article",
          titre: `${s.corpus} ${s.numero}`,
          objetId: null,
          article: { corpus: s.corpus, numero: s.numero, validFrom: s.validFrom },
        })),
        propositions: [],
        suggestions: [],
        chiffresRetires: 0,
        sansCitations: false,
      },
    });
  };
}
const juger = vi.fn<(v: Record<string, unknown>) => Promise<void>>();

vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({
    conversations: {
      lister: async () => [],
      ouvrir: async () => [],
      renommer: async () => undefined,
      supprimer: async () => undefined,
      juger: (v: Record<string, unknown>) => juger(v),
    },
    malica: {
      demander: (q: Record<string, unknown>) => demander(q),
      converser: (q: Record<string, unknown>, on: (ev: Record<string, unknown>) => void) =>
        enFlux(demander)(q, on),
    },
  }),
}));

import { chargerLesEspaces } from "@/i18n/dictionnaires";
import { I18nProvider } from "@/i18n";

import { MalicaChat } from "../MalicaChat";

const DICTIONNAIRES = { fr, en, ar } as const;
type Langue = keyof typeof DICTIONNAIRES;
const LANGUES: Langue[] = ["fr", "en", "ar"];

const REPONSE: ReponseDeMalica = {
  answer: "Votre crédit de TVA est au dossier.",
  reasoning: null,
  model: "deepseek-reasoner",
  latencyMs: 1500,
  tokensIn: 100,
  tokensOut: 20,
  runId: "run-1",
  conversationId: "fil-9",
  messageId: "message-9",
  controles: [],
  titre: null,
  retenue: false,
  conseil: null,
};

async function ouvrir(langue: Langue, technique: boolean) {
  window.localStorage.setItem("malica.locale", langue);
  await chargerLesEspaces(langue);
  const d = DICTIONNAIRES[langue];
  render(
    <QueryClientProvider client={new QueryClient()}>
      <I18nProvider>
        <MalicaChat tenantId="client-1" technique={technique} />
      </I18nProvider>
    </QueryClientProvider>,
  );
  await screen.findByText(d["malica.chat.intro"]);
  return d;
}

async function poser(d: (typeof DICTIONNAIRES)[Langue], question: string) {
  fireEvent.change(screen.getByLabelText(d["malica.chat.placeholder"]), {
    target: { value: question },
  });
  fireEvent.click(screen.getByText(d["malica.chat.send"]));
  await screen.findByText(REPONSE.answer);
}

beforeEach(() => {
  // Le fil descend en bas après chaque réponse ; jsdom ne fait pas défiler.
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
  demander.mockReset();
  juger.mockReset();
  demander.mockResolvedValue(REPONSE);
  juger.mockResolvedValue(undefined);
});

const scrollToDOrigine = Element.prototype.scrollTo;

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  Element.prototype.scrollTo = scrollToDOrigine;
});

describe("le fil de Malica, dans les trois langues", () => {
  for (const langue of LANGUES) {
    it(`${langue} — l'accueil, le champ et l'envoi sont traduits ; la question part par malica.demander`, async () => {
      const d = await ouvrir(langue, false);
      expect(screen.getByPlaceholderText(d["malica.chat.placeholder"])).toBeTruthy();
      expect(screen.getByText(d["malica.chat.send"])).toBeTruthy();
      expect(d["malica.chat.intro"]).not.toMatch(/^malica\./);

      await poser(d, "Quel est mon crédit de TVA ?");
      expect(demander).toHaveBeenCalledWith({
        tenantId: "client-1",
        pieceIds: [],
        question: "Quel est mon crédit de TVA ?",
        locale: langue,
        conversationId: null,
      });
      expect(screen.getByText(d["malica.chat.you"])).toBeTruthy();
      expect(screen.getByText(d["malica.chat.her"])).toBeTruthy();

      // La suite part dans le fil rendu.
      await poser(d, "Et le mois dernier ?");
      expect(demander.mock.calls[1]![0]).toMatchObject({ conversationId: "fil-9" });
    });
  }
});

describe("le pouce du comptable", () => {
  it("en mode technique, « faux » appelle conversations.juger une fois, puis l'écran remercie", async () => {
    const d = await ouvrir("fr", true);
    await poser(d, "Quel est mon crédit de TVA ?");
    expect(screen.getByText(d["malica.juge.invite"])).toBeTruthy();
    fireEvent.click(screen.getByText(d["malica.juge.faux"]));
    await waitFor(() => expect(juger).toHaveBeenCalledTimes(1));
    expect(juger).toHaveBeenCalledWith({
      tenantId: "client-1",
      messageId: "message-9",
      verdict: "faux",
      attendu: null,
    });
    expect(screen.getByText(d["malica.juge.merci.faux"])).toBeTruthy();
    expect(screen.queryByText(d["malica.juge.juste"])).toBeNull();
    // Since PR #298 the technical line (model, duration, tokens) is gone: technical
    // secrets never reach the screen (the director's rule). Only the thumb stays.
    expect(screen.queryByText(/deepseek|claude|jetons|tokens/i)).toBeNull();
  });

  it("hors mode technique, ni pouce, ni modèle, ni raisonnement", async () => {
    demander.mockResolvedValue({ ...REPONSE, reasoning: "ne doit pas s'afficher" });
    const d = await ouvrir("fr", false);
    await poser(d, "Quel est mon crédit de TVA ?");
    expect(screen.queryByText(d["malica.juge.invite"])).toBeNull();
    expect(screen.queryByText(/deepseek-reasoner/)).toBeNull();
    // The reasoning toggle no longer exists at all (PR #298): the reasoning never shows.
    expect((d as Record<string, string | undefined>)["malica.chat.showThinking"]).toBeUndefined();
    expect(screen.queryByText("ne doit pas s'afficher")).toBeNull();
    expect(juger).not.toHaveBeenCalled();
  });

  it("en mode technique, sans raisonnement rendu (l'API le rend nul), rien à déplier", async () => {
    const d = await ouvrir("fr", true);
    await poser(d, "Quel est mon crédit de TVA ?");
    // No reasoning toggle exists any more (PR #298), even in technical mode.
    expect((d as Record<string, string | undefined>)["malica.chat.showThinking"]).toBeUndefined();
    expect(screen.queryByText(/raisonnement|reasoning|التفكير/i)).toBeNull();
  });
});
