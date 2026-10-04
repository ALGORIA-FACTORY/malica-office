/**
 * Quand la réponse de Malica passe par le comptable — et quand elle part seule.
 *
 * ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
 *
 * 4 octobre 2026, premier essai réel. « Donne le taux de TVA en Tunisie en
 * 2026 ? » — une question de droit général, que le corpus couvre. Réponse
 * reçue : « Votre comptable relit ma réponse ». Idem pour la suivante. Aucune
 * réponse de fond, jamais.
 *
 * La règle d'alors retenait sur la CERTITUDE : au-dessous du seuil du cabinet,
 * la réponse partait en relecture. Or la certitude tombe mécaniquement à zéro
 * dès qu'aucune source n'est retrouvée — et ce jour-là, la recherche rendait
 * un article abrogé, donc aucune source valide. Toute question devenait un
 * arbitrage, y compris celles dont la réponse est au Journal officiel.
 *
 * ===================================================================== LA RÈGLE
 *
 * Ce n'est pas l'assurance de Malica qui décide, c'est la NATURE de la
 * question :
 *
 *   — une question générale, réglementaire ou documentaire : elle part, avec
 *     ses sources et leur date. Le droit n'appartient à personne.
 *   — un avis qui ENGAGE LE DOSSIER du client — appliquer la règle à ses
 *     chiffres, à son régime, à sa situation : le comptable relit. C'est lui
 *     qui signe.
 *   — le corpus muet : on le dit. On ne fait pas relire un silence, et l'on
 *     n'invente pas de texte.
 *
 * La certitude n'est pas jetée : elle reste affichée à la personne et au
 * cabinet. Elle informe ; elle ne décide plus.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { doitEtreRelue, partAuCabinet } from "./conseil.ts";

const GENERALE = { conseil: true, portee: "generale" as const, certitude: 0.2 };
const ENGAGEANTE = { conseil: true, portee: "dossier" as const, certitude: 0.95 };
const AMBIGUE = { conseil: true, portee: "incertaine" as const, certitude: 0.8 };
const HORS_CONSEIL = { conseil: false, portee: "generale" as const, certitude: 1 };

const SOUS_MANDAT = { appelantMembre: true, cabinetId: "un-cabinet" };
const SANS_CABINET = { appelantMembre: true, cabinetId: null };
const LE_CABINET_LUI_MEME = { appelantMembre: false, cabinetId: "un-cabinet" };

describe("faut-il faire relire la réponse", () => {
  it("une question générale part, même avec une certitude basse", () => {
    assert.equal(doitEtreRelue(GENERALE, SOUS_MANDAT), false);
  });

  it("un avis qui engage le dossier passe par le comptable", () => {
    assert.equal(doitEtreRelue(ENGAGEANTE, SOUS_MANDAT), true);
  });

  it("une question hors conseil part : elle ne demande aucune règle", () => {
    assert.equal(doitEtreRelue(HORS_CONSEIL, SOUS_MANDAT), false);
  });

  it("sans cabinet mandaté, rien n'est retenu : il n'y a personne pour relire", () => {
    // Retenir ici laisserait la personne attendre une validation qui ne
    // viendrait jamais. On répond, et l'on dit qu'aucun cabinet ne suit.
    assert.equal(doitEtreRelue(ENGAGEANTE, SANS_CABINET), false);
  });

  it("le cabinet qui interroge le dossier de son client ne s'arbitre pas lui-même", () => {
    assert.equal(doitEtreRelue(ENGAGEANTE, LE_CABINET_LUI_MEME), false);
  });

  it("une question AMBIGUË part en relecture : dans le doute, le comptable tranche", () => {
    // Demandé le 4 octobre 2026. Une réponse dont on ignore la nature peut
    // engager quelqu'un : elle attend. Une réponse relue arrive un peu plus
    // tard ; un avis engageant lâché trop vite ne se rattrape pas.
    assert.equal(doitEtreRelue(AMBIGUE, SOUS_MANDAT), true);
  });

  it("une portée absente ou illisible vaut « incertaine », donc relecture", () => {
    // Le schéma retombe sur « incertaine » : un modèle qui bafouille ne doit
    // pas faire partir un avis par défaut.
    const bafouille = { conseil: true, portee: "incertaine" as const, certitude: 0.5 };
    assert.equal(doitEtreRelue(bafouille, SOUS_MANDAT), true);
  });

  it("la certitude n'entre plus dans la décision", () => {
    // Deux réponses identiques en nature, aux deux extrémités de l'assurance :
    // elles doivent être traitées pareil. C'est tout le défaut du 4 octobre.
    const sure = { conseil: true, portee: "generale" as const, certitude: 1 };
    const incertaine = { conseil: true, portee: "generale" as const, certitude: 0 };
    assert.equal(doitEtreRelue(sure, SOUS_MANDAT), doitEtreRelue(incertaine, SOUS_MANDAT));
  });
});

describe("ce que le cabinet voit", () => {
  it("une réponse rendue directement ne part PAS au cabinet", () => {
    // La conversation appartient à la personne. Le cabinet la consulte si elle
    // la partage, pas parce qu'il est mandaté.
    assert.equal(partAuCabinet(false), false);
  });

  it("une réponse retenue part au cabinet : c'est le seul chemin du retour", () => {
    assert.equal(partAuCabinet(true), true);
  });
});
