// @vitest-environment jsdom
/**
 * L'écran du chat de la PME (`pme.malica.tsx`), tel qu'il est le 9 novembre
 * 2026 — section 11 du dirigeant, figée avant la reconstruction.
 *
 *   6. le salut, les trois questions prêtes et « Ce que j'ai utilisé » se
 *      rendent en français, en anglais et en arabe — les vrais dictionnaires,
 *      pas des clés ;
 *      et ce que l'écran ENVOIE : `malica.demander` avec la société, la langue,
 *      le raisonneur, puis le fil rendu par la première réponse ;
 *   7. la voix (`useVoix`) : la question dite part par le même appel que le
 *      clavier, la dictée écoute dans la langue de l'écran, et la réponse d'une
 *      question dite se lit à voix haute.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ar } from "@malica/socle/messages-ar";
import { en } from "@malica/socle/messages-en";
import { fr } from "@malica/socle/messages-fr";
import type { ReponseDeMalica } from "@malica/socle/ports/malica";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: ComponentType }) => ({ options }),
  Link: ({ children, className }: { children: ReactNode; className?: string }) => (
    <a className={className}>{children}</a>
  ),
}));
vi.mock("@/components/malica/pme-context", () => ({
  usePme: () => ({ tenantId: "pme-1" }),
}));
vi.mock("@/hooks/use-fiches-des-societes", () => ({
  useFichesDesSocietes: () => ({ ids: [], fiches: { data: [] } }),
}));
vi.mock("@/hooks/use-pieces-lues", () => ({ usePiecesLuesDesSocietes: () => [] }));
vi.mock("@/hooks/use-mon-acces", () => ({
  useMonAcces: () => ({ data: { role: "dirigeant" }, isPending: false }),
}));
vi.mock("@/hooks/use-revenir", () => ({ useRevenir: () => vi.fn() }));

const demander = vi.fn<(q: Record<string, unknown>) => Promise<ReponseDeMalica>>();
/** Les fils de la société, et ce que la base relit d'un fil rouvert. */
let fils: Array<Record<string, unknown>> = [];
const ouvrir = vi.fn<(id: string) => Promise<Array<Record<string, unknown>>>>();

vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({
    conversations: {
      lister: async () => fils,
      ouvrir: (id: string) => ouvrir(id),
      supprimer: async () => undefined,
    },
    conseil: {
      contexte: async () => ({
        cabinetId: null,
        cabinetNom: null,
        seuil: null,
        appelantMembre: true,
      }),
    },
    identity: { monProfil: async () => ({ prenom: "Amel" }) },
    malica: { demander: (q: Record<string, unknown>) => demander(q) },
  }),
}));

import { chargerLesEspaces } from "@/i18n/dictionnaires";
import { I18nProvider } from "@/i18n";

import { Route } from "../routes/_authenticated/pme.malica";

const Ecran = (Route as unknown as { options: { component: ComponentType } }).options.component;
const DICTIONNAIRES = { fr, en, ar } as const;
type Langue = keyof typeof DICTIONNAIRES;
const LANGUES: Langue[] = ["fr", "en", "ar"];
const PAROLE: Record<Langue, string> = { fr: "fr-FR", en: "en-US", ar: "ar-TN" };

function reponse(p: Partial<ReponseDeMalica> = {}): ReponseDeMalica {
  return {
    answer: "La TVA se déclare chaque mois.",
    reasoning: null,
    model: "deepseek-reasoner",
    latencyMs: 1200,
    tokensIn: 100,
    tokensOut: 20,
    runId: "run-1",
    conversationId: "fil-1",
    messageId: "message-1",
    controles: [],
    titre: null,
    retenue: false,
    conseil: {
      conseil: true,
      theme: "Déclaration de TVA",
      certitude: 0.9,
      sources: [
        { corpus: "CTVA", numero: "18", validFrom: "2026-01-01", validTo: null, langue: "fr" },
      ],
      doute: null,
    },
    ...p,
  };
}

async function afficher(langue: Langue) {
  window.localStorage.setItem("malica.locale", langue);
  await chargerLesEspaces(langue);
  const d = DICTIONNAIRES[langue];
  render(
    <QueryClientProvider client={new QueryClient()}>
      <I18nProvider>
        <Ecran />
      </I18nProvider>
    </QueryClientProvider>,
  );
  // La langue est arrivée, et le prénom du profil aussi.
  await screen.findByText(`${d["pme.malica.salut.jour"]} Amel.`);
  return d;
}

/** Une dictée simulée : la dernière ouverte, avec sa langue. */
class DicteeSimulee {
  static derniere: DicteeSimulee | null = null;
  lang = "";
  interimResults = false;
  continuous = false;
  onresult: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  start = vi.fn(() => {
    DicteeSimulee.derniere = this;
  });
  stop = vi.fn(() => this.onend?.());
  abort = vi.fn();
}
class EnonceSimule {
  lang = "";
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly text: string) {}
}

beforeEach(() => {
  // Le salut dépend de l'heure : 10 h, le matin.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 9, 10, 0, 0));
  demander.mockReset();
  ouvrir.mockReset();
  fils = [];
  // L'écran descend au bas du fil ; jsdom ne fait pas défiler.
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.localStorage.clear();
  const w = window as unknown as Record<string, unknown>;
  delete w["SpeechRecognition"];
  delete w["speechSynthesis"];
  delete (globalThis as Record<string, unknown>)["SpeechSynthesisUtterance"];
});

describe("le chat de la PME, dans les trois langues", () => {
  for (const langue of LANGUES) {
    it(`${langue} — le salut, les questions prêtes et « Ce que j'ai utilisé » se rendent traduits`, async () => {
      const d = await afficher(langue);
      expect(screen.getByText(d["pme.malica.sous"])).toBeTruthy();
      const pretes = [
        d["pme.malica.pret.tva"],
        d["pme.malica.pret.retenue"],
        d["pme.malica.pret.garder"],
      ];
      const boutons = [...document.querySelectorAll(".sugg button")].map((b) => b.textContent);
      expect(boutons).toEqual(pretes);
      // Aucune clé brute ne passe à l'écran.
      for (const texte of [...pretes, d["pme.malica.utilise"]]) expect(texte).not.toMatch(/^pme\./);

      const cote = document.querySelector(".side .src") as HTMLElement;
      expect(within(cote).getByText(d["pme.malica.utilise"])).toBeTruthy();
      expect(within(cote).getByText(d["pme.malica.rienEncore"])).toBeTruthy();
    });

    it(`${langue} — une question prête part par malica.demander, et « Ce que j'ai utilisé » montre les sources`, async () => {
      demander.mockResolvedValueOnce(reponse());
      demander.mockResolvedValueOnce(reponse({ answer: "Le 28 du mois suivant." }));
      const d = await afficher(langue);
      fireEvent.click(screen.getByText(d["pme.malica.pret.tva"]));

      await waitFor(() => expect(demander).toHaveBeenCalledTimes(1));
      expect(demander.mock.calls[0]![0]).toEqual({
        tenantId: "pme-1",
        pieceId: null,
        question: d["pme.malica.pret.tva"],
        locale: langue,
        mode: "reasoner",
        conversationId: null,
      });
      const cote = document.querySelector(".side .src") as HTMLElement;
      await waitFor(() => expect(cote.textContent).toContain("CTVA"));
      expect(within(cote).getByText("18")).toBeTruthy();

      // La question suivante part dans le fil que la réponse a rendu.
      const champ = screen.getByLabelText(d["pme.malica.composer"]);
      fireEvent.change(champ, { target: { value: "Et la date limite ?" } });
      fireEvent.submit(champ.closest("form")!);
      await waitFor(() => expect(demander).toHaveBeenCalledTimes(2));
      expect(demander.mock.calls[1]![0]).toMatchObject({
        question: "Et la date limite ?",
        conversationId: "fil-1",
        locale: langue,
      });
    });
  }
});

describe("un fil rouvert", () => {
  it("se relit tel que la base le rend, sans ses sources (constat 9), et la suite part dans ce fil", async () => {
    fils = [
      {
        id: "fil-7",
        titre: "Crédit de TVA",
        createdAt: "2026-11-08T09:00:00Z",
        updatedAt: "2026-11-08T09:01:00Z",
        messages: 2,
      },
    ];
    ouvrir.mockResolvedValue([
      { id: "m1", role: "user", contenu: "Quel est mon crédit ?", raisonnement: null },
      { id: "m2", role: "assistant", contenu: "Il est au dossier.", raisonnement: null },
    ]);
    demander.mockResolvedValueOnce(reponse({ conversationId: "fil-7" }));
    const d = await afficher("fr");
    fireEvent.click(await screen.findByText("Crédit de TVA"));
    await waitFor(() => expect(ouvrir).toHaveBeenCalledWith("fil-7"));
    await screen.findByText("Il est au dossier.");
    expect(
      [...document.querySelectorAll(".msgs .moi, .msgs .mal")].map((e) => e.textContent),
    ).toEqual(["Quel est mon crédit ?", "Il est au dossier."]);
    expect(document.querySelector(".msgs .srcs")).toBeNull();

    const champ = screen.getByLabelText(d["pme.malica.composer"]);
    fireEvent.change(champ, { target: { value: "Et ce mois-ci ?" } });
    fireEvent.submit(champ.closest("form")!);
    await waitFor(() => expect(demander).toHaveBeenCalledTimes(1));
    expect(demander.mock.calls[0]![0]).toMatchObject({ conversationId: "fil-7" });
  });
});

describe("la voix (useVoix) change ce qui part", () => {
  it("sans dictée dans l'appareil, le micro ne s'affiche pas", async () => {
    const d = await afficher("fr");
    expect(screen.queryByLabelText(d["pme.malica.voix.parler"])).toBeNull();
  });

  for (const langue of LANGUES) {
    it(`${langue} — la question dite part telle qu'entendue, et la réponse se lit dans la langue de l'écran`, async () => {
      const w = window as unknown as Record<string, unknown>;
      w["SpeechRecognition"] = DicteeSimulee;
      const speak = vi.fn();
      w["speechSynthesis"] = { speak, cancel: vi.fn() };
      (globalThis as Record<string, unknown>)["SpeechSynthesisUtterance"] = EnonceSimule;
      demander.mockResolvedValueOnce(reponse({ answer: "Chaque mois, avant le 28." }));

      const d = await afficher(langue);
      fireEvent.click(await screen.findByLabelText(d["pme.malica.voix.parler"]));
      const dictee = DicteeSimulee.derniere!;
      expect(dictee.lang).toBe(PAROLE[langue]);

      act(() =>
        dictee.onresult?.({
          resultIndex: 0,
          results: [{ isFinal: true, 0: { transcript: "quand payer la TVA" } }],
        }),
      );
      const dialogue = screen.getByRole("dialog");
      expect(within(dialogue).getByText("« quand payer la TVA »")).toBeTruthy();
      fireEvent.click(within(dialogue).getByText(d["malica.chat.send"]));

      await waitFor(() => expect(demander).toHaveBeenCalledTimes(1));
      expect(demander.mock.calls[0]![0]).toMatchObject({
        question: "quand payer la TVA",
        locale: langue,
        mode: "reasoner",
      });
      await waitFor(() => expect(speak).toHaveBeenCalledTimes(1));
      const enonce = speak.mock.calls[0]![0] as EnonceSimule;
      expect(enonce.text).toBe("Chaque mois, avant le 28.");
      expect(enonce.lang).toBe(PAROLE[langue]);
    });
  }

  it("une question tapée ne se lit pas à voix haute", async () => {
    const w = window as unknown as Record<string, unknown>;
    w["SpeechRecognition"] = DicteeSimulee;
    const speak = vi.fn();
    w["speechSynthesis"] = { speak, cancel: vi.fn() };
    (globalThis as Record<string, unknown>)["SpeechSynthesisUtterance"] = EnonceSimule;
    demander.mockResolvedValueOnce(reponse());
    const d = await afficher("fr");
    fireEvent.click(screen.getByText(d["pme.malica.pret.tva"]));
    await waitFor(() => expect(demander).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(document.querySelector(".side .src")?.textContent).toContain("CTVA"),
    );
    expect(speak).not.toHaveBeenCalled();
  });
});
