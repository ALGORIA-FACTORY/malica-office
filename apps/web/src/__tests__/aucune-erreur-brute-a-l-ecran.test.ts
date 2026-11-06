// @vitest-environment node
/**
 * Aucune erreur technique ne s'affiche — règle du dirigeant, 6 novembre 2026.
 *
 * « Une panne montre une phrase humaine, traduite ; le détail technique va au
 * journal, en base. » `texteDeLErreur` (lib/erreur-lisible.ts) l'applique : une
 * clé `refus.*` connue se dit dans la langue de la personne, tout le reste
 * devient la phrase prévue et une référence, et le détail part au journal.
 *
 * Elle était là, et l'audit du 6 novembre en a quand même trouvé quatre
 * écrans qui rendaient `error.message` tel quel — le chat de Malica, la
 * question à Malica, l'ouverture d'un dossier, l'acceptation d'une invitation
 * (un écran public). Une règle que le code peut contourner sans bruit se
 * contourne : cette épreuve lit donc le code des écrans.
 *
 * Dans `components/`, `routes/` et `hooks/`, elle refuse :
 *   - le `.message` d'une erreur (`e.message`, `mutation.error.message`…) ;
 *   - `String(e)` d'une erreur ;
 *   - `.statusText` et `.stack` ;
 *   - `derniereErreur` (le refus que la file hors ligne a gardé) ;
 * sauf sous une forme qui ne l'affiche pas : comparé (`===`, `startsWith`,
 * `includes`), ou lu par un traducteur (`lireUnRefus`, `direUnRefus`,
 * `codeDeLecture`). Ce qui reste est nommé ci-dessous, avec sa raison, et
 * l'épreuve échoue aussi quand une entrée n'a plus lieu d'être.
 *
 * Le code est relu SANS ses commentaires : un commentaire peut citer
 * `e.message` pour raconter le défaut, le code ne peut pas le rendre.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const RACINE = join(__dirname, "..");

/** Les couches qui rendent : ce qu'elles lisent d'une erreur peut finir à l'écran. */
const ECRANS = ["components", "routes", "hooks"];

/** Ce qui désigne le texte brut d'une erreur. */
const BRUTS: ReadonlyArray<readonly [string, RegExp]> = [
  [
    "le message d'une erreur",
    /(?:\b(?:e|err|erreur|error|raison|cause|ex|exception|echec|panne)|\.error)\??\.message\b/g,
  ],
  ["String(erreur)", /\bString\(\s*(?:e|err|erreur|error|raison|cause|ex|exception)\s*\)/g],
  ["statusText", /\.statusText\b/g],
  ["pile d'appels", /\.stack\b/g],
  ["refus gardé par la file", /\bderniereErreur\b/g],
];

/** Ce qui suit le texte brut sans l'afficher : il est comparé. */
const COMPARE = /^\s*(?:\?\?\s*""\s*\)?\s*)?(?:===|!==|\.startsWith\(|\.includes\(|\.endsWith\()/;
/** Ce qui le précède sans l'afficher : un traducteur, ou une comparaison. */
const TRADUIT = /(?:lireUnRefus|direUnRefus|codeDeLecture)\(\s*[\w.?]*$|(?:===|!==)\s*[\w.?]*$/;

/**
 * Ce qui reste, fichier par fichier : combien d'occurrences, et pourquoi
 * aucune n'atteint l'écran.
 */
const ADMIS: Readonly<Record<string, { nombre: number; raison: string }>> = {
  "routes/__root.tsx": {
    nombre: 1,
    raison:
      "la pile part au rapport de plantage expurgé (`rapporterPlantage`), jamais à l'écran de secours",
  },
  "components/malica/file-locale.tsx": {
    nombre: 1,
    raison:
      "le code du refus choisit l'explication traduite (`POURQUOI_LA_REPRISE[code]`) ; il n'est jamais rendu",
  },
  "components/malica/comment-c-est-paye.tsx": {
    nombre: 1,
    raison:
      "le refus de la file devient une erreur que la mutation rend par `texteDeLErreur` : une clé se dit, le reste devient la phrase prévue",
  },
  "components/malica/telecharger-dossier-comptable.tsx": {
    nombre: 1,
    raison:
      "seule une clé `cab.biblio.*` levée par l'archive (vérifiée par `startsWith`) passe à `t()` ; le reste va à `texteDeLErreur`",
  },
  "routes/_authenticated/pme.piece.$pieceId.tsx": {
    nombre: 1,
    raison:
      "le message est un CODE de lecture ou un motif de refus, lu par `codeDeLecture` et `motifDeRefusConnu` ; sinon `texteDeLErreur`",
  },
};

function parcourir(dossier: string, trouves: string[] = []): string[] {
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) {
      if (nom !== "__tests__") parcourir(chemin, trouves);
    } else if (/\.(ts|tsx)$/.test(nom) && !/\.test\.tsx?$/.test(nom)) {
      trouves.push(chemin);
    }
  }
  return trouves;
}

/** Le code sans ses commentaires (les chaînes restent). */
function sansCommentaires(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1 ");
}

/** Les occurrences d'un texte brut qui ne sont ni comparées ni traduites. */
export function brutsAffichables(code: string): string[] {
  const trouves: string[] = [];
  for (const [quoi, motif] of BRUTS) {
    for (const m of code.matchAll(motif)) {
      const avant = code.slice(Math.max(0, m.index - 40), m.index);
      const apres = code.slice(m.index + m[0].length, m.index + m[0].length + 40);
      if (COMPARE.test(apres) || TRADUIT.test(avant)) continue;
      const ligne = code.slice(0, m.index).split("\n").length;
      trouves.push(`${quoi} (ligne ${ligne}) : ${m[0]}`);
    }
  }
  return trouves;
}

describe("aucune erreur brute à l'écran", () => {
  const fichiers = ECRANS.flatMap((d) => parcourir(join(RACINE, d)));

  it("lit bien les écrans", () => {
    expect(fichiers.length).toBeGreaterThan(100);
  });

  it("reconnaît ce qu'elle doit refuser, et ce qu'elle doit laisser", () => {
    // Les quatre rendus de l'audit du 6 novembre, tels qu'ils étaient.
    expect(
      brutsAffichables("{mutation.error instanceof Error ? mutation.error.message : t(x)}"),
    ).toHaveLength(1);
    expect(
      brutsAffichables(
        "const erreur = (e: unknown) => (e instanceof Error ? e.message : String(e));",
      ),
    ).toHaveLength(2);
    expect(brutsAffichables("{accepter.error?.message}")).toHaveLength(1);
    expect(brutsAffichables("<p>{err.stack}</p>")).toHaveLength(1);
    expect(brutsAffichables('t(k, { raison: e.derniereErreur ?? "" })')).toHaveLength(1);
    // Ce qui compare ou traduit ne rend rien.
    expect(brutsAffichables('if (e.message === "paiement.deja_solde") return;')).toEqual([]);
    expect(brutsAffichables('e.message.startsWith("cab.biblio.")')).toEqual([]);
    expect(brutsAffichables("lireUnRefus(e.message)")).toEqual([]);
    expect(brutsAffichables('direUnRefus(e.derniereErreur ?? "")')).toEqual([]);
  });

  it("aucun écran ne rend le texte brut d'une erreur", () => {
    const releve: Record<string, string[]> = {};
    for (const f of fichiers) {
      const trouves = brutsAffichables(sansCommentaires(readFileSync(f, "utf8")));
      if (trouves.length > 0) releve[relative(RACINE, f).replace(/\\/g, "/")] = trouves;
    }
    const nouveaux = Object.entries(releve)
      .filter(([f, t]) => t.length > (ADMIS[f]?.nombre ?? 0))
      .map(([f, t]) => `${f} — ${t.join(" ; ")}`);
    expect(nouveaux, "passez l'erreur par texteDeLErreur (lib/erreur-lisible.ts)").toEqual([]);
    const regles = Object.entries(ADMIS)
      .filter(([f, a]) => (releve[f]?.length ?? 0) < a.nombre)
      .map(([f]) => f);
    expect(regles, "réglé : retirez l'entrée de ADMIS").toEqual([]);
  });
});
