/**
 * Les délais que deux modules doivent tenir ensemble.
 *
 * PostgreSQL coupe une transaction restée inactive plus de
 * `ATTENTE_MAX_EN_TRANSACTION_MS` (db.ts). Un appel à un prestataire de paiement
 * se fait PENDANT la transaction qui verrouille le paiement : s'il attendait plus
 * longtemps, la base tuerait la transaction et un « payé » arrivé à temps chez le
 * prestataire serait perdu (audit du 23 novembre 2026). Le délai d'un appel
 * externe se déduit donc de celui de la base, avec une marge pour l'écriture qui
 * suit.
 */
export const ATTENTE_MAX_EN_TRANSACTION_MS = 10_000;

export const DELAI_APPEL_PRESTATAIRE_MS = Math.floor(ATTENTE_MAX_EN_TRANSACTION_MS * 0.7);
