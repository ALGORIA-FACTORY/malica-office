/**
 * LES MÉTHODES QUI VENDENT — refusées à l'application installée depuis un
 * store (règles de Google Play sur les biens numériques, décision du
 * 22 octobre 2026). Le paiement, les prix, les offres, les recharges et
 * l'acceptation d'un abonnement se font sur le web et la PWA. UNE liste,
 * lue par le serveur (refus 403 à une coque, `apps/api/src/app.ts`) et par la
 * CI (`outils/coque-sans-commerce.mjs` : aucun de ces noms dans le bundle de
 * la coque). Une méthode commerciale ajoutée au dépôt `facturation` s'ajoute
 * ici ; `la-coque-ne-vend-rien.test.ts` vérifie que chaque nom existe.
 */
export const METHODES_COMMERCIALES: ReadonlySet<string> = new Set([
  "mesOffres",
  "prixTtc",
  "monReport",
  "monAnnuel",
  "souscrireAnnuel",
  "changerForfait",
  "mesPaiements",
  "payerEnLigne",
  "moyensDePaiementEnLigne",
  "verifierPaiement",
  "simulerPaiement",
  "paliersDeRecharge",
  "mesRecharges",
  "acheterRecharge",
  "maRechargeAutomatique",
  "reglerRechargeAutomatique",
  "abonnementsPourMoi",
  "repondreAbonnement",
  "offresDuCabinet",
  "proposerAbonnement",
  "abonnementsDuCabinet",
  "facturesDuCabinet",
  "lignesDeFacture",
  // Une invitation acceptée au-delà des places incluses ajoute une place payée
  // (`facturation.droits_v`, `prix_siege_sup`) : c'est un achat.
  "inviterSiege",
  "inviterProprietaire",
]);
