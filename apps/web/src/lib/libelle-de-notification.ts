/**
 * Ce qu'une notification dit, en mots — une source, pour l'écran des
 * notifications et pour la cloche de l'en-tête (planches 2 et 12, approuvées
 * le 7 novembre 2026). Deux copies de ces genres finiraient par dire deux
 * choses différentes du même événement.
 */
import type { MessageKey } from "@/i18n";
import { phraseDeLaReponse } from "@/lib/demande-sur-piece";

/** Les genres que la base pose sur le dossier d'une PME, et leur phrase. */
const GENRES: Record<string, MessageKey> = {
  "piece.retournee": "notif.kind.piece.retournee",
  "piece.validee": "notif.kind.piece.validee",
  "piece.partagee": "notif.kind.piece.partagee",
  "pv.envoye": "notif.kind.pv.envoye",
  "mandat.propose": "notif.kind.mandat.propose",
  "mandat.accepte": "notif.kind.mandat.accepte",
  "mandat.refuse": "notif.kind.mandat.refuse",
  // ANO-037 : ces genres arrivent aussi sur le dossier de la PME, et
  // tombaient sous « Un événement du dossier. ».
  "mandat.revoque": "notif.kind.mandat.revoque",
  "piece.a_valider": "notif.kind.piece.a_valider",
  "piece.a_revalider": "notif.kind.piece.a_revalider",
  "piece.demande_tranchee": "notif.kind.piece.demande_tranchee",
  "acces.propose": "notif.kind.acces.propose",
  "acces.accepte": "notif.kind.acces.accepte",
  "acces.repris": "notif.kind.acces.repris",
  // La page Clients unique (8 novembre 2026).
  "acces.monte": "notif.kind.acces.monte",
  "acces.arrete": "notif.kind.acces.arrete",
  "acces.descente_demandee": "notif.kind.acces.descente_demandee",
  "place.donnee": "notif.kind.place.donnee",
  "place.suggeree": "notif.kind.place.suggeree",
  "conseil.arbitrage": "notif.kind.conseil.arbitrage",
  "conseil.repondu": "notif.kind.conseil.repondu",
  "conseil.decide": "notif.kind.conseil.decide",
  "piece.reponse_client": "notif.kind.piece.reponse_client",
  "piece.renvoyee": "notif.kind.piece.renvoyee",
  "piece.remplacee": "notif.kind.piece.remplacee",
  "piece.gardee": "notif.kind.piece.gardee",
  "piece.supprimee": "notif.kind.piece.supprimee",
  "piece.archivee": "notif.kind.piece.archivee",
  // Le circuit siège → propriétaire (lot 4) : adressées à la personne.
  "piece.recue_du_siege": "notif.kind.piece.recue_du_siege",
  "piece.retournee_par_le_proprietaire": "notif.kind.piece.retournee_par_le_proprietaire",
  "piece.supprimee_par_le_proprietaire": "notif.kind.piece.supprimee_par_le_proprietaire",
  "piece.demande": "notif.kind.piece.demande",
  // Une alerte par jour d'échéance, avec leur nombre — jamais la composition
  // (décision du 22 novembre 2026).
  "echeance.approche": "notif.kind.echeance.approche",
  // La facture d'abonnement émise par Malica Office (23 novembre 2026) : elle mène à
  // l'abonnement, où elle se télécharge.
  "facture.emise.pme": "notif.kind.facture.emise.pme",
  // Payée d'abord, la facture naît réglée ; tout paiement confirmé se dit (24 novembre 2026).
  "facture.reglee.pme": "notif.kind.facture.reglee.pme",
  // Une recharge payée a sa facture, née réglée (R-04, 25 novembre 2026).
  "facture.recharge.pme": "notif.kind.facture.recharge.pme",
  "paiement.recu": "notif.kind.paiement.recu",
  "paiement.recu.cabinet": "notif.kind.paiement.recu",
  // Une descente programmée que l'échéance refuse se dit (revue du 24 novembre 2026, T6).
  "abonnement.descente_refusee": "notif.kind.abonnement.descente_refusee",
  // L'essai gratuit : sa fin proche, et sa fin (25 novembre 2026).
  "essai.fin_proche": "notif.kind.essai.fin_proche",
  "essai.termine": "notif.kind.essai.termine",
  // Ce qui est dû (D7, D12) : à payer, fermeture proche, fermé.
  "abonnement.a_payer": "notif.kind.abonnement.a_payer",
  "abonnement.fermeture_proche": "notif.kind.abonnement.fermeture_proche",
  "abonnement.ferme": "notif.kind.abonnement.ferme",
};

export function chaine(payload: Record<string, unknown>, cle: string): string | null {
  const v = payload[cle];
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

/**
 * Ce que la notification porte en plus de son genre : un titre de PV et le
 * cabinet qui l'envoie, le cabinet qui propose, le sujet d'une question, la
 * note d'un retour. Tel que range, jamais recompose.
 */
export function detailDe(kind: string, payload: Record<string, unknown>): string | null {
  if (kind === "pv.envoye") {
    return (
      [chaine(payload, "titre"), chaine(payload, "cabinet")].filter(Boolean).join(" · ") || null
    );
  }
  if (kind.startsWith("mandat.")) return chaine(payload, "cabinet");
  // L'offre proposée et la comptabilité qui la propose — jamais un prix.
  if (kind.startsWith("place.")) {
    return (
      [chaine(payload, "email"), chaine(payload, "cabinet")].filter(Boolean).join(" · ") || null
    );
  }
  if (kind.startsWith("acces.") && kind !== "acces.accepte" && kind !== "acces.repris") {
    const offre = chaine(payload, "offre");
    return (
      [offre ? offre.charAt(0).toUpperCase() + offre.slice(1) : null, chaine(payload, "cabinet")]
        .filter(Boolean)
        .join(" · ") || null
    );
  }
  if (kind.startsWith("conseil.")) return chaine(payload, "theme");
  return chaine(payload, "note");
}

/**
 * La phrase d'une notification : son genre, le verdict d'une demande tranchée,
 * ou — pour une prise en charge qui a démarré (acceptée, ou d'elle-même à
 * l'arrivée du dirigeant) — ce qu'elle est devenue. « Propose de prendre votre
 * abonnement en charge » se lisait d'une offre déjà en cours (recette du
 * 11 novembre 2026) ; la base pose l'issue sur l'alerte (`tranchee`).
 */
/**
 * Ce que la phrase du genre attend en plus de sa clé. L'échéance qui approche
 * dit son jour et le nombre de déclarations de ce jour, rien d'autre.
 */
export function variablesDuGenre(
  kind: string,
  payload: Record<string, unknown>,
  locale: string,
): Record<string, string | number> | undefined {
  if (kind !== "echeance.approche") return undefined;
  const iso = chaine(payload, "due_date");
  const nombre = Number(payload["nombre"]);
  const jour = iso ? new Date(`${iso}T12:00:00Z`) : null;
  return {
    count: Number.isFinite(nombre) && nombre > 0 ? nombre : 1,
    date:
      jour && !Number.isNaN(jour.getTime())
        ? new Intl.DateTimeFormat(locale, {
            day: "numeric",
            month: "long",
            timeZone: "UTC",
          }).format(jour)
        : "",
  };
}

export function cleDuGenre(kind: string, payload: Record<string, unknown> = {}): MessageKey {
  if (kind === "piece.demande_tranchee") return phraseDeLaReponse(payload);
  if (kind === "acces.propose" && payload["tranchee"] === "actif")
    return "notif.kind.acces.accepte";
  return GENRES[kind] ?? "cab.notif.kind.autre";
}

/**
 * Où mène une alerte d'abonnement ou de mandat. Une PROPOSITION encore ouverte
 * se répond ; une information (l'offre a été montée, arrêtée, la proposition a
 * déjà sa réponse) mène à l'abonnement sans promettre de proposition ; un
 * mandat qui a sa réponse ne se propose plus à l'acceptation.
 */
export function gesteDeLaQuestion(
  kind: string,
  payload: Record<string, unknown> = {},
): "proposition" | "abonnement" | "mandat" | null {
  const ouverte = payload["tranchee"] === undefined;
  if (kind === "acces.propose" || kind === "acces.descente_demandee")
    return ouverte ? "proposition" : "abonnement";
  if (kind === "acces.monte" || kind === "acces.arrete" || parleDAbonnement(kind))
    return "abonnement";
  if (kind === "mandat.propose") return ouverte ? "mandat" : null;
  return null;
}

/**
 * Ce qui attend un GESTE de la personne : un retour, une demande, une
 * validation, une proposition. C'est ce que la cloche compte — pas tout le
 * non lu (planche 2, option A, approuvée le 7 novembre 2026) : 34 choses à
 * faire se lisent, 108 alertes non lues se subissent.
 */
const ATTENDENT_UN_GESTE: ReadonlySet<string> = new Set([
  "piece.retournee",
  "piece.demande",
  "piece.a_valider",
  "piece.a_revalider",
  "piece.recue_du_siege",
  "piece.retournee_par_le_proprietaire",
  "mandat.propose",
  "acces.propose",
  "acces.descente_demandee",
  "place.suggeree",
]);

export function attendUnGeste(n: { kind: string; readAt: string | null }): boolean {
  return n.readAt === null && ATTENDENT_UN_GESTE.has(n.kind);
}

/**
 * Dans l'application installée depuis un store, rien ne parle d'abonnement
 * (décisions des 20 et 22 octobre, rappelées le 7 novembre 2026) : les
 * alertes `acces.*` — « votre comptabilité prend votre abonnement en charge »
 * — ne s'y montrent pas, ni à la cloche ni à l'écran. La facture d'abonnement
 * (`facture.emise.pme`, 23 novembre 2026) non plus : elle mène à l'abonnement.
 */
export function seMontreIci(kind: string, coque: boolean): boolean {
  return !(coque && (kind.startsWith("acces.") || parleDAbonnement(kind)));
}

/** Les factures, les paiements et les changements d'offre d'une société : ils mènent à l'abonnement. */
const DE_L_ABONNEMENT: ReadonlySet<string> = new Set([
  "facture.emise.pme",
  "facture.reglee.pme",
  "facture.recharge.pme",
  "paiement.recu",
  "abonnement.descente_refusee",
  "essai.fin_proche",
  "essai.termine",
  "abonnement.a_payer",
  "abonnement.fermeture_proche",
  "abonnement.ferme",
]);

function parleDAbonnement(kind: string): boolean {
  return DE_L_ABONNEMENT.has(kind);
}
