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
  adresseDeRetour,
  enUnitesMineures,
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

/**
 * Le réglage de la tour (`public.paiement_reglage()`), joint à ce que la table
 * dit de son prestataire.
 */
async function reglageEnVigueur(db: Requete): Promise<ReglagePaiement | null> {
  const { rows } = await db.query<ReglagePaiement>(
    `select r ->> 'prestataire' as prestataire, r ->> 'url_api' as url_api,
            r ->> 'url_retour' as url_retour, p.adaptateur, p.ouvre_le_paiement, p.langue
       from public.paiement_reglage() r
       join facturation.prestataires_paiement p on p.code = r ->> 'prestataire'`,
  );
  return rows[0] ?? null;
}

/** Le prestataire que la tour a ouvert, ou `null`. */
async function prestataireOuvert(db: Requete) {
  const r = await reglageEnVigueur(db);
  return r ? prestataireDuReglage(r) : null;
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
  prestataire: { code: string; simule: boolean },
  reference: string | null,
  lien: string | null,
  detail: Record<string, unknown> = {},
  moyen: string | null = null,
): Promise<PaiementLu> {
  if (prestataire.simule) {
    await db.query(`select set_config('malica.paiement_simulateur', 'oui', true)`);
  }
  await db.query(`select public.paiement_inscrire($1, $2, $3, $4, $5, $6::jsonb, $7)`, [
    paiementId,
    etat,
    prestataire.code,
    reference,
    lien,
    JSON.stringify(detail),
    moyen,
  ]);
  return lirePaiement(db, paiementId);
}

export const facturation = {
  /**
   * Le forfait de l'appelant. Titulaire : la ligne entière. Membre d'une
   * organisation de la licence (un collaborateur) : le compteur de lectures
   * seul, offre, prix et places à `null` — c'est la base qui le décide. `null`
   * quand l'appelant n'est rattaché à aucune licence.
   *
   * POUR UNE ORGANISATION (20 octobre 2026). Un propriétaire peut détenir
   * plusieurs sociétés, chacune avec sa licence : sans l'organisation, la base
   * refuse de choisir (« plusieurs licences ») et toutes les pages du
   * propriétaire tombaient en erreur. L'écran passe désormais l'organisation
   * ouverte ; sans elle, la base ne répond que s'il n'y a qu'une réponse.
   */
  async monForfait(db: Requete, tenantId?: string | null) {
    const { rows } = await db.query(
      `select offre, statut, lectures_droit, lectures_consommees, lectures_restantes,
              organisations, sieges_occupes, sieges_inclus, sieges_max, prix_mensuel_ht
         from public.mon_forfait($1::uuid)`,
      [tenantId ?? null],
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
      `select user_id, nom, role, tenant_id, organisation, email
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
  /** Le nom et ce qu'ouvre chaque offre en vigueur — aucun prix ne sort d'ici. */
  async catalogueDesOffres(db: Requete) {
    const { rows } = await db.query(
      `select distinct on (code) code, libelle, rang, sieges_inclus, organisations_incluses,
              organisations_max, recharges_permises
         from ref.offres
        where effective_from <= current_date
        order by code, effective_from desc`,
    );
    return [...rows].sort((a, b) => Number(a["rang"]) - Number(b["rang"]));
  },

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
  async payerEnLigne(db: Requete, paiementId: string, moyen: string) {
    const p = await lirePaiement(db, paiementId);
    if (p.etat === "paye") return { ouvert: true, lien: null, paiement: p };
    const env = await prestataireOuvert(db);
    if (!env) return { ouvert: false, lien: null, paiement: p };

    // Le moyen choisi doit être actif et accepté par ce prestataire : la base le
    // refuse par une clé, et le redit à l'inscription. On ne demande pas un
    // lien pour rien.
    const { rows } = await db.query<{ d: { iso_numerique: string; exposant: number } }>(
      `select public.paiement_moyen_admis($1, $2, $3) as d`,
      [moyen, env.prestataire.code, p.devise],
    );
    const devise = rows[0]!.d;

    const { reference, lien } = await env.prestataire.creerLien({
      paiementId,
      unites: enUnitesMineures(p.montant_ttc, devise.exposant),
      devise: devise.iso_numerique,
      libelle: p.libelle,
      retour: adresseDeRetour(env.urlPublique, paiementId),
    });
    const inscrit = await inscrire(
      db,
      paiementId,
      "lien_cree",
      env.prestataire,
      reference,
      lien,
      {},
      moyen,
    );
    return { ouvert: true, lien, paiement: inscrit };
  },

  /**
   * La page de choix : les moyens de paiement, leur logo et leur nom dans la
   * langue de la personne, et s'ils sont payables ICI — actifs et acceptés par
   * le prestataire que la tour a ouvert. `prestataire` est `null` quand le
   * paiement en ligne est fermé.
   */
  async moyensDePaiementEnLigne(db: Requete, locale: string) {
    const reglage = await reglageEnVigueur(db);
    const ouvert = reglage ? prestataireDuReglage(reglage) : null;
    const code = ouvert?.prestataire.code ?? null;
    const { rows: moyens } = await db.query(
      `select m.code, m.logo, m.rang, m.actif,
              coalesce(demandee.value, francais.value, m.code) as libelle,
              exists (select 1 from facturation.moyens_par_prestataire mp
                       where mp.moyen = m.code and mp.prestataire = $2) as accepte
         from facturation.moyens_paiement_v m
         left join ref_labels_v demandee
           on demandee.ns = 'moyen_en_ligne' and demandee.key = m.code and demandee.locale = $1
         left join ref_labels_v francais
           on francais.ns = 'moyen_en_ligne' and francais.key = m.code and francais.locale = 'fr'
        order by m.rang`,
      [locale, code],
    );
    if (!code) return { prestataire: null, moyens };
    const { rows: p } = await db.query(
      `select p.code, p.logo, coalesce(demandee.value, francais.value, p.code) as libelle
         from facturation.prestataires_paiement p
         left join ref_labels_v demandee
           on demandee.ns = 'prestataire_paiement' and demandee.key = p.code
          and demandee.locale = $2
         left join ref_labels_v francais
           on francais.ns = 'prestataire_paiement' and francais.key = p.code
          and francais.locale = 'fr'
        where p.code = $1`,
      [code, locale],
    );
    return { prestataire: p[0] ?? null, moyens };
  },

  /**
   * Revenu de la page du prestataire : on lui demande, à LUI, si c'est payé.
   * Ce que dit le navigateur ne compte pas.
   */
  async verifierPaiement(db: Requete, paiementId: string) {
    const p = await lirePaiement(db, paiementId);
    if (p.etat === "paye" || !p.reference) return p;
    // On ne demande qu'au prestataire qui a créé le lien, s'il est toujours ouvert.
    const env = await prestataireOuvert(db);
    if (!env || env.prestataire.simule || env.prestataire.code !== p.prestataire) return p;
    const r = await env.prestataire.etat(p.reference);
    if (r.etat === "en_attente") return p;
    return inscrire(db, paiementId, r.etat, env.prestataire, p.reference, null, r.detail);
  },

  /** Le simulateur du staging : « payer » ou « refuser », sans carte. */
  async simulerPaiement(db: Requete, paiementId: string, decision: "paye" | "refuse") {
    const env = await prestataireOuvert(db);
    if (!env || !env.prestataire.simule) throw new Error("paiement.simulateur_ferme");
    if (decision !== "paye" && decision !== "refuse") throw new Error("paiement.decision_inconnue");
    const p = await lirePaiement(db, paiementId);
    return inscrire(db, paiementId, decision, env.prestataire, p.reference, null);
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

  /*
   * ================================== LA COMPTABILITÉ REVENDEUR (20 octobre)
   *
   * Le cabinet attribue un abonnement au prix public ; la PME accepte ou
   * refuse ; le cabinet reçoit une facture mensuelle détaillée. Les règles
   * sont en base (`acces_proposer`, `acces_repondre`, `emettre_cabinet`) :
   * ce dépôt ne fait que les appeler.
   */

  /** Les offres qu'un cabinet peut attribuer, au prix public du jour (`ref.offres_par_canal`). */
  async offresDuCabinet(db: Requete) {
    const { rows } = await db.query(
      `select code, libelle, rang, prix_mensuel_ht::text, lectures_par_organisation, sieges_inclus
         from public.offres_du_cabinet()`,
    );
    return rows as Array<{
      code: string;
      libelle: string;
      rang: number;
      prix_mensuel_ht: string;
      lectures_par_organisation: number;
      sieges_inclus: number;
    }>;
  },

  /** L'expert du cabinet propose une offre à un dossier qu'il a sous mandat. */
  async proposerAbonnement(db: Requete, cabinetId: string, clientId: string, offre: string) {
    const { rows } = await db.query<{ id: string }>(
      `select public.acces_proposer($1, $2, $3) as id`,
      [cabinetId, clientId, offre],
    );
    return { id: rows[0]!.id };
  },

  /** Le dirigeant de la PME accepte ou refuse la proposition du cabinet. */
  async repondreAbonnement(db: Requete, accesId: string, accepte: boolean) {
    const { rows } = await db.query<{ r: { acces_id: string; statut: string } }>(
      `select public.acces_repondre($1, $2) as r`,
      [accesId, accepte],
    );
    return rows[0]!.r;
  },

  /** La console du cabinet : les abonnements qu'il propose ou couvre. */
  async abonnementsDuCabinet(db: Requete, cabinetId: string) {
    const { rows } = await db.query(
      `select acces_id, client_tenant_id, client_nom, client_legal_id, offre_code, statut,
              reference, propose_le::text, effet_du::text, effet_au::text, motif_fin
         from public.acces_du_cabinet($1)`,
      [cabinetId],
    );
    return rows as Array<{
      acces_id: string;
      client_tenant_id: string;
      client_nom: string;
      client_legal_id: string | null;
      offre_code: string;
      statut: string;
      reference: string | null;
      propose_le: string;
      effet_du: string | null;
      effet_au: string | null;
      motif_fin: string | null;
    }>;
  },

  /** Ce qu'un cabinet propose ou couvre pour la société ouverte. */
  async abonnementsPourMoi(db: Requete, tenantId: string) {
    const { rows } = await db.query(
      `select acces_id, cabinet_tenant_id, cabinet_nom, offre_code, statut,
              propose_le::text, effet_du::text, effet_au::text
         from public.acces_pour_moi($1)`,
      [tenantId],
    );
    return rows as Array<{
      acces_id: string;
      cabinet_tenant_id: string;
      cabinet_nom: string;
      offre_code: string;
      statut: string;
      propose_le: string;
      effet_du: string | null;
      effet_au: string | null;
    }>;
  },

  /** Les factures adressées au cabinet (la RLS les réserve à ses membres). */
  async facturesDuCabinet(db: Requete, cabinetId: string) {
    const { rows } = await db.query(
      `select f.id, f.numero, f.periode::text, f.emise_le::text, f.echeance_le::text,
              f.montant_ht::text, f.montant_tva::text, f.timbre::text, f.montant_ttc::text,
              f.devise, f.statut, f.organisations
         from facturation.factures f
        where f.payeur_type = 'cabinet' and f.payeur_tenant_id = $1
        order by f.periode desc, f.numero desc`,
      [cabinetId],
    );
    return rows as Array<{
      id: string;
      numero: string;
      periode: string;
      emise_le: string;
      echeance_le: string;
      montant_ht: string;
      montant_tva: string;
      timbre: string;
      montant_ttc: string;
      devise: string;
      statut: string;
      organisations: number;
    }>;
  },

  /** Les lignes d'une facture du cabinet : une par société cliente. */
  async lignesDeFacture(db: Requete, factureId: string) {
    const { rows } = await db.query(
      `select ordinal, libelle, quantite::text, prix_unitaire::text, montant_ht::text
         from facturation.facture_lignes where facture_id = $1 order by ordinal`,
      [factureId],
    );
    return rows as Array<{
      ordinal: number;
      libelle: string;
      quantite: string;
      prix_unitaire: string;
      montant_ht: string;
    }>;
  },
};
