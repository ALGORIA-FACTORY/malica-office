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

import type { EtatDeFacture, PlaceComptable } from "@malica/socle/ports/repositories";

import type { Requete } from "../db.ts";
import { enUnitesExactes } from "@malica/socle/somme-decimale";

import {
  adaptateurDe,
  adresseDeRetour,
  prestataireDuReglage,
  type Prestataire,
  type ReglagePaiement,
} from "../paiement/prestataires.ts";
import { adresseDeNotification } from "../paiement/notification-flouci.ts";
import { idsDeSocietes } from "./societes.ts";

/** Un paiement en ligne, tel que `facturation.paiements_en_ligne_v` le rend. */
interface PaiementLu {
  paiement_id: string;
  objet: "montee" | "recharge" | "annuel" | "facture" | "montee_demandee";
  libelle: string;
  montant_ht: string;
  montant_tva: string;
  montant_ttc: string;
  devise: string;
  /**
   * `remplace` : un acompte de montée que le forfait suivant a remplacé ; il ne se paie plus.
   * `non_abouti` : un lien ouvert que personne n'a conclu dans la durée arrêtée en base ; on le rouvre.
   */
  etat: "a_payer" | "lien_cree" | "paye" | "refuse" | "remplace" | "non_abouti";
  prestataire: string | null;
  reference: string | null;
  lien: string | null;
  impute: boolean;
  cree_le: string;
  /** Le cabinet qui paie (une facture de cabinet) ; `null` pour une société. */
  payeur_tenant_id: string | null;
}

const COLONNES_PAIEMENT = `paiement_id, objet, libelle, montant_ht, montant_tva, montant_ttc, devise,
  etat, prestataire, reference, lien, impute, cree_le, payeur_tenant_id`;

/**
 * Le réglage de la tour (`public.paiement_reglage()`), joint à ce que la table
 * dit de son prestataire.
 */
async function reglageEnVigueur(db: Requete): Promise<ReglagePaiement | null> {
  const { rows } = await db.query<ReglagePaiement>(
    `select r ->> 'prestataire' as prestataire, r ->> 'url_api' as url_api,
            r ->> 'url_retour' as url_retour, p.adaptateur, p.ouvre_le_paiement, p.langue,
            coalesce((select array_agg(h.hote order by h.hote)
                        from facturation.hotes_par_prestataire h
                       where h.prestataire = p.code and h.usage = 'api'), '{}') as hotes_api
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
 * Un appel au prestataire qui échoue (réseau, délai, réponse illisible) ne
 * renvoie jamais son texte brut au client : la panne se journalise côté serveur
 * — le nom et le message de l'erreur, jamais les en-têtes —, et l'écran reçoit
 * une clé.
 */
async function chezLePrestataire<T>(code: string, appel: () => Promise<T>): Promise<T> {
  try {
    return await appel();
  } catch (e) {
    const err = e as Error;
    console.error(`[paiement] ${code} : ${err.name} ${err.message}`);
    throw new Error("refus.paiement.prestataire_indisponible");
  }
}

/**
 * Verrouiller le paiement pour la durée de la transaction : deux onglets, un
 * double clic, deux retours concurrents passent l'un après l'autre, et voient
 * ce que le premier a inscrit (audit du 23 novembre 2026, B2).
 */
async function verrouiller(db: Requete, paiementId: string): Promise<void> {
  try {
    await db.query(`select public.paiement_verrouiller($1)`, [paiementId]);
  } catch (e) {
    if ((e as Error).message === "refus.introuvable.paiement")
      throw new Error("paiement.introuvable");
    throw e;
  }
}

interface LienOuvert {
  prestataire: string;
  reference: string;
  dernier: boolean;
  adaptateur: string | null;
  url_api: string | null;
  langue: string | null;
  unites_attendues: string;
  fait_entrer_argent: boolean;
}

/**
 * Interroger CHAQUE lien encore ouvert de ce paiement, chez le prestataire qui l'a
 * créé — même si la tour en a ouvert un autre depuis, même s'il n'est pas le
 * dernier. Un client peut payer sur une page restée ouverte dans un autre onglet :
 * son argent est entré, il doit être constaté (audit du 23 novembre 2026, B2).
 *
 * Un « payé » s'inscrit dès qu'il est trouvé. Un « refusé » ne s'inscrit que pour
 * le dernier lien — un ancien lien expiré ne ferme pas une page encore ouverte.
 * Une réponse incohérente (`anomalie` : un autre montant, un autre paiement) ne
 * solde rien et se signale à la tour.
 *
 * Rend le paiement s'il est désormais payé, `null` sinon. `enPanne` dit qu'AU
 * MOINS UN lien d'argent réel reste sans réponse — son prestataire est muet, ou ce
 * serveur ne sait plus l'interroger (adaptateur fermé, clés retirées) : tant
 * qu'il n'a pas répondu, ce lien peut avoir été payé, et aucune seconde commande
 * ne part (contre-audit du 23 novembre 2026).
 */
async function constaterLesLiensOuverts(
  db: Requete,
  p: PaiementLu,
): Promise<{ paye: PaiementLu | null; enAttente: boolean; enPanne: boolean }> {
  const { rows } = await db.query<LienOuvert>(
    `select prestataire, reference, dernier, adaptateur, url_api, langue,
            unites_attendues::text as unites_attendues, fait_entrer_argent
       from public.paiement_liens_ouverts($1)`,
    [p.paiement_id],
  );
  const hotes = await hotesApi(db, [...new Set(rows.map((l) => l.prestataire))]);
  let enAttente = false;
  let sansReponse = 0;
  for (const l of rows) {
    // Un lien qui ne fait entrer aucun argent (le simulateur) ne s'interroge pas :
    // sa décision s'inscrit à l'écran.
    if (!l.fait_entrer_argent) continue;
    const adaptateur: Prestataire | null = adaptateurDe({
      prestataire: l.prestataire,
      url_api: l.url_api,
      adaptateur: l.adaptateur,
      langue: l.langue,
      hotes_api: hotes.get(l.prestataire) ?? [],
    });
    if (!adaptateur) {
      console.error(
        `[paiement] ${l.prestataire} : lien ouvert que ce serveur ne sait plus interroger`,
      );
      sansReponse += 1;
      continue;
    }
    let r: Awaited<ReturnType<Prestataire["etat"]>>;
    try {
      r = await chezLePrestataire(l.prestataire, () =>
        adaptateur.etat(l.reference, {
          paiementId: p.paiement_id,
          unites: Number(l.unites_attendues),
        }),
      );
    } catch {
      sansReponse += 1;
      continue;
    }
    if (r.etat === "paye") {
      const paye = await inscrire(
        db,
        p.paiement_id,
        "paye",
        adaptateur,
        l.reference,
        null,
        r.detail,
      );
      return { paye, enAttente: false, enPanne: false };
    }
    if (r.etat === "anomalie") {
      console.error(`[paiement] ${l.prestataire} : réponse incohérente pour ${p.paiement_id}`);
      await db.query(`select public.paiement_signaler_anomalie($1, $2, $3, $4::jsonb)`, [
        p.paiement_id,
        l.prestataire,
        l.reference,
        JSON.stringify(r.detail),
      ]);
      continue;
    }
    if (r.etat === "refuse" && l.dernier) {
      await inscrire(db, p.paiement_id, "refuse", adaptateur, l.reference, null, r.detail);
      continue;
    }
    if (r.etat === "en_attente" && l.dernier) enAttente = true;
  }
  return { paye: null, enAttente, enPanne: sansReponse > 0 };
}

/** Les hôtes d'API autorisés de ces prestataires (`facturation.hotes_par_prestataire`). */
async function hotesApi(db: Requete, codes: string[]): Promise<Map<string, string[]>> {
  if (codes.length === 0) return new Map();
  const { rows } = await db.query<{ prestataire: string; hotes: string[] }>(
    `select prestataire, array_agg(hote order by hote) as hotes
       from facturation.hotes_par_prestataire
      where usage = 'api' and prestataire = any ($1::text[])
      group by prestataire`,
    [codes],
  );
  return new Map(rows.map((r) => [r.prestataire, r.hotes]));
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
  prestataire: Pick<Prestataire, "code" | "simule">,
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

/**
 * Les sociétés demandées où l'appelant est membre, dans l'ordre demandé.
 * Les fonctions de licence refusent une société étrangère en levant une
 * erreur, ce qui annulerait toute la transaction de l'appel groupé : on la
 * retire avant, par la même règle (`app.member_orgs`).
 */
async function societesDeLAppelant(db: Requete, tenantIds: string[]): Promise<string[]> {
  const ids = idsDeSocietes(tenantIds);
  if (ids.length === 0) return [];
  const { rows } = await db.query<{ id: string }>(
    `select t.id::text as id
       from unnest($1::uuid[]) with ordinality t(id, rang)
      where t.id in (select app.member_orgs())
      order by t.rang`,
    [ids],
  );
  return rows.map((r) => r.id);
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
  /**
   * La licence qui accueillerait une société de plus (`public.societe_en_plus_devis`, la même
   * règle que la porte `create_organization`) : son offre, ses sociétés, son inclus, le prix
   * d'une société en plus. `{ offre_multisociete_requise: true }` : la porte refuserait — le
   * titulaire d'une offre à une société monte d'offre d'abord (20261228110000). `null` : la
   * société aura sa propre licence.
   */
  async societeEnPlusDevis(db: Requete) {
    const { rows } = await db.query<{
      r: {
        offre: string;
        organisations: number;
        organisations_incluses: number;
        prix_organisation_sup: string;
        offre_multisociete_requise?: boolean;
      } | null;
    }>(`select public.societe_en_plus_devis() as r`);
    const r = rows[0]?.r ?? null;
    if (r?.offre_multisociete_requise === true)
      return { offre_multisociete_requise: true as const };
    return r
      ? {
          offre: r.offre,
          organisations: Number(r.organisations),
          organisations_incluses: Number(r.organisations_incluses),
          prix_organisation_sup: String(r.prix_organisation_sup),
        }
      : null;
  },

  /**
   * Le prix d'une place et d'une société au-delà de l'offre en cours
   * (`mes_prix_en_plus`, 20261117120000) : ce que « Inviter » et « Sociétés »
   * disent avant le geste. `null` à qui n'est pas titulaire.
   */
  async mesPrixEnPlus(db: Requete, tenantId: string) {
    const { rows } = await db.query<{
      r: {
        prix_siege_sup: string;
        prix_organisation_sup: string;
        sieges_inclus: number;
        organisations_incluses: number;
      } | null;
    }>(`select public.mes_prix_en_plus($1) as r`, [tenantId]);
    const r = rows[0]?.r ?? null;
    return r
      ? {
          prix_siege_sup: String(r.prix_siege_sup),
          prix_organisation_sup: String(r.prix_organisation_sup),
          sieges_inclus: Number(r.sieges_inclus),
          organisations_incluses: Number(r.organisations_incluses),
        }
      : null;
  },

  async monForfait(db: Requete, tenantId?: string | null) {
    const { rows } = await db.query(
      `select offre, statut, lectures_droit, lectures_consommees, lectures_restantes,
              organisations, sieges_occupes, sieges_inclus, sieges_max, prix_mensuel_ht,
              titulaire, pris_en_charge_par
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
  /**
   * Les sièges. Avec la société OUVERTE (3 novembre 2026), ceux que l'écran de
   * cette société doit montrer : toute la licence pour son titulaire, la
   * société pour son dirigeant (`licence_sieges_de`). Sans société, ceux des
   * licences dont l'appelant est titulaire — l'ancienne lecture, qui montrait
   * la licence du COMPTE dans les réglages d'une autre société.
   */
  async sieges(db: Requete, tenantId?: string | null) {
    const { rows } = tenantId
      ? await db.query(
          `select user_id, nom, role, tenant_id, organisation, email
             from public.licence_sieges_de($1)`,
          [tenantId],
        )
      : await db.query(
          `select user_id, nom, role, tenant_id, organisation, email
             from licence_sieges_v order by organisation, role, nom, user_id`,
        );
    return rows;
  },

  /**
   * Les sociétés de la licence, et ce que chacune a consommé ce mois-ci. Avec
   * la société ouverte, la licence qui LA couvre, elle en tête
   * (`licence_organisations_de`) ; sans, les licences dont l'appelant est
   * titulaire.
   */
  async organisations(db: Requete, tenantId?: string | null) {
    const { rows } = tenantId
      ? await db.query(
          `select tenant_id, nom, lectures_consommees, titulaire
             from public.licence_organisations_de($1)`,
          [tenantId],
        )
      : await db.query(
          `select tenant_id, nom, lectures_consommees
             from licence_organisations_v order by nom, tenant_id`,
        );
    return rows;
  },

  /**
   * Les sociétés des licences qui couvrent PLUSIEURS sociétés de l'appelant,
   * en un aller-retour (7 novembre 2026).
   *
   * Les réglages appelaient `organisations` une fois par société. Or le
   * titulaire reçoit, à chaque appel, TOUTE sa licence : cent sociétés dans
   * une licence faisaient cent appels qui rendaient chacun les cent mêmes
   * lignes — dix mille lignes pour en montrer cent. Ici, une licence n'est lue
   * qu'une fois : une société déjà rendue par la lecture d'une autre n'est pas
   * relue. Mêmes fonctions de la base, même règle de qui voit quoi ; une
   * société dont l'appelant n'est pas membre est ignorée au lieu de tout
   * faire échouer. Rendu sans doublon, dans l'ordre des sociétés demandées.
   */
  /**
   * La fiche courte de chaque société, pour la liste des Réglages (planche 4,
   * 7 novembre 2026) : son offre et le cabinet qui la tient, en UN appel.
   * Avant, chaque carte lisait les deux pour elle-même — deux cents appels
   * pour cent sociétés. Ni prix ni paiement : la coque peut la lire.
   */
  async fichesDesSocietes(db: Requete, tenantIds: string[]) {
    const ids = await societesDeLAppelant(db, tenantIds);
    if (ids.length === 0) return [];
    const { rows: cabinets } = await db.query<{ pme: string; id: string; nom: string }>(
      `select distinct on (e.pme_org_id) e.pme_org_id as pme, o.id, o.name as nom
         from engagements_v e
         join organizations_v o on o.id = e.cabinet_org_id
        where e.pme_org_id = any($1::uuid[]) and e.status = 'actif'
        order by e.pme_org_id, o.name`,
      [ids],
    );
    const cabinetDe = new Map(cabinets.map((c) => [c.pme, c]));
    const fiches: Array<{
      tenantId: string;
      offre: string | null;
      cabinet: string | null;
      cabinetId: string | null;
    }> = [];
    for (const id of ids) {
      const { rows } = await db.query<{ offre: string | null }>(
        `select offre from public.mon_forfait($1::uuid)`,
        [id],
      );
      const c = cabinetDe.get(id);
      fiches.push({
        tenantId: id,
        offre: rows[0]?.offre ?? null,
        cabinet: c?.nom ?? null,
        cabinetId: c?.id ?? null,
      });
    }
    return fiches;
  },

  async organisationsDesSocietes(db: Requete, tenantIds: string[]) {
    const ids = await societesDeLAppelant(db, tenantIds);
    const vues = new Map<string, Record<string, unknown>>();
    for (const id of ids) {
      if (vues.has(id)) continue;
      const { rows } = await db.query(
        `select tenant_id, nom, lectures_consommees, titulaire
           from public.licence_organisations_de($1)`,
        [id],
      );
      for (const r of rows as Record<string, unknown>[]) {
        const t = r["tenant_id"] as string;
        if (!vues.has(t)) vues.set(t, r);
      }
    }
    const rang = new Map(ids.map((id, i) => [id, i]));
    return [...vues.values()].sort(
      (a, b) =>
        (rang.get(a["tenant_id"] as string) ?? ids.length) -
        (rang.get(b["tenant_id"] as string) ?? ids.length),
    );
  },

  /**
   * Les sièges vus depuis PLUSIEURS sociétés, en un aller-retour — même
   * raison que `organisationsDesSocietes` : une licence lue une fois. Une
   * société dont un siège a déjà été rendu par la licence d'une autre n'est
   * pas relue. Sans doublon (une personne, une société).
   */
  async siegesDesSocietes(db: Requete, tenantIds: string[]) {
    const ids = await societesDeLAppelant(db, tenantIds);
    const couvertes = new Set<string>();
    const lignes = new Map<string, Record<string, unknown>>();
    for (const id of ids) {
      if (couvertes.has(id)) continue;
      const { rows } = await db.query(
        `select user_id, nom, role, tenant_id, organisation, email
           from public.licence_sieges_de($1)`,
        [id],
      );
      couvertes.add(id);
      for (const r of rows as Record<string, unknown>[]) {
        const t = r["tenant_id"] as string;
        couvertes.add(t);
        const cle = `${t}:${r["user_id"] as string}`;
        if (!lignes.has(cle)) lignes.set(cle, r);
      }
    }
    return [...lignes.values()];
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
   * Inviter le comptable interne de la société, sur la place « comptable »
   * comprise dans l'offre (7.2) : jamais une place payante. La base refuse
   * la place de trop, et l'appelant qui n'est pas le propriétaire.
   */
  async inviterComptableInterne(db: Requete, email: string, tenantId: string) {
    const { rows } = await db.query<{
      r: { id: string; email: string; role: string; expiresAt: string; deja: boolean };
    }>(`select public.comptable_interne_inviter($1, $2) as r`, [tenantId, email]);
    const r = rows[0]?.r;
    if (!r) throw new Error("invitation.non_creee");
    return { ...r, deja: Boolean(r.deja) };
  },

  /** La place « comptable » de la société : comprise, prise, attendue. Jamais un prix. */
  async placeComptable(db: Requete, tenantId: string): Promise<PlaceComptable> {
    const { rows } = await db.query<{ r: PlaceComptable }>(
      `select public.place_comptable_lire($1) as r`,
      [tenantId],
    );
    return rows[0]!.r;
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

  /**
   * Ce que la montée vers `offre` fait régler aujourd'hui et le prix plein des mois suivants.
   * Lecture seule ; la base appelle la même formule que la préparation du paiement.
   */
  async monteeDevis(db: Requete, offre: string, tenantId?: string) {
    const { rows } = await db.query<{ r: Record<string, unknown> | null }>(
      `select public.montee_devis($1, $2) as r`,
      [offre, tenantId ?? null],
    );
    return rows[0]?.r ?? null;
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
   * revient en `refus.annuel.ferme?motif=<code>`.
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
   * peut ; un refus revient en `refus.forfait.empeche?motif=<code>&chiffres=<chiffres>`.
   */
  async changerForfait(db: Requete, offre: string, tenantId?: string) {
    // Payer d'abord (22 novembre 2026) : une montée que la société paie elle-même
    // ne s'ouvre qu'au paiement confirmé — la base rend le paiement à régler, et
    // `change` reste faux. Une descente, une montée pendant l'année ou sous la
    // facturation immédiate gardent leur chemin : le forfait d'abord.
    const { rows } = await db.query<{ r: { change: boolean; paiement: PaiementLu | null } }>(
      `select public.forfait_demander($1, $2) as r`,
      [offre, tenantId ?? null],
    );
    const r = rows[0]?.r;
    return { change: Boolean(r?.change), paiement: r?.paiement ?? null };
  },

  /**
   * Le jeu d'essai, sur une base locale sans émetteur : l'offre s'ouvre sans paiement.
   * Réservée au serveur (`rpc.ts`) ; la base exige aussi `malica.origine = 'serveur'`.
   */
  async ouvrirForfaitDEssai(db: Requete, offre: string, tenantId?: string) {
    const { rows } = await db.query<{ r: boolean }>(
      `select public.forfait_ouvrir_d_essai($1, $2) as r`,
      [offre, tenantId ?? null],
    );
    return { change: Boolean(rows[0]?.r), paiement: null };
  },

  /* ----------------------------------------------------- payer en ligne */

  /** Les paiements en ligne de la licence de l'appelant, et leur état déduit. */
  /**
   * Les factures que l'appelant paie lui-même, leur reste dû et leur état
   * (`facturation.encours_v`), sans rien recalculer.
   */
  async mesFactures(db: Requete) {
    const { rows } = await db.query(
      `select facture_id, numero, periode::text, emise_le::text, echeance_le::text,
              montant_ttc::text, reste_du::text, devise, etat
         from public.mes_factures()`,
    );
    return rows;
  },

  /**
   * Payer une facture en ligne : la base prépare le paiement de son reste dû,
   * en entier, et rend un paiement déjà ouvert pour ce montant. Le moyen se
   * choisit ensuite sur la page de choix.
   */
  async payerFacture(db: Requete, factureId: string) {
    const { rows } = await db.query<{ p: PaiementLu }>(
      `select public.paiement_facture_preparer($1) as p`,
      [factureId],
    );
    return rows[0]!.p;
  },

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
    await verrouiller(db, paiementId);
    let p = await lirePaiement(db, paiementId);
    if (p.etat === "paye") return { ouvert: true, lien: null, paiement: p };
    // Une montée remplacée par un autre changement d'offre ne se paie plus :
    // la facture du mois facture les jours réellement passés (20261117110000).
    if (p.etat === "remplace") throw new Error("refus.paiement.remplace");

    // Avant toute nouvelle commande, chaque lien encore ouvert est interrogé chez
    // le prestataire qui l'a créé : s'il est payé, on ne fait pas payer deux fois.
    const constat = await constaterLesLiensOuverts(db, p);
    if (constat.paye) return { ouvert: true, lien: null, paiement: constat.paye };
    // Un prestataire qui ne répond pas sur un lien ouvert : on ne crée pas une
    // seconde commande à l'aveugle — le client paierait peut-être deux fois.
    if (constat.enPanne) throw new Error("refus.paiement.prestataire_indisponible");
    p = await lirePaiement(db, paiementId);

    const env = await prestataireOuvert(db);
    if (!env) return { ouvert: false, lien: null, paiement: p };

    // Un lien encore en cours chez CE prestataire sert encore : on ne crée pas une
    // seconde commande pour le même paiement (revenir en arrière et choisir
    // Mastercard après Visa mène à la même page de carte). Un lien « non abouti »
    // se rouvre par une commande neuve — l'ancien reste interrogé jusqu'à sa
    // conclusion.
    if (
      p.etat === "lien_cree" &&
      p.prestataire === env.prestataire.code &&
      p.lien &&
      (env.prestataire.simule || constat.enAttente)
    ) {
      return { ouvert: true, lien: p.lien, paiement: p };
    }

    // Le moyen choisi doit être actif et accepté par ce prestataire : la base le
    // refuse par une clé, et le redit à l'inscription. On ne demande pas un
    // lien pour rien.
    const { rows } = await db.query<{ d: { iso_numerique: string; exposant: number } }>(
      `select public.paiement_moyen_admis($1, $2, $3) as d`,
      [moyen, env.prestataire.code, p.devise],
    );
    const devise = rows[0]!.d;
    // Le paiement d'une facture porte son reste dû : s'il a changé depuis (un
    // encaissement saisi entre-temps), la base refuse par une clé.
    await db.query(`select public.paiement_encore_du($1)`, [paiementId]);

    const { reference, lien } = await chezLePrestataire(env.prestataire.code, () =>
      env.prestataire.creerLien({
        paiementId,
        unites: Number(enUnitesExactes(p.montant_ttc, devise.exposant)),
        devise: devise.iso_numerique,
        libelle: p.libelle,
        retour: adresseDeRetour(
          env.urlPublique,
          p.payeur_tenant_id ? "cabinet" : "societe",
          paiementId,
        ),
        notification: adresseDeNotification(env.urlPublique),
      }),
    );
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
    await verrouiller(db, paiementId);
    const p = await lirePaiement(db, paiementId);
    if (p.etat === "paye" || !p.reference) return p;
    // Chaque lien encore ouvert, chez le prestataire qui l'a créé — même si la
    // tour en a ouvert un autre depuis.
    const constat = await constaterLesLiensOuverts(db, p);
    if (constat.paye) return constat.paye;
    if (constat.enPanne) throw new Error("refus.paiement.prestataire_indisponible");
    return lirePaiement(db, paiementId);
  },

  /** Le simulateur du staging : « payer » ou « refuser », sans carte. */
  async simulerPaiement(db: Requete, paiementId: string, decision: "paye" | "refuse") {
    const env = await prestataireOuvert(db);
    if (!env || !env.prestataire.simule) throw new Error("paiement.simulateur_ferme");
    if (decision !== "paye" && decision !== "refuse") throw new Error("paiement.decision_inconnue");
    await verrouiller(db, paiementId);
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

  /**
   * La comptabilité change l'offre qu'elle paie : une montée s'applique
   * sur-le-champ (le dirigeant est prévenu), une descente attend son accord ;
   * avant l'arrivée du dirigeant, la proposition change simplement.
   */
  async changerOffreAbonnement(db: Requete, accesId: string, offre: string) {
    const { rows } = await db.query<{
      r: { acces_id: string; effet: string; descente_id?: string };
    }>(`select public.acces_changer_offre($1, $2) as r`, [accesId, offre]);
    return rows[0]!.r;
  },

  /** La comptabilité arrête de payer : l'abonnement revient au dirigeant, prévenu. */
  async arreterAbonnement(db: Requete, accesId: string) {
    const { rows } = await db.query<{ r: { acces_id: string; effet: string } }>(
      `select public.acces_arreter($1) as r`,
      [accesId],
    );
    return rows[0]!.r;
  },

  /** La descente que la comptabilité demande, à trancher par le dirigeant. */
  async descentePourMoi(db: Requete, tenantId: string) {
    const { rows } = await db.query(
      `select descente_id, offre_code, comptabilite, propose_le::text
         from public.acces_descente_pour_moi($1)`,
      [tenantId],
    );
    return (rows[0] ?? null) as {
      descente_id: string;
      offre_code: string;
      comptabilite: string;
      propose_le: string;
    } | null;
  },

  /** Le dirigeant accepte ou refuse la descente demandée. */
  async repondreDescente(db: Requete, descenteId: string, accepte: boolean) {
    const { rows } = await db.query<{ r: { descente_id: string; statut: string } }>(
      `select public.acces_descente_repondre($1, $2) as r`,
      [descenteId, accepte],
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
              f.devise, f.organisations, e.reste_du::text, e.etat
         from facturation.factures f
         join facturation.encours_v e on e.facture_id = f.id
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
      organisations: number;
      reste_du: string;
      etat: EtatDeFacture;
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
