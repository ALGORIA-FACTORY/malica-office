// @vitest-environment node
/**
 * Les gestes du circuit n'ont qu'une porte (revue Codex de #146).
 *
 * Trois fois de suite, un écran a décidé d'un geste du circuit d'après `vis`,
 * `status` ou `gardeeLe` lus sur place, alors que le Socle (`gestesDuCircuit`)
 * disait non : le lot de la bibliothèque, puis le compte « N pièces ne sont
 * pas encore parties », puis l'onglet Suivi qui offrait « Transmettre » sur une
 * pièce retournée au siège. La base refusait chaque fois — après que l'écran
 * eut promis le geste.
 *
 * Une revue de plus n'aurait pas suffi : le défaut renaît dès qu'un écran
 * appelle la base lui-même. Cette épreuve lit donc le code. Hors de
 * `hooks/use-gestes-du-circuit.ts`, aucun fichier n'appelle les méthodes du
 * circuit — envoyer, envoyer en lot, garder, demander, supprimer, renvoyer,
 * remettre au privé — ni ne calcule les gestes lui-même. Les adaptateurs HTTP
 * (`verticals/malica-office/adapters`) sont le port : ils les déclarent, ils
 * ne décident de rien.
 *
 * « Retourner » (au siège, au client) a déjà une seule porte, partagée par la
 * fiche du propriétaire et celle du cabinet : `retourner-au-client.tsx`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const RACINE = join(__dirname, "..");

/** La seule porte des gestes du circuit. */
const PORTE = "hooks/use-gestes-du-circuit.ts";
/** Le port HTTP : il déclare les méthodes, il ne décide d'aucun geste. */
const ADAPTATEURS = "verticals/malica-office/adapters/";
/** La seule porte de « Retourner ». */
const PORTE_DU_RETOUR = "components/malica/retourner-au-client.tsx";

function parcourir(dossier: string, trouves: string[] = []): string[] {
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) {
      if (nom !== "__tests__") parcourir(chemin, trouves);
    } else if (/\.(ts|tsx)$/.test(nom)) trouves.push(chemin);
  }
  return trouves;
}

/** Retire les commentaires, et rien d'autre : un exemple commenté ne prouve rien. */
function horsCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/** Ce qui n'appartient qu'à la porte : chaque appel, et le calcul des gestes. */
const A_LA_PORTE: ReadonlyArray<[RegExp, string]> = [
  [/\.\s*collab\s*\.\s*envoyer\s*\(/, "collab.envoyer"],
  [/\.\s*collab\s*\.\s*transmettreLesPieces\s*\(/, "collab.transmettreLesPieces"],
  [/\.\s*collab\s*\.\s*garderPiece\s*\(/, "collab.garderPiece"],
  [/\.\s*collab\s*\.\s*demanderSurPiece\s*\(/, "collab.demanderSurPiece"],
  [
    // Jusqu'à la fin de l'appel, arguments imbriqués compris (`exiger(id)`).
    /\.\s*collab\s*\.\s*setPieceVis\s*\([^;]*?["'](partage|personnel)["']/,
    "collab.setPieceVis vers « partage » ou « personnel »",
  ],
  [/\.\s*capture\s*\.\s*supprimer\s*\(/, "capture.supprimer"],
  [/\.\s*capture\s*\.\s*renvoyer\s*\(/, "capture.renvoyer"],
  [/piece_envoyer/, "piece_envoyer / piece_envoyer_en_lot"],
  [
    /["']collab["']\s*,\s*["'](envoyer|transmettreLesPieces|garderPiece|demanderSurPiece)["']/,
    "un appel RPC direct du circuit",
  ],
  [/["']capture["']\s*,\s*["'](supprimer|renvoyer)["']/, "un appel RPC direct du circuit"],
  [/\bgestesDuCircuit\s*\(/, "gestesDuCircuit(...) calculé hors de la porte"],
  [/\bresteAEnvoyer\s*\(/, "resteAEnvoyer(...) calculé hors de la porte"],
];

const fichiers = parcourir(RACINE).map((chemin) => ({
  nom: relative(RACINE, chemin).split("\\").join("/"),
  code: horsCommentaires(readFileSync(chemin, "utf8")),
}));

describe("les gestes du circuit n'ont qu'une porte", () => {
  it("parcourt bien l'application, et la porte existe", () => {
    expect(fichiers.length).toBeGreaterThan(100);
    expect(fichiers.some((f) => f.nom === PORTE)).toBe(true);
    expect(fichiers.some((f) => f.nom === PORTE_DU_RETOUR)).toBe(true);
  });

  it("aucun écran n'appelle la base pour un geste du circuit, ni ne calcule les gestes", () => {
    const fautes = fichiers
      .filter((f) => f.nom !== PORTE && !f.nom.startsWith(ADAPTATEURS))
      .flatMap((f) =>
        A_LA_PORTE.filter(([motif]) => motif.test(f.code)).map(([, quoi]) => `${f.nom} : ${quoi}`),
      );
    expect(fautes).toEqual([]);
  });

  it("la porte appelle bien chacune de ces méthodes : l'épreuve ne garde pas une porte vide", () => {
    const porte = fichiers.find((f) => f.nom === PORTE)!.code;
    for (const [motif, quoi] of A_LA_PORTE.slice(0, 7)) expect(porte, quoi).toMatch(motif);
  });

  it("« Retourner » ne part que de sa feuille", () => {
    const fautes = fichiers
      .filter((f) => f.nom !== PORTE_DU_RETOUR && !f.nom.startsWith(ADAPTATEURS))
      .filter((f) => /\.\s*supervision\s*\.\s*retourner\s*\(/.test(f.code))
      .map((f) => f.nom);
    expect(fautes).toEqual([]);
  });
});
