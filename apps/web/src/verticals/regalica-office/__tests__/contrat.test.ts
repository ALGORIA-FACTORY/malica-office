/**
 * Chaque port de l'application existe dans le contrat de l'API.
 *
 * `composition.ts` monte un port sur un dépôt (`creerDepotHttp<Port>("depot")`) ;
 * un appel de méthode devient `depot.methode` sur `/rpc`. Si le port déclare
 * une méthode que le dépôt ne sert pas, l'écran échoue à l'usage avec
 * « méthode inconnue » — trop tard. Ce test lit les deux fichiers et
 * `contrat/rpc.json`, et le dit avant.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ici = new URL(".", import.meta.url);
const composition = readFileSync(new URL("../composition.ts", ici), "utf8");
const ports = readFileSync(
  new URL("../../../../../../packages/socle/src/ports/repositories.ts", ici),
  "utf8",
);
const contrat = JSON.parse(
  readFileSync(new URL("../../../../../../contrat/rpc.json", ici), "utf8"),
) as Record<string, string[]>;

/** Les couples (port, dépôt) montés par la composition. */
function montages(): Array<{ port: string; depot: string }> {
  return [...composition.matchAll(/creerDepotHttp<(\w+)>\("([a-z]+)"\)/g)].map(
    ([, port, depot]) => ({
      port: port as string,
      depot: depot as string,
    }),
  );
}

/** Les méthodes déclarées par une interface de `repositories.ts`. */
function methodesDuPort(port: string): string[] {
  const debut = ports.indexOf(`export interface ${port} {`);
  expect(debut, `interface ${port} introuvable`).toBeGreaterThanOrEqual(0);
  // Le bloc va jusqu'à la première accolade fermante en début de ligne.
  const fin = ports.indexOf("\n}", debut);
  const bloc = ports.slice(debut, fin);
  return [...bloc.matchAll(/^\s{2}(\w+)\s*[<(]/gm)].map(([, m]) => m as string);
}

describe("les ports de l'application et le contrat de l'API", () => {
  const couples = montages();

  it("la composition monte au moins un port par dépôt connu", () => {
    expect(couples.length).toBeGreaterThan(10);
  });

  it.each(couples)("$port → $depot : chaque méthode est servie", ({ port, depot }) => {
    expect(contrat[depot], `dépôt ${depot} absent de contrat/rpc.json`).toBeDefined();
    const servies = new Set(contrat[depot]);
    const manquantes = methodesDuPort(port).filter((m) => !servies.has(m));
    expect(manquantes, `${port} appelle ${depot}.<méthode> que l'API ne sert pas`).toEqual([]);
  });
});
