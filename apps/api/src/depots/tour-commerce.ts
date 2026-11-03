/**
 * Le moteur commercial vu de la tour — factures, avoirs, encaissements,
 * gestes, passe mensuelle, réglages, et ce que la tour lit.
 *
 * Chaque méthode relaie une PORTE de la base (`plateforme.*`), qui refuse à
 * qui n'est pas opérateur de la plateforme, borne la saisie, motive et date
 * (20261119090000 à 20261119090800). Ce dépôt ne calcule aucun montant (R3),
 * n'écrit aucun taux ni aucune devise (R4) : il enchaîne les portes, et rend
 * le PDF d'une facture que la base vient d'émettre pour en inscrire
 * l'empreinte (c'est la seule chose que la base ne sait pas faire).
 *
 * La passe du mois tient dans UNE transaction (celle de l'appel) : chaque
 * cible s'y traite dans son sous-bloc, une facture refusée ne fait pas tomber
 * les autres, et un échec du rendu annule tout — aucun numéro perdu.
 */
import type { Requete } from "../db.ts";
import { lireDocument } from "../facturation/document/document.ts";
import { empreinte, GABARIT_DU_RENDU, rendreLaFacture } from "../facturation/document/rendu.ts";

/** L'adresse publique de l'espace client, si l'API la connaît : le lien « payer en ligne ». */
export function lienDePaiement(route: string | null | undefined): string | null {
  const base = process.env["MALICA_URL_PUBLIQUE"]?.trim().replace(/\/+$/, "");
  return base && route ? `${base}${route}` : null;
}

/**
 * Rend le PDF original d'une facture émise et en inscrit l'empreinte ; la
 * base pose alors le courriel si la tour n'a pas éteint l'envoi.
 */
async function inscrireLeDocument(db: Requete, factureId: string) {
  const document = await lireDocument(db, factureId, null);
  if (!document) throw new Error("refus.introuvable.facture");
  const pdf = rendreLaFacture(document, {
    lienPaiement: lienDePaiement(document.route_paiement),
  });
  const { rows } = await db.query<{ r: { envois: number } }>(
    "select plateforme.document_inscrire($1, $2, $3, $4) as r",
    [factureId, empreinte(pdf), GABARIT_DU_RENDU, document.langue],
  );
  return { facture_id: factureId, envois: rows[0]?.r.envois ?? 0 };
}

interface Cible {
  type: "licence" | "cabinet";
  id: string;
}

interface ResultatDeCible {
  resultat: string;
  facture_id: string | null;
  ttc: number | null;
}

async function passe(db: Requete, periode: string, mode: "apercu" | "reel") {
  const { rows } = await db.query<{ p: { passe_id: string; cibles: Cible[] } }>(
    "select plateforme.passe_ouvrir($1::date, $2) as p",
    [periode, mode],
  );
  const { passe_id, cibles } = rows[0]!.p;
  const resultats: ResultatDeCible[] = [];
  for (const c of cibles) {
    const { rows: r } = await db.query<{ r: { resultats: ResultatDeCible[] } }>(
      "select plateforme.passe_traiter($1, $2, $3) as r",
      [passe_id, c.type, c.id],
    );
    resultats.push(...r[0]!.r.resultats);
  }
  let documents = 0;
  let envois = 0;
  if (mode === "reel") {
    for (const r of resultats.filter((x) => x.resultat === "emise" && x.facture_id)) {
      const d = await inscrireLeDocument(db, r.facture_id!);
      documents += 1;
      envois += d.envois;
    }
  }
  const comptes: Record<string, number> = {};
  for (const r of resultats) comptes[r.resultat] = (comptes[r.resultat] ?? 0) + 1;
  return { passe_id, periode, mode, cibles: cibles.length, comptes, resultats, documents, envois };
}

export const commerceDeLaTour = {
  /* ------------------------------------------------------------- la passe du mois */

  /** « Aperçu du mois » : ce que l'émission ferait, sans rien émettre ni numéroter. */
  async apercuDuMois(db: Requete, periode: string) {
    return passe(db, periode, "apercu");
  },

  /** « Émettre le mois » : la passe réelle, reprise si elle a déjà couru. */
  async emettreLeMois(db: Requete, periode: string) {
    return passe(db, periode, "reel");
  },

  async passes(db: Requete) {
    const { rows } = await db.query(
      `select passe_id, periode::text, mode, lancee_le, comptes, ttc::text
         from plateforme.passes_v order by lancee_le desc limit 60`,
    );
    return rows;
  },

  async resultatsDePasse(db: Requete, passeId: string) {
    const { rows } = await db.query(
      `select r.licence_id, r.cabinet_tenant_id, r.payeur_type, r.resultat, r.refus_cle,
              r.montant_ht::text, r.montant_ttc::text, r.facture_id, f.numero
         from facturation.passe_resultats r
         left join facturation.factures f on f.id = r.facture_id
        where r.passe_id = $1
        order by r.created_at, r.id`,
      [passeId],
    );
    return rows;
  },

  /* ------------------------------------------------------------- factures et avoirs */

  async factures(db: Requete) {
    const { rows } = await db.query(
      `select facture_id, nature, numero, periode::text, emise_le::text, echeance_le::text,
              payeur_type, destinataire_nom, montant_ht::text, montant_ttc::text, devise,
              encaisse::text, reste_du::text, etat, jours_de_retard, avoirs::text, avoir_de,
              documents, envois
         from plateforme.factures_v
        order by emise_le desc, numero desc
        limit 500`,
    );
    return rows;
  },

  /** L'encours : les factures qui restent dues, la plus en retard d'abord. */
  async encours(db: Requete) {
    const { rows } = await db.query(
      `select facture_id, numero, periode::text, echeance_le::text, destinataire_nom,
              montant_ttc::text, encaisse::text, reste_du::text, etat, jours_de_retard, devise
         from plateforme.factures_v
        where nature = 'facture' and reste_du > 0 and etat not in ('annulee', 'irrecouvrable')
        order by jours_de_retard desc, echeance_le`,
    );
    return rows;
  },

  async emettreUnAvoir(
    db: Requete,
    factureId: string,
    montantHt: string | null,
    motif: string,
    cle: string | null,
  ) {
    const { rows } = await db.query<{ r: { facture_id: string; deja: boolean } }>(
      "select plateforme.avoir_emettre($1, $2::numeric, $3, $4) as r",
      [factureId, montantHt, motif, cle],
    );
    const avoir = rows[0]!.r;
    if (!avoir.deja) await inscrireLeDocument(db, avoir.facture_id);
    return avoir;
  },

  async deciderDUneFacture(db: Requete, factureId: string, decision: string, motif: string) {
    const { rows } = await db.query<{ r: unknown }>(
      "select plateforme.facture_decider($1, $2, $3) as r",
      [factureId, decision, motif],
    );
    return rows[0]?.r ?? null;
  },

  /* ------------------------------------------------------------- les encaissements */

  async saisirUnEncaissement(
    db: Requete,
    e: {
      factureId: string;
      montant: string;
      moyen: string;
      reference: string | null;
      encaisseLe: string;
      cle: string | null;
    },
  ) {
    const { rows } = await db.query<{ r: unknown }>(
      "select plateforme.encaissement_inscrire($1, $2::numeric, $3, $4, $5::date, $6) as r",
      [e.factureId, e.montant, e.moyen, e.reference, e.encaisseLe, e.cle],
    );
    return rows[0]?.r ?? null;
  },

  async annulerUnEncaissement(db: Requete, encaissementId: string, motif: string) {
    const { rows } = await db.query<{ r: unknown }>(
      "select plateforme.encaissement_annuler($1, $2) as r",
      [encaissementId, motif],
    );
    return rows[0]?.r ?? null;
  },

  /* ------------------------------------------------------------- les sept gestes */

  async accorderUneRemise(
    db: Requete,
    g: {
      licenceId: string;
      unite: "pourcentage" | "montant";
      valeur: string;
      payeurType: string;
      du: string;
      mois: number;
      motif: string;
      cle: string | null;
    },
  ) {
    const { rows } = await db.query<{ r: unknown }>(
      `select plateforme.remise_accorder($1, $2, $3::numeric, $4, $5::date, $6::smallint, $7, $8) as r`,
      [g.licenceId, g.unite, g.valeur, g.payeurType, g.du, g.mois, g.motif, g.cle],
    );
    return rows[0]?.r ?? null;
  },

  async offrirDesMois(
    db: Requete,
    g: {
      licenceId: string;
      payeurType: string;
      du: string;
      nombre: number;
      motif: string;
      cle: string | null;
    },
  ) {
    const { rows } = await db.query<{ r: unknown }>(
      "select plateforme.mois_offrir($1, $2, $3::date, $4::smallint, $5, $6) as r",
      [g.licenceId, g.payeurType, g.du, g.nombre, g.motif, g.cle],
    );
    return rows[0]?.r ?? null;
  },

  async offrirDesLectures(
    db: Requete,
    licenceId: string,
    nombre: number,
    motif: string,
    cle: string | null,
  ) {
    const { rows } = await db.query<{ r: unknown }>(
      "select plateforme.lectures_offrir($1, $2::integer, $3, $4) as r",
      [licenceId, nombre, motif, cle],
    );
    return rows[0]?.r ?? null;
  },

  async prolongerLEssai(
    db: Requete,
    licenceId: string,
    jours: number,
    motif: string,
    cle: string | null,
  ) {
    const { rows } = await db.query<{ r: unknown }>(
      "select plateforme.essai_prolonger($1, $2::smallint, $3, $4) as r",
      [licenceId, jours, motif, cle],
    );
    return rows[0]?.r ?? null;
  },

  async annulerUnGeste(db: Requete, gesteId: string, motif: string, cle: string | null) {
    const { rows } = await db.query<{ r: unknown }>(
      "select plateforme.geste_annuler($1, $2, $3) as r",
      [gesteId, motif, cle],
    );
    return rows[0]?.r ?? null;
  },

  async suspendre(db: Requete, licenceId: string, motif: string) {
    const { rows } = await db.query<{ r: unknown }>("select plateforme.suspendre($1, $2) as r", [
      licenceId,
      motif,
    ]);
    return rows[0]?.r ?? null;
  },

  async reprendre(db: Requete, licenceId: string, motif: string) {
    const { rows } = await db.query<{ r: unknown }>("select plateforme.reprendre($1, $2) as r", [
      licenceId,
      motif,
    ]);
    return rows[0]?.r ?? null;
  },

  /** Les gestes, notes internes comprises, avec leur libellé dans la langue de l'opérateur. */
  async gestes(db: Requete, locale: string) {
    const { rows } = await db.query(
      `select e.id, e.licence_id, e.acte, coalesce(l.value, f.value, e.acte) as libelle,
              e.valeur::text, e.payeur_type, e.effet_du::text, e.effet_au::text, e.motif,
              e.operateur, e.created_at, e.annule, e.annule_par, e.en_vigueur,
              e.visible_client, e.societes
         from plateforme.exceptions_v e
         left join ref_labels_v l on l.ns = 'acte_intervention' and l.key = e.acte and l.locale = $1
         left join ref_labels_v f on f.ns = 'acte_intervention' and f.key = e.acte and f.locale = 'fr'
        order by e.created_at desc
        limit 500`,
      [locale],
    );
    return rows;
  },

  /** Le stock de lectures dues, licence par licence (décision 9 : montré dans la tour). */
  async lecturesDues(db: Requete) {
    const { rows } = await db.query(
      `select d.licence_id, d.credits, d.puisees, d.offertes, d.solde, d.dernier_mois_clos::text,
              (select string_agg(o.name, ', ' order by o.name)
                 from facturation.licence_organisations lo
                 join identity.organizations o on o.id = lo.tenant_id
                where lo.licence_id = d.licence_id) as societes
         from facturation.lectures_dues_v d
        where d.credits > 0 or d.solde > 0
        order by d.solde desc, d.licence_id`,
    );
    return rows;
  },

  /* ------------------------------------------------------------- les réglages */

  async reglageCommercial(db: Requete) {
    const { rows } = await db.query<{ r: unknown }>(
      `select (select to_jsonb(r) - 'decide_par' from plateforme.reglages_commerciaux r
                order by r.decide_le desc, r.id desc limit 1) as r`,
    );
    return rows[0]?.r ?? null;
  },

  async reglerLesPlafonds(
    db: Requete,
    p: {
      remisePctMax: string;
      remiseMontantMaxMois: string;
      remiseDureeMaxMois: number;
      moisOffertsMax: number;
      lecturesOffertesMax: number;
      prolongationEssaiMaxJours: number;
      fenetreCumulMois: number;
    },
    motif: string,
  ) {
    const { rows } = await db.query<{ r: unknown }>(
      `select plateforme.commerce_regler($1::numeric, $2::numeric, $3::smallint, $4::smallint,
                                         $5::integer, $6::smallint, $7::smallint, $8) as r`,
      [
        p.remisePctMax,
        p.remiseMontantMaxMois,
        p.remiseDureeMaxMois,
        p.moisOffertsMax,
        p.lecturesOffertesMax,
        p.prolongationEssaiMaxJours,
        p.fenetreCumulMois,
        motif,
      ],
    );
    return rows[0]?.r ?? null;
  },

  async reglageDeFacturation(db: Requete) {
    const { rows } = await db.query<{ r: unknown }>(
      `select (select to_jsonb(r) - 'decide_par' from plateforme.reglages_facturation r
                order by r.decide_le desc, r.id desc limit 1) as r`,
    );
    return rows[0]?.r ?? null;
  },

  async reglerLaFacturation(
    db: Requete,
    envoiCourriel: boolean,
    joursEcheance: number,
    tentativesMax: number,
    motif: string,
  ) {
    const { rows } = await db.query<{ r: unknown }>(
      "select plateforme.facturation_regler($1, $2::smallint, $3::smallint, $4) as r",
      [envoiCourriel, joursEcheance, tentativesMax, motif],
    );
    return rows[0]?.r ?? null;
  },

  /** Le report des lectures non consommées : aucun, un mois, à vie. */
  async reglerLeReport(db: Requete, regle: string, motif: string) {
    const { rows } = await db.query<{ r: unknown }>(
      "select plateforme.report_regler($1, $2) as r",
      [regle, motif],
    );
    return rows[0]?.r ?? null;
  },
};
