/**
 * Les prestataires de paiement en ligne — la seule partie qui parle à
 * l'extérieur.
 *
 * La base calcule le montant et tient le registre (`20261022150000`) ; ce
 * module ne fait que deux choses : demander un lien de paiement, et demander
 * au prestataire si le paiement est passé. Il ne décide de rien : c'est la
 * réponse du PRESTATAIRE, jamais celle du navigateur, qui fait inscrire
 * « payé ».
 *
 * CE QUI VIT EN TABLE (20261023110000) : les prestataires et ce qu'ils font
 * (`facturation.prestataires_paiement` : ouvre le paiement, fait entrer de
 * l'argent, exige l'adresse de son API, langue de sa page), les moyens qu'ils
 * acceptent, la devise ISO 4217 et son exposant (`ref.devises`). Le prestataire
 * en service se choisit dans LA TOUR (`plateforme.paiement_regler`). Ce module
 * ne garde que les ADAPTATEURS — le code qui parle à une API — désignés par la
 * colonne `adaptateur`. Seuls les SECRETS du compte marchand restent dans
 * l'environnement du serveur, et n'en sortent jamais :
 *
 *   CLICTOPAY_UTILISATEUR         l'identifiant marchand de l'API
 *   CLICTOPAY_MOT_DE_PASSE        son mot de passe
 *   FLOUCI_CLE_PUBLIQUE           le jeton public de l'application Flouci
 *   FLOUCI_CLE_PRIVEE             son jeton privé
 *
 * Un prestataire qui n'ouvre rien — ou un adaptateur sans ses secrets — ferme
 * le paiement en ligne, et on le dit (`null`) : l'offre reste ouverte, la
 * facture du mois suit.
 */

import { DELAI_APPEL_PRESTATAIRE_MS } from "../delais.ts";

/**
 * `anomalie` : le prestataire dit « payé », mais pas pour ce paiement ni pour ce
 * montant (audit du 23 novembre 2026, B1). Rien ne se solde ; la réponse est
 * signalée à la tour.
 */
type EtatChezLePrestataire = "paye" | "refuse" | "en_attente" | "anomalie";

/** Ce que le prestataire doit confirmer pour qu'un « payé » compte. */
interface Attendu {
  /** L'identifiant du paiement, rendu tel quel par le prestataire. */
  paiementId: string;
  /** Le montant TTC dans la plus petite unité de la devise (le millime du dinar). */
  unites: number;
}

/**
 * Ce que l'adaptateur rend de sa lecture. `unites_encaissees` est ce que le
 * prestataire dit avoir encaissé, en unités de la devise ; la base refuse un
 * « payé » dont ce montant n'est pas celui du paiement.
 */
interface Constat {
  etat: EtatChezLePrestataire;
  detail: Record<string, unknown> & { unites_encaissees: number | null };
}

/** Un entier positif lu dans une réponse (nombre ou chaîne), ou `null`. */
function entier(v: unknown): number | null {
  const n = typeof v === "string" && /^[0-9]+$/.test(v) ? Number(v) : v;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/** Le numéro de commande d'un paiement chez un prestataire limité à 32 caractères. */
function numeroDeCommande(paiementId: string): string {
  return paiementId.replace(/-/g, "").slice(0, 32);
}

interface DemandeDeLien {
  paiementId: string;
  /** Le montant TTC dans la plus petite unité de la devise (le millime du dinar). */
  unites: number;
  /** Le code numérique ISO 4217 de la devise (`ref.devises`). */
  devise: string;
  libelle: string;
  retour: string;
  /** L'adresse où le prestataire notifie un état final, s'il sait le faire. */
  notification?: string;
}

export interface Prestataire {
  /** Le code du prestataire (`facturation.prestataires_paiement.code`). */
  code: string;
  /** Vrai pour un adaptateur dont l'écran de l'application tient lieu de page de carte. */
  simule: boolean;
  creerLien(d: DemandeDeLien): Promise<{ reference: string; lien: string }>;
  etat(reference: string, attendu: Attendu): Promise<Constat>;
}

/** ClicToPay (SMT) : `register.do` crée la commande, `getOrderStatusExtended.do` la lit. */
export function clictopay(
  config: { code: string; url: string; langue: string; utilisateur: string; motDePasse: string },
  fetchImpl: typeof fetch = fetch,
): Prestataire {
  const base = config.url.endsWith("/") ? config.url : `${config.url}/`;
  const appel = async (operation: string, champs: Record<string, string>) => {
    const corps = new URLSearchParams({
      userName: config.utilisateur,
      password: config.motDePasse,
      ...champs,
    });
    const r = await fetchImpl(`${base}${operation}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: corps.toString(),
      signal: AbortSignal.timeout(DELAI_APPEL_PRESTATAIRE_MS),
    });
    if (!r.ok) throw new Error(`clictopay ${operation} : HTTP ${r.status}`);
    return (await r.json()) as Record<string, unknown>;
  };

  return {
    code: config.code,
    simule: false,
    async creerLien(d) {
      const r = await appel("register.do", {
        // Le numéro de commande est l'identifiant du paiement : unique par
        // construction, et relisible des deux côtés.
        orderNumber: numeroDeCommande(d.paiementId),
        amount: String(d.unites),
        currency: d.devise,
        language: config.langue,
        returnUrl: d.retour,
        failUrl: d.retour,
        description: d.libelle.slice(0, 99),
      });
      const reference = typeof r["orderId"] === "string" ? r["orderId"] : null;
      const lien = typeof r["formUrl"] === "string" ? r["formUrl"] : null;
      if (!reference || !lien) {
        throw new Error(`clictopay register.do : ${String(r["errorMessage"] ?? r["errorCode"])}`);
      }
      return { reference, lien };
    },
    async etat(reference, attendu) {
      const r = await appel("getOrderStatusExtended.do", {
        orderId: reference,
        language: config.langue,
      });
      const statut = Number(r["orderStatus"] ?? r["OrderStatus"]);
      const unites = entier(r["amount"]);
      const commande = typeof r["orderNumber"] === "string" ? r["orderNumber"] : null;
      // 2 : commande payée — pour CE paiement et CE montant, sinon c'est une
      // anomalie. 3, 4, 6 : annulée ou remboursée. Le reste attend.
      const etat: EtatChezLePrestataire =
        statut === 2
          ? unites === attendu.unites && commande === numeroDeCommande(attendu.paiementId)
            ? "paye"
            : "anomalie"
          : statut === 3 || statut === 4 || statut === 6
            ? "refuse"
            : "en_attente";
      return {
        etat,
        detail: {
          orderStatus: statut,
          errorCode: r["errorCode"] ?? null,
          orderNumber: commande,
          unites_encaissees: unites,
        },
      };
    },
  };
}

/**
 * Flouci : `generate_payment` crée la session, `verify_payment` la lit
 * (docs.flouci.com, relue le 16 novembre 2026). Flouci compte en millimes ; la
 * devise qu'il traite vit en table (`facturation.devises_par_prestataire`), où
 * la base refuse les autres avant toute demande de lien. La même adresse sert le bac à sable et la
 * production : seules les clés changent. L'adresse vit en table (la tour).
 */
export function flouci(
  config: { code: string; url: string; clePublique: string; clePrivee: string },
  fetchImpl: typeof fetch = fetch,
): Prestataire {
  const base = config.url.replace(/\/+$/, "");
  const entetes = {
    authorization: `Bearer ${config.clePublique}:${config.clePrivee}`,
    accept: "application/json",
  };
  return {
    code: config.code,
    simule: false,
    async creerLien(d) {
      const r = await fetchImpl(`${base}/api/v2/generate_payment`, {
        method: "POST",
        headers: { ...entetes, "content-type": "application/json" },
        body: JSON.stringify({
          amount: String(d.unites),
          accept_card: true,
          success_link: d.retour,
          fail_link: d.retour,
          // L'identifiant du paiement : Flouci le rend tel quel à la vérification.
          developer_tracking_id: d.paiementId,
          // La notification signée (v2) : un paiement se constate même si le
          // client ne revient pas sur Malica.
          ...(d.notification ? { webhook: d.notification, webhook_version: 2 } : {}),
        }),
        signal: AbortSignal.timeout(DELAI_APPEL_PRESTATAIRE_MS),
      });
      if (!r.ok) throw new Error(`flouci generate_payment : HTTP ${r.status}`);
      const corps = (await r.json()) as { result?: Record<string, unknown> };
      const res = corps.result ?? {};
      const reference = typeof res["payment_id"] === "string" ? res["payment_id"] : null;
      const lien = typeof res["link"] === "string" ? res["link"] : null;
      if (res["success"] !== true || !reference || !lien) {
        throw new Error(`flouci generate_payment : ${String(res["message"] ?? res["status"])}`);
      }
      // Flouci rend l'identifiant qu'on lui a confié : un autre est une réponse
      // qui ne concerne pas ce paiement.
      if (res["developer_tracking_id"] != null && res["developer_tracking_id"] !== d.paiementId) {
        throw new Error("flouci generate_payment : identifiant de suivi différent");
      }
      return { reference, lien };
    },
    async etat(reference, attendu) {
      const r = await fetchImpl(`${base}/api/v2/verify_payment/${encodeURIComponent(reference)}`, {
        method: "GET",
        headers: entetes,
        signal: AbortSignal.timeout(DELAI_APPEL_PRESTATAIRE_MS),
      });
      if (!r.ok) throw new Error(`flouci verify_payment : HTTP ${r.status}`);
      const corps = (await r.json()) as { success?: unknown; result?: Record<string, unknown> };
      const res = corps.result ?? {};
      const statut = typeof res["status"] === "string" ? res["status"] : null;
      const unites = entier(res["amount"]);
      const suivi =
        typeof res["developer_tracking_id"] === "string" ? res["developer_tracking_id"] : null;
      // Le contenu ne se lit que si `success` est vrai (consigne de Flouci).
      // SUCCESS : payé — pour CE paiement et CE montant, sinon c'est une
      // anomalie. FAILURE, EXPIRED, SYSTEM_FAILURE : la session est close sans
      // argent. PENDING, PREAUTH_SUCCESS : on attend.
      const etat: EtatChezLePrestataire =
        corps.success !== true
          ? "en_attente"
          : statut === "SUCCESS"
            ? unites === attendu.unites && suivi === attendu.paiementId
              ? "paye"
              : "anomalie"
            : statut === "FAILURE" || statut === "EXPIRED" || statut === "SYSTEM_FAILURE"
              ? "refuse"
              : "en_attente";
      return {
        etat,
        detail: {
          status: statut,
          type: res["type"] ?? null,
          developer_tracking_id: suivi,
          settlement_status: res["settlement_status"] ?? null,
          unites_encaissees: unites,
        },
      };
    },
  };
}

/**
 * Le simulateur du staging : il renvoie à l'adresse de retour, marquée
 * `simulateur=1`, où l'écran propose « Payer » ou « Refuser ». La décision y
 * est inscrite directement (`simulerPaiement`), donc `etat` n'a rien à
 * demander à personne.
 */
function simulateur(code: string): Prestataire {
  return {
    code,
    simule: true,
    async creerLien(d) {
      const lien = new URL(d.retour);
      lien.searchParams.set("simulateur", "1");
      return { reference: `sim-${d.paiementId}`, lien: lien.toString() };
    },
    async etat() {
      return { etat: "en_attente", detail: { unites_encaissees: null } };
    },
  };
}

/** Le réglage en vigueur, joint à ce que la table dit du prestataire. */
export interface ReglagePaiement {
  prestataire: string;
  url_api: string | null;
  url_retour: string | null;
  adaptateur: string | null;
  ouvre_le_paiement: boolean;
  langue: string | null;
  /** Les hôtes où l'API de ce prestataire peut être jointe (`facturation.hotes_par_prestataire`). */
  hotes_api: readonly string[];
}

type Env = Record<string, string | undefined>;

/**
 * Les adaptateurs que ce serveur sait faire parler : une entrée par valeur de
 * `facturation.prestataires_paiement.adaptateur` (une épreuve sur base le
 * vérifie). `pret` dit si ses secrets sont posés — rien d'autre n'en sort.
 */
export const ADAPTATEURS: Readonly<
  Record<
    string,
    {
      pret(env: Env): boolean;
      creer(r: ReglagePaiement, env: Env, fetchImpl: typeof fetch): Prestataire | null;
    }
  >
> = {
  // Le simulateur ne fait entrer aucun argent : il n'existe que là où on l'a
  // voulu — hors production, ou sur un serveur de recette qui le déclare
  // (`PAIEMENT_SIMULATEUR=oui`, posé par le déploiement du staging seul). Sur le
  // pilote ou la production, la tour peut le choisir : le paiement en ligne reste
  // fermé (audit du 23 novembre 2026, B3).
  simulateur: {
    pret: (env) => env["NODE_ENV"] !== "production" || env["PAIEMENT_SIMULATEUR"] === "oui",
    creer(r, env) {
      return this.pret(env) ? simulateur(r.prestataire) : null;
    },
  },
  clictopay: {
    pret: (env) =>
      Boolean(env["CLICTOPAY_UTILISATEUR"]?.trim() && env["CLICTOPAY_MOT_DE_PASSE"]?.trim()),
    creer(r, env, fetchImpl) {
      const url = r.url_api?.trim();
      if (!url || !r.langue || !this.pret(env)) return null;
      return clictopay(
        {
          code: r.prestataire,
          url,
          langue: r.langue,
          utilisateur: env["CLICTOPAY_UTILISATEUR"]!.trim(),
          motDePasse: env["CLICTOPAY_MOT_DE_PASSE"]!.trim(),
        },
        fetchImpl,
      );
    },
  },
  flouci: {
    pret: (env) => Boolean(env["FLOUCI_CLE_PUBLIQUE"]?.trim() && env["FLOUCI_CLE_PRIVEE"]?.trim()),
    creer(r, env, fetchImpl) {
      const url = r.url_api?.trim();
      if (!url || !this.pret(env)) return null;
      return flouci(
        {
          code: r.prestataire,
          url,
          clePublique: env["FLOUCI_CLE_PUBLIQUE"]!.trim(),
          clePrivee: env["FLOUCI_CLE_PRIVEE"]!.trim(),
        },
        fetchImpl,
      );
    },
  },
};

/** Les secrets de l'adaptateur de ce prestataire sont-ils posés ? `null` : aucun adaptateur. */
export function secretsPoses(adaptateur: string | null, env: Env = process.env): boolean | null {
  if (!adaptateur) return null;
  return ADAPTATEURS[adaptateur]?.pret(env) ?? false;
}

/**
 * Les écrans où l'on revient de la page du prestataire, et où le retour se
 * vérifie auprès de lui : la société, la page Abonnement de ses réglages — là
 * où sont « À régler » et les boutons du simulateur, pas le sommaire (recette
 * du 11 novembre 2026, 3.5) ; le cabinet, la page de choix du paiement.
 */
export const ECRANS_DE_RETOUR = {
  societe: () => "/pme/reglages?page=abonnement",
  cabinet: (paiementId: string) => `/cabinet/payer/${encodeURIComponent(paiementId)}`,
} as const;

/** L'adresse où le client revient de la page du prestataire — une règle, pour tous. */
export function adresseDeRetour(
  urlPublique: string,
  ecran: keyof typeof ECRANS_DE_RETOUR,
  paiementId: string,
): string {
  const adresse = new URL(`${urlPublique}${ECRANS_DE_RETOUR[ecran](paiementId)}`);
  adresse.searchParams.set("paiement", paiementId);
  return adresse.toString();
}

/**
 * L'adresse de l'API est-elle sur un hôte de ce prestataire ? Les clés marchandes
 * ne partent nulle part ailleurs (audit du 23 novembre 2026, B5) — la base le
 * refuse déjà au réglage ; l'API le redit avant chaque envoi.
 */
export function hoteAutorise(url: string, hotes: readonly string[]): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && hotes.includes(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * L'adaptateur d'un prestataire désigné (le réglage en vigueur, ou celui qui a
 * créé un lien encore ouvert), ou `null` : adaptateur inconnu, secrets absents,
 * ou adresse d'API hors de ses hôtes.
 */
export function adaptateurDe(
  reglage: Omit<ReglagePaiement, "url_retour" | "ouvre_le_paiement">,
  env: Env = process.env,
  fetchImpl: typeof fetch = fetch,
): Prestataire | null {
  const fabrique = reglage.adaptateur ? ADAPTATEURS[reglage.adaptateur] : undefined;
  if (!fabrique) return null;
  const url = reglage.url_api?.trim();
  if (url && !hoteAutorise(url, reglage.hotes_api)) return null;
  return fabrique.creer({ ...reglage, url_retour: null, ouvre_le_paiement: true }, env, fetchImpl);
}

/** Le prestataire que la tour a ouvert, ou `null` quand le paiement en ligne est fermé. */
export function prestataireDuReglage(
  reglage: ReglagePaiement,
  env: Env = process.env,
  fetchImpl: typeof fetch = fetch,
): { prestataire: Prestataire; urlPublique: string } | null {
  const urlPublique = reglage.url_retour?.trim().replace(/\/+$/, "");
  if (!reglage.ouvre_le_paiement || !reglage.adaptateur || !urlPublique) return null;
  if (!urlPublique.startsWith("https://")) return null;
  const prestataire = adaptateurDe(reglage, env, fetchImpl);
  return prestataire ? { prestataire, urlPublique } : null;
}
