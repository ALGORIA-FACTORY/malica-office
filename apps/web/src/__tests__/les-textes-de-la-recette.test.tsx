// @vitest-environment jsdom
/**
 * Les textes relevés à la recette du 11 novembre 2026 (points 5.4 et 4.6),
 * rendus avec les VRAIS dictionnaires, dans les trois langues.
 *
 *   - « 1 dossiers · 1 dirigeants ont rejoint » : deux nombres, deux accords ;
 *   - « Mise en route » : un collaborateur ne voit pas des gestes d'expert ;
 *   - « Sans collaborateur 1 mandats à affecter » ;
 *   - « Envoyé. » pour une pièce ;
 *   - « Exercice au clôture non renseignée » ;
 *   - « L'enregistrer la clôture et en ouvre une autre » ;
 *   - « … indiquée ci-dessous » sans rien dessous.
 */
import { MESSAGES, type Locale } from "@malica/socle/messages";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/i18n";

const monde = vi.hoisted(() => ({
  role: "expert" as string,
  membres: [{ userId: "u1" }] as unknown[],
  etats: [] as unknown[],
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: ReactNode }) => <a>{children}</a>,
}));
vi.mock("@/components/malica/cabinet-context", () => ({
  useCabinet: () => ({ org: { id: "cabinet-1", jurisdiction: "TN", currency: "TND" } }),
}));
vi.mock("@/hooks/use-mon-acces", () => ({
  useMonAcces: () => ({ data: { role: monde.role }, isPending: false }),
}));
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({
    collab: { members: async () => monde.membres, invitations: async () => [] },
    identity: { etatDesClients: async () => monde.etats },
  }),
}));

import { MiseEnRouteDuJour } from "@/components/malica/mise-en-route-du-jour";

/** Ce que `t()` rend, avec la règle de pluriel de la langue. */
function dire(locale: Locale, cle: string, vars: Record<string, string | number> = {}): string {
  const dict = MESSAGES[locale] as Record<string, string>;
  let brut = dict[cle] ?? cle;
  const n = vars["count"];
  if (typeof n === "number") {
    for (const forme of [new Intl.PluralRules(locale).select(n), "other"]) {
      const v = dict[`${cle}#${forme}`];
      if (v !== undefined) {
        brut = v;
        break;
      }
    }
  }
  return Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), brut);
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  Object.assign(monde, { role: "expert", membres: [{ userId: "u1" }], etats: [] });
});

function rendreLaMiseEnRoute() {
  window.localStorage.setItem("malica.locale", "fr");
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <I18nProvider>
        <MiseEnRouteDuJour />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe("la mise en route de la comptabilité", () => {
  it("dit « 1 dossier · 1 dirigeant a rejoint », au singulier", async () => {
    monde.etats = [{ tenantId: "pme-1", dirigeantPresent: true, accesStatut: null }];
    rendreLaMiseEnRoute();
    expect(await screen.findByText("1 dossier · 1 dirigeant a rejoint")).toBeTruthy();
  });

  it("accorde chaque nombre pour lui-même : « 2 dossiers · 1 dirigeant a rejoint »", async () => {
    monde.etats = [
      { tenantId: "pme-1", dirigeantPresent: true, accesStatut: null },
      { tenantId: "pme-2", dirigeantPresent: false, accesStatut: null },
    ];
    rendreLaMiseEnRoute();
    expect(await screen.findByText("2 dossiers · 1 dirigeant a rejoint")).toBeTruthy();
  });

  it("ne se montre pas à un collaborateur : ajouter des clients est un geste d'expert", async () => {
    monde.role = "collaborateur";
    const { container } = rendreLaMiseEnRoute();
    // Le temps que les lectures répondent : la carte ne vient jamais.
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector("#mer-titre")).toBeNull();
  });

  it("se montre à l'expert, avec « Ajoutez vos clients — à faire »", async () => {
    rendreLaMiseEnRoute();
    await waitFor(() => expect(document.querySelector("#mer-titre")).not.toBeNull());
    expect(screen.getByText(MESSAGES.fr["cab.mer.clients"])).toBeTruthy();
  });
});

describe("les textes de la recette, en fr, en et ar", () => {
  const LANGUES: Locale[] = ["fr", "en", "ar"];

  it("« mandat à affecter » s'accorde avec le nombre", () => {
    expect(dire("fr", "cab.pil.kpi.sans.ctx", { count: 1 })).toBe("mandat à affecter");
    expect(dire("fr", "cab.pil.kpi.sans.ctx", { count: 3 })).toBe("mandats à affecter");
    expect(dire("en", "cab.pil.kpi.sans.ctx", { count: 1 })).toBe("mandate to assign");
    for (const l of LANGUES) expect(dire(l, "cab.pil.kpi.sans.ctx", { count: 1 })).not.toBe("");
  });

  it("une pièce est « Envoyée. »", () => {
    expect(dire("fr", "envoi.titre")).toBe("Envoyée.");
  });

  it("sans clôture connue, la phrase ne dit pas « Exercice au clôture non renseignée »", () => {
    for (const l of LANGUES) {
      const phrase = dire(l, "cab.dos.sous.sansCloture", { depuis: "1 mai", pack: "TN 2026.1" });
      expect(phrase).toContain("1 mai");
      expect(phrase).toContain("TN 2026.1");
      expect(phrase).not.toMatch(/\{/);
    }
    expect(dire("fr", "cab.dos.sous.sansCloture", { depuis: "x", pack: "y" })).not.toContain(
      "Exercice au",
    );
  });

  it("la fiche dit ce que fait « Enregistrer », en français correct", () => {
    expect(dire("fr", "fiche.dejaEtablie", { depuis: "1 mai" })).not.toContain(
      "L’enregistrer la clôture",
    );
    expect(dire("fr", "fiche.dejaEtablie", { depuis: "1 mai" })).not.toContain(
      "L'enregistrer la clôture",
    );
  });

  it("aucune langue ne promet un écart « ci-dessous » qui peut ne pas exister", () => {
    expect(dire("fr", "pme.reglages.offres.complement", { comptabilite: "X" })).not.toContain(
      "ci-dessous",
    );
    expect(dire("en", "pme.reglages.offres.complement", { comptabilite: "X" })).not.toContain(
      "below",
    );
    expect(dire("ar", "pme.reglages.offres.complement", { comptabilite: "X" })).not.toContain(
      "أدناه",
    );
  });
});
