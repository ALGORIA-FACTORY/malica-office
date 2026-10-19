/**
 * L'abonnement — le forfait, les places, ce que chaque société consomme.
 *
 * Ce dépôt n'ajoute AUCUNE logique à ce que la base rend (R3). Il ne compte
 * pas les places, ne calcule pas un plafond, ne somme rien, ne filtre ni ne
 * trie : la question est posée à une vue ou à une fonction, la réponse est
 * relayée telle quelle. Les montants restent des chaînes (`numeric`), les
 * motifs des codes — l'écran les traduit (R4).
 *
 * « La licence de l'appelant » est une condition des vues, pas un filtre d'ici :
 * elles ne rendent que la licence dont l'appelant est titulaire, et la RLS des
 * tables sous-jacentes s'applique à lui (`security_invoker`).
 *
 * Le plafond mord dans la base, jamais ici : `inviterSiege` délègue à
 * `public.siege_inviter`, qui refuse la place de trop.
 */

import type { Requete } from "../db.ts";
import {
  enMillimes,
  prestataireDuReglage,
  type ReglagePaiement,
} from "../paiement/prestataires.ts";

/** Un paiement en ligne, tel que `facturation.paiements_en_ligne_v` le rend. */
interface PaiementLu {
  paiement_id: string;
  objet: "montee" | "recharge";
  libelle: string;
  montant_ht: string;
  montant_tva: string;
  montant_ttc: string;
  devise: string;
  etat: "a_payer" | "lien_cree" | "paye" | "refuse";
  prestataire: string | null;
  reference: string | null;
  lien: string | null;
  impute: boolean;
  cree_le: string;
}

const COLONNES_PAIEMENT = `paiement_id, objet, libelle, montant_ht, montant_tva, montant_ttc, devise,
  etat, prestataire, reference, lien, impute, cree_le`;

/** Le prestataire que la tour a ouvert (`public.paiement_reglage()`), ou `null`. */
async function prestataireOuvert(db: Requete) {
  const { rows } = await db.query<{ r: ReglagePaiement }>(`select public.paiement_reglage() as r`);
  return rows[0] ? prestataireDuReglage(rows[0].r) : null;
}

async function lirePaiement(db: Requete, paiementId: string): Promise<PaiementLu> {
  const { rows } = await db.query<PaiementLu>(
    `select ${COLONNES_PAIEMENT} from facturation.paiements_en_ligne_v where paiement_id = $1`,
    [paiementId],
  );
  if (!rows[0]) throw new Error("paiement.introuvable");
  return rows[0];
}

/**
 * Inscrire ce que le prestataire a dit. Pour le simulateur, l'API le DÉCLARE à
 * la transaction : la base ne l'admet qu'à cette condition, et l'API ne le
 * déclare que si la tour a ouvert le simulateur — dont les « payés » ne
 * s'imputent jamais sur une facture.
 */
async function inscrire(
  db: Requete,
  paiementId: string,
  etat: "lien_cree" | "paye" | "refuse",
  prestataire: string,
  reference: string | null,
  lien: string | null,
  detail: Record<string, unknown> = {},
): Promise<PaiementLu> {
  if (prestataire === "simulateur") {
    await db.query(`select set_config('malica.paiement_simulateur', 'oui', true)`);
  }
  await db.query(`select public.paiement_inscrire($1, $2, $3, $4, $5, $6::jsonb)`, [
    paiementId,
    etat,
    prestataire,
    reference,
    lien,
    JSON.stringify(detail),
  ]);
  return lirePaiement(db, paiementId);
}

export const facturation = {
  /**
   * Le forfait de l'appelant. Titulaire : la ligne entière. Membre d'une
   * organisation de la licence (un collaborateur) : le compteur de lectures
   * seul, offre, prix et places à `null` — c'est la base qui le décide. `null`
   * quand l'appelant n'est rattaché à aucune licence. Plusieurs licences
   * détenues : la base rend la première par identifiant.
   */
  async monForfait(db: Requete) {
    const { rows } = await db.query(
      `select offre, statut, lectures_droit, lectures_consommees, lectures_restantes,
              organisations, sieges_occupes, sieges_inclus, sieges_max, prix_mensuel_ht
         from public.mon_forfait()`,
    );
    return rows[0] ?? null;
  },

  /**
   * Les états qu'une licence peut porter, et leurs motifs de suspension, dits
   * dans la langue de la personne.
   *
   * ================================================================= POURQUOI
   *
   * L'écran des réglages imprimait `monForfait().statut` tel quel sous « État
   * de la licence » : `active`, `suspendue`, `resiliee`. Il ne pouvait pas
   * faire mieux — `champ-lisible.ts` note à juste titre que ces codes ne sont
   * pas une énumération fermée du côté de l'écran, et une table de traduction
   * écrite en TypeScript aurait été la constante que R4 interdit.
   *
   * L'énumération est fermée là où elle est écrite : la contrainte `check` de
   * `facturation.licences`. Ses libellés vivent donc dans `ref.labels`, comme
   * les motifs de rejet, et c'est cette liste-là que l'écran lit.
   *
   * Le repli sur le français est explicite : un libellé sans traduction
   * s'affiche, il ne vide pas la ligne. Ce n'est pas un repli implicite au sens
   * de R4 — il ne choisit pas une juridiction, il choisit une langue de
   * secours, et on le voit.
   */
  async libellesDesStatuts(db: Requete, locale: string) {
    /*
     * Les deux espaces de noms sont écrits EN TOUTES LETTRES, deux fois, et
     * non passés en paramètre. `scan/le-referentiel-se-traduit.test.ts` relève
     * dans le code les `ns = '…'` littéraux pour s'assurer qu'aucun namespace
     * de `ref.labels` n'est semé sans être lu. Une requête paramétrée lui
     * serait invisible : le garde dirait « orphelin » sur un namespace bien
     * joint, ou — pire s'il était assoupli — se tairait sur un vrai orphelin.
     */
    const { rows: statuts } = await db.query<{ code: string; libelle: string }>(
      `select l.key as code, coalesce(demandee.value, francais.value, l.key) as libelle
         from (select distinct key from ref_labels_v where ns = 'licence_statut') l
         left join ref_labels_v demandee
           on demandee.ns = 'licence_statut' and demandee.key = l.key
          and demandee.locale = $1
         left join ref_labels_v francais
           on francais.ns = 'licence_statut' and francais.key = l.key
          and francais.locale = 'fr'
        order by l.key`,
      [locale],
    );

    const { rows: motifs } = await db.query<{ code: string; libelle: string }>(
      `select l.key as code, coalesce(demandee.value, francais.value, l.key) as libelle
         from (select distinct key from ref_labels_v where ns = 'licence_motif_suspension') l
         left join ref_labels_v demandee
           on demandee.ns = 'licence_motif_suspension' and demandee.key = l.key
          and demandee.locale = $1
         left join ref_labels_v francais
           on francais.ns = 'licence_motif_suspension' and francais.key = l.key
          and francais.locale = 'fr'
        order by l.key`,
      [locale],
    );

    return { statuts, motifsDeSuspension: motifs };
  },

  /** Les membres de toutes les organisations de la licence. */
  async sieges(db: Requete) {
    const { rows } = await db.query(
      `select user_id, nom, role, tenant_id, organisation
         from licence_sieges_v order by organisation, role, nom, user_id`,
    );
    return rows;
  },

  /** Les organisations de la licence, et ce que chacune a consommé ce mois-ci. */
  async organisations(db: Requete) {
    const { rows } = await db.query(
      `select tenant_id, nom, lectures_consommees
         from licence_organisations_v order by nom, tenant_id`,
    );
    return rows;
  },

  /**
   * Inviter un collaborateur sur une organisation de la licence.
   *
   * La base refuse si la licence est au complet, et si l'appelant n'est pas le
   * dirigeant de l'organisation. Rend l'invitation, comme `collab.inviter`.
   */
  async inviterSiege(db: Requete, email: string, tenantId: string) {
    const { rows } = await db.query<{
      r: { id: string; email: string; role: string; expiresAt: string; deja: boolean };
    }>(`select public.siege_inviter($1, $2) as r`, [tenantId, email]);
    const r = rows[0]?.r;
    if (!r) throw new Error("invitation.non_creee");
    return { ...r, deja: Boolean(r.deja) };
  },

  /**
   * Reprendre la place d'un membre. `{ libere, motif?, pieces }` : tant qu'il
   * reste des pièces personnelles à trancher, la base répond `libere: false` et
   * le CODE du motif.
   */
  async libererPlace(db: Requete, tenantId: string, membre: string) {
    const { rows } = await db.query<{
      r: { libere: boolean; motif?: string; pieces: number };
    }>(`select public.siege_reprendre_sa_place($1, $2) as r`, [tenantId, membre]);
    const r = rows[0]?.r;
    if (!r) throw new Error("siege.non_libere");
    return r;
  },

  /* ----------------------------------------------- l'abonnement se choisit */

  /**
   * La grille en vigueur, offre par offre, avec ce qui empêcherait d'y passer
   * (`empechement`, un CODE, et ses `chiffres`) et l'offre courante. La base
   * décide ; l'écran montre.
   */
  async mesOffres(db: Requete, tenantId?: string) {
    const { rows } = await db.query(
      `select code, libelle, rang, prix_mensuel_ht, lectures_par_organisation, lectures_incluses,
              sieges_inclus, sieges_max, organisations_incluses, organisations_max,
              courant, empechement, chiffres, prix_ttc
         from public.mes_offres($1)`,
      [tenantId ?? null],
    );
    return rows;
  },

  /**
   * Le TTC d'un montant HT, par la fiscalité de la facture : TVA en vigueur et
   * droit de timbre. `null` tant qu'aucun émetteur n'est désigné (R4).
   */
  async prixTtc(db: Requete, ht: string | number) {
    const { rows } = await db.query<{ r: Record<string, unknown> | null }>(
      `select public.prix_ttc($1::numeric) as r`,
      [String(ht)],
    );
    return rows[0]?.r ?? null;
  },

  /**
   * L'année : l'engagement en cours, ou ce que l'année coûterait et ce qui la
   * ferme. `null` pour qui n'est pas propriétaire principal — c'est lui qui paie.
   */
  async monAnnuel(db: Requete, tenantId?: string) {
    const { rows } = await db.query<{ r: Record<string, unknown> | null }>(
      `select public.mon_annuel($1) as r`,
      [tenantId ?? null],
    );
    return rows[0]?.r ?? null;
  },

  /**
   * Passer à l'année, à partir du premier du mois suivant. Rend l'engagement,
   * et le paiement en ligne à régler quand un émetteur est désigné. Un refus
   * revient en `annuel_refuse:<code>`.
   */
  async souscrireAnnuel(db: Requete, tenantId?: string) {
    const { rows } = await db.query<{ r: { engagement: string; paiement: unknown } }>(
      `select public.annuel_souscrire($1) as r`,
      [tenantId ?? null],
    );
    return rows[0]!.r;
  },

  /**
   * Les lectures reportées du mois dernier sur ce mois, et si la tour a
   * allumé le report. Elles sont déjà comprises dans `lectures_droit`.
   */
  async monReport(db: Requete, tenantId?: string) {
    const { rows } = await db.query<{ r: { report: number; actif: boolean } | null }>(
      `select public.mon_report($1) as r`,
      [tenantId ?? null],
    );
    return rows[0]?.r ?? null;
  },

  /**
   * Passer à une offre, à la date du jour. Seul le propriétaire principal le
   * peut ; un refus revient en `forfait_refuse:<code>:<chiffres>`.
   */
  async changerForfait(db: Requete, offre: string, tenantId?: string) {
    const { rows } = await db.query<{ r: boolean }>(`select public.forfait_changer($1, $2) as r`, [
      offre,
      tenantId ?? null,
    ]);
    // Une montée se paie aussitôt : la base prépare la différence du mois, ou
    // rien (descente, même prix). L'offre, elle, est déjà ouverte.
    const { rows: p } = await db.query<{ p: PaiementLu | null }>(
      `select public.paiement_montee_preparer($1) as p`,
      [tenantId ?? null],
    );
    return { change: Boolean(rows[0]?.r), paiement: p[0]?.p ?? null };
  },

  /* ----------------------------------------------------- payer en ligne */

  /** Les paiements en ligne de la licence de l'appelant, et leur état déduit. */
  async mesPaiements(db: Requete) {
    const { rows } = await db.query<PaiementLu>(
      `select ${COLONNES_PAIEMENT} from facturation.paiements_en_ligne_v
        order by cree_le desc, paiement_id`,
    );
    return rows;
  },

  /**
   * Le lien vers la page du prestataire. `{ ouvert: false }` quand aucun
   * prestataire n'est ouvert dans cet environnement : l'offre reste ouverte,
   * et la facture du mois suit.
   */
  async payerEnLigne(db: Requete, paiementId: string) {
    const p = await lirePaiement(db, paiementId);
    if (p.etat === "paye") return { ouvert: true, lien: null, paiement: p };
    const env = await prestataireOuvert(db);
    if (!env) return { ouvert: false, lien: null, paiement: p };

    const { reference, lien } = await env.prestataire.creerLien({
      paiementId,
      millimes: enMillimes(p.montant_ttc),
      libelle: p.libelle,
      retour: `${env.urlPublique}/pme/reglages?paiement=${paiementId}`,
    });
    const inscrit = await inscrire(
      db,
      paiementId,
      "lien_cree",
      env.prestataire.nom,
      reference,
      lien,
    );
    return { ouvert: true, lien, paiement: inscrit };
  },

  /**
   * Revenu de la page du prestataire : on lui demande, à LUI, si c'est payé.
   * Ce que dit le navigateur ne compte pas.
   */
  async verifierPaiement(db: Requete, paiementId: string) {
    const p = await lirePaiement(db, paiementId);
    if (p.etat === "paye" || !p.reference || p.prestataire !== "clictopay") return p;
    const env = await prestataireOuvert(db);
    if (!env || env.prestataire.nom !== "clictopay") return p;
    const r = await env.prestataire.etat(p.reference);
    if (r.etat === "en_attente") return p;
    return inscrire(db, paiementId, r.etat, "clictopay", p.reference, null, r.detail);
  },

  /** Le simulateur du staging : « payer » ou « refuser », sans carte. */
  async simulerPaiement(db: Requete, paiementId: string, decision: "paye" | "refuse") {
    const env = await prestataireOuvert(db);
    if (!env || env.prestataire.nom !== "simulateur") throw new Error("paiement.simulateur_ferme");
    if (decision !== "paye" && decision !== "refuse") throw new Error("paiement.decision_inconnue");
    const p = await lirePaiement(db, paiementId);
    return inscrire(
      db,
      paiementId,
      decision,
      "simulateur",
      p.reference ?? `sim-${paiementId}`,
      null,
    );
  },

  /* ------------------------------------------------------------ recharges */

  /** Les paliers en vigueur aujourd'hui. */
  async paliersDeRecharge(db: Requete) {
    const { rows } = await db.query(
      `select distinct on (code) code, libelle, prix_ht, lectures, validite_mois, rang
         from ref.recharges where effective_from <= current_date
        order by code, effective_from desc`,
    );
    return rows;
  },

  /** Les recharges de la licence de l'appelant, et ce qu'il en reste. */
  async mesRecharges(db: Requete) {
    const { rows } = await db.query(
      `select recharge_id, recharge_code, lectures, prix_ht, achetee_le, expire_le,
              origine, restantes, utilisable, gelee, expiree
         from facturation.recharges_v order by expire_le, achetee_le, recharge_id`,
    );
    return rows;
  },

  /** Acheter une recharge. Propriétaire principal seul ; jamais sur le Basic. */
  async acheterRecharge(db: Requete, code: string, tenantId?: string) {
    const { rows } = await db.query<{ r: Record<string, unknown> }>(
      `select public.recharge_acheter($1, $2) as r`,
      [code, tenantId ?? null],
    );
    const r = rows[0]?.r;
    if (!r) throw new Error("recharge.non_achetee");
    // Elle se paie aussitôt ; ses lectures sont déjà là.
    const { rows: p } = await db.query<{ p: PaiementLu | null }>(
      `select public.paiement_recharge_preparer($1) as p`,
      [r["recharge_id"]],
    );
    return { ...r, paiement: p[0]?.p ?? null };
  },

  /** Le dernier réglage de la recharge automatique, ou `null`. */
  async maRechargeAutomatique(db: Requete) {
    const { rows } = await db.query(
      `select active, recharge_code, plafond_mois_ht, decide_le
         from facturation.recharge_automatique order by decide_le desc, id desc limit 1`,
    );
    return rows[0] ?? null;
  },

  /** Régler la recharge automatique : un palier et un plafond du mois, ou l'arrêt. */
  async reglerRechargeAutomatique(
    db: Requete,
    active: boolean,
    code: string | null,
    plafondMoisHt: string | null,
    tenantId?: string,
  ) {
    const { rows } = await db.query<{ r: Record<string, unknown> }>(
      `select public.recharge_automatique_regler($1, $2, $3::numeric, $4) as r`,
      [active, code, plafondMoisHt, tenantId ?? null],
    );
    return rows[0]?.r ?? null;
  },

  /* --------------------------------------------- propriétaires, et le principal */

  /** Inviter un propriétaire : un dirigeant de plus, sur une place payée. */
  async inviterProprietaire(db: Requete, email: string, tenantId: string) {
    const { rows } = await db.query<{
      r: { id: string; email: string; role: string; expiresAt: string; deja: boolean };
    }>(`select public.proprietaire_inviter($1, $2) as r`, [tenantId, email]);
    const r = rows[0]?.r;
    if (!r) throw new Error("invitation.non_creee");
    return { ...r, deja: Boolean(r.deja) };
  },

  /** Transmettre le rôle de propriétaire principal à un propriétaire de la société. */
  async transmettreLicence(db: Requete, tenantId: string, nouveau: string) {
    const { rows } = await db.query<{ r: string }>(
      `select public.licence_transmettre($1, $2) as r`,
      [tenantId, nouveau],
    );
    return { licence: rows[0]?.r ?? null };
  },
};
