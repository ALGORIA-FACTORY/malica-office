// @vitest-environment jsdom
/**
 * Un écran plein recouvre l'application : ce qu'il recouvre ne doit plus être
 * atteignable — ni au doigt, ni au lecteur d'écran.
 *
 * Trouvé par l'épreuve sur émulateur (17 septembre 2026) : le fil de Malica
 * ouvert, l'accueil qu'il recouvrait restait dans l'arbre d'accessibilité.
 * Maestro y tapait un bouton invisible ; un utilisateur de TalkBack aurait fait
 * de même, sans le voir. Onze écrans pleins avaient ce défaut.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { EcranPlein } from "../EcranPlein";

function Page({ ouvert }: { ouvert: boolean }) {
  return (
    <div>
      <header>
        <button type="button">derrière, en tête</button>
      </header>
      <main>
        <button type="button">derrière, dans la page</button>
        <p aria-hidden="true">déjà caché</p>
        {ouvert ? (
          <EcranPlein className="fixed inset-0">
            <button type="button">devant</button>
          </EcranPlein>
        ) : null}
      </main>
    </div>
  );
}

describe("l'écran plein", () => {
  afterEach(() => cleanup());

  it("se déclare comme une boîte de dialogue modale", () => {
    render(<Page ouvert />);
    const dialogue = screen.getByRole("dialog", { hidden: true });
    expect(dialogue.getAttribute("aria-modal")).toBe("true");
  });

  it("rend inerte et masqué tout ce qu'il recouvre, et rien de ce qu'il contient", () => {
    render(<Page ouvert />);
    for (const nom of ["derrière, en tête", "derrière, dans la page"]) {
      const bouton = screen.getByText(nom);
      expect(bouton.closest("[inert]"), nom).not.toBeNull();
      expect(bouton.closest('[aria-hidden="true"]'), nom).not.toBeNull();
    }
    const devant = screen.getByText("devant");
    expect(devant.closest("[inert]")).toBeNull();
    expect(devant.closest('[aria-hidden="true"]')).toBeNull();
  });

  it("rend tout à l'identique en se refermant, y compris ce qui était déjà caché", () => {
    const { rerender } = render(<Page ouvert />);
    rerender(<Page ouvert={false} />);
    expect(document.querySelectorAll("[inert]")).toHaveLength(0);
    expect(screen.getByText("derrière, dans la page").closest('[aria-hidden="true"]')).toBeNull();
    expect(screen.getByText("déjà caché", { ignore: false }).getAttribute("aria-hidden")).toBe(
      "true",
    );
  });
});

describe("aucun écran plein ne passe à côté", () => {
  it("chaque « fixed inset-0 » de l'application est un EcranPlein", () => {
    const racine = join(__dirname, "..", "..");
    const fichiers: string[] = [];
    (function parcourir(dossier: string) {
      for (const nom of readdirSync(dossier)) {
        const chemin = join(dossier, nom);
        if (nom === "__tests__" || nom === "node_modules") continue;
        if (statSync(chemin).isDirectory()) parcourir(chemin);
        else if (chemin.endsWith(".tsx")) fichiers.push(chemin);
      }
    })(racine);

    const fautifs = fichiers.flatMap((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .map((ligne, i) => ({ f, i: i + 1, ligne }))
        .filter(({ ligne }) => ligne.includes("fixed inset-0") && !ligne.includes("<EcranPlein")),
    );
    expect(fautifs.map(({ f, i }) => `${f.slice(racine.length + 1)}:${i}`)).toEqual([]);
  });
});
