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
 *
 * Un prestataire qui n'ouvre rien — ou un adaptateur sans ses secrets — ferme
 * le paiement en ligne, et on le dit (`null`) : l'offre reste ouverte, la
 * facture du mois suit.
 */

type EtatChezLePrestataire = "paye" | "refuse" | "en_attente";

interface DemandeDeLien {
  paiementId: string;
  /** Le montant TTC dans la plus petite unité de la devise (le millime du dinar). */
  unites: number;
  /** Le code numérique ISO 4217 de la devise (`ref.devises`). */
  devise: string;
  libelle: string;
  retour: string;
}

export interface Prestataire {
  /** Le code du prestataire (`facturation.prestataires_paiement.code`). */
  code: string;
  /** Vrai pour un adaptateur dont l'écran de l'application tient lieu de page de carte. */
  simule: boolean;
  creerLien(d: DemandeDeLien): Promise<{ reference: string; lien: string }>;
  etat(
    reference: string,
  ): Promise<{ etat: EtatChezLePrestataire; detail: Record<string, unknown> }>;
}

/**
 * Un montant `numeric` de la base, en unités mineures, sans flottant :
 * `enUnitesMineures("17.850", 3)` vaut 17 850 millimes.
 */
export function enUnitesMineures(montant: string, exposant: number): number {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(montant.trim());
  if (!m || (m[3] ?? "").length > exposant) throw new Error(`montant illisible : ${montant}`);
  const unites = Number(m[2]) * 10 ** exposant + Number((m[3] ?? "").padEnd(exposant, "0") || 0);
  return m[1] === "-" ? -unites : unites;
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
      signal: AbortSignal.timeout(15_000),
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
        orderNumber: d.paiementId.replace(/-/g, "").slice(0, 32),
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
    async etat(reference) {
      const r = await appel("getOrderStatusExtended.do", {
        orderId: reference,
        language: config.langue,
      });
      const statut = Number(r["orderStatus"] ?? r["OrderStatus"]);
      // 2 : commande payée. 3, 4, 6 : annulée ou remboursée. Le reste attend.
      const etat: EtatChezLePrestataire =
        statut === 2
          ? "paye"
          : statut === 3 || statut === 4 || statut === 6
            ? "refuse"
            : "en_attente";
      return { etat, detail: { orderStatus: statut, errorCode: r["errorCode"] ?? null } };
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
      return { etat: "en_attente", detail: {} };
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
  simulateur: {
    pret: () => true,
    creer: (r) => simulateur(r.prestataire),
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
};

/** Les secrets de l'adaptateur de ce prestataire sont-ils posés ? `null` : aucun adaptateur. */
export function secretsPoses(adaptateur: string | null, env: Env = process.env): boolean | null {
  if (!adaptateur) return null;
  return ADAPTATEURS[adaptateur]?.pret(env) ?? false;
}

/** L'adresse où le client revient de la page du prestataire — une seule, pour tous. */
export function adresseDeRetour(urlPublique: string, paiementId: string): string {
  return `${urlPublique}/pme/reglages?${new URLSearchParams({ paiement: paiementId })}`;
}

/** Le prestataire que la tour a ouvert, ou `null` quand le paiement en ligne est fermé. */
export function prestataireDuReglage(
  reglage: ReglagePaiement,
  env: Env = process.env,
  fetchImpl: typeof fetch = fetch,
): { prestataire: Prestataire; urlPublique: string } | null {
  const urlPublique = reglage.url_retour?.trim().replace(/\/+$/, "");
  if (!reglage.ouvre_le_paiement || !reglage.adaptateur || !urlPublique) return null;
  const prestataire = ADAPTATEURS[reglage.adaptateur]?.creer(reglage, env, fetchImpl) ?? null;
  return prestataire ? { prestataire, urlPublique } : null;
}
