/**
 * Un bloc de réponse, mis à plat pour l'impression : un titre, un sous-titre,
 * des lignes de texte déjà écrit.
 *
 * Pur. Il ne calcule ni ne reformate rien : chaque cellule est une valeur que
 * le serveur a composée et que l'écran affiche déjà. Le PDF et l'écran disent
 * donc exactement la même chose.
 */
import type { BlocDeReponse } from "@malica/socle/ports/assistant";

export interface BlocImprimable {
  titre: string;
  /** La période et le périmètre, quand le bloc les porte. */
  sousTitre: string;
  entete: string[];
  lignes: string[][];
  /** Les lignes de total, en gras après les lignes. */
  totaux: string[][];
  /** Pour chaque colonne : un nombre s'aligne à la fin, un texte au début. */
  numerique: boolean[];
  /** D'où viennent les chiffres. */
  pied: string;
}

/** Une valeur et son unité, comme l'écran les montre ; un tiret pour une absence. */
const avecUnite = (valeur: string | null, unite: string | null): string =>
  valeur === null ? "—" : unite ? `${valeur} ${unite}` : valeur;

export function blocImprimable(bloc: BlocDeReponse): BlocImprimable {
  const commun = {
    titre: bloc.titre,
    sousTitre: [bloc.periode, bloc.perimetre].filter(Boolean).join(" · "),
    pied: bloc.source,
  };
  switch (bloc.type) {
    case "reponse_cle":
      return {
        ...commun,
        entete: [],
        lignes: bloc.details.map((d) => [d.libelle, avecUnite(d.valeur, d.unite)]),
        totaux: [[bloc.cle.libelle, avecUnite(bloc.cle.valeur, bloc.cle.unite)]],
        numerique: [false, true],
      };
    case "tableau":
      return {
        ...commun,
        entete: bloc.colonnes.map((c) => c.libelle),
        lignes: bloc.lignes.map((l) => bloc.colonnes.map((c) => l[c.id] ?? "")),
        totaux: bloc.total ? [bloc.colonnes.map((c) => bloc.total?.[c.id] ?? "")] : [],
        numerique: bloc.colonnes.map((c) => c.numerique),
      };
    case "graphique": {
      const periodes = bloc.series[0]?.points.map((p) => p.etiquette) ?? [];
      return {
        ...commun,
        entete: ["", ...bloc.series.map((s) => (bloc.unite ? `${s.nom} (${bloc.unite})` : s.nom))],
        lignes: periodes.map((etiquette, i) => [
          etiquette,
          ...bloc.series.map((s) => s.points[i]?.valeur ?? "—"),
        ]),
        totaux: [],
        numerique: [false, ...bloc.series.map(() => true)],
      };
    }
    case "cascade":
      return {
        ...commun,
        entete: [],
        lignes: bloc.etapes.slice(0, -1).map((e) => [e.libelle, avecUnite(e.valeur, bloc.unite)]),
        totaux: bloc.etapes.slice(-1).map((e) => [e.libelle, avecUnite(e.valeur, bloc.unite)]),
        numerique: [false, true],
      };
  }
}
