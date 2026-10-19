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
 * Le prestataire se choisit dans LA TOUR (`plateforme.paiement_regler`,
 * 20261022160000) : aucun, simulateur ou ClicToPay, avec l'adresse de l'API du
 * prestataire et l'adresse de retour. Seuls les SECRETS du compte marchand
 * restent dans l'environnement du serveur, et n'en sortent jamais :
 *
 *   CLICTOPAY_UTILISATEUR         l'identifiant marchand de l'API
 *   CLICTOPAY_MOT_DE_PASSE        son mot de passe
 *
 * « Aucun » — ou ClicToPay sans ses secrets — ferme le paiement en ligne, et on
 * le dit (`null`) : l'offre reste ouverte, la facture du mois suit. Le
 * simulateur peut s'ouvrir partout, parce qu'il ne fait entrer aucun argent :
 * ses « payés » ne s'imputent jamais sur une facture (la base y veille).
 */

type EtatChezLePrestataire = "paye" | "refuse" | "en_attente";

interface DemandeDeLien {
  paiementId: string;
  /** Le montant TTC en millimes : la plus petite unité du dinar. */
  millimes: number;
  libelle: string;
  retour: string;
}

export interface Prestataire {
  nom: "clictopay" | "simulateur";
  creerLien(d: DemandeDeLien): Promise<{ reference: string; lien: string }>;
  etat(
    reference: string,
  ): Promise<{ etat: EtatChezLePrestataire; detail: Record<string, unknown> }>;
}

/** Les montants de la base sont des chaînes `numeric` : on les lit en millimes, sans flottant. */
export function enMillimes(montant: string): number {
  const m = /^(-?)(\d+)(?:\.(\d{1,3}))?$/.exec(montant.trim());
  if (!m) throw new Error(`montant illisible : ${montant}`);
  const millimes = Number(m[2]) * 1000 + Number((m[3] ?? "").padEnd(3, "0"));
  return m[1] === "-" ? -millimes : millimes;
}

/** ClicToPay (SMT) : `register.do` crée la commande, `getOrderStatusExtended.do` la lit. */
export function clictopay(
  config: { url: string; utilisateur: string; motDePasse: string },
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
    nom: "clictopay",
    async creerLien(d) {
      const r = await appel("register.do", {
        // Le numéro de commande est l'identifiant du paiement : unique par
        // construction, et relisible des deux côtés.
        orderNumber: d.paiementId.replace(/-/g, "").slice(0, 32),
        amount: String(d.millimes),
        currency: "788",
        language: "fr",
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
      const r = await appel("getOrderStatusExtended.do", { orderId: reference, language: "fr" });
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
 * Le simulateur du staging : un lien vers l'écran de l'application qui
 * propose « Payer » ou « Refuser ». La décision y est inscrite directement
 * (`simulerPaiement`), donc `etat` n'a rien à demander à personne.
 */
function simulateur(urlPublique: string): Prestataire {
  return {
    nom: "simulateur",
    async creerLien(d) {
      return {
        reference: `sim-${d.paiementId}`,
        lien: `${urlPublique}/pme/reglages?paiement=${d.paiementId}&simulateur=1`,
      };
    },
    async etat() {
      return { etat: "en_attente", detail: {} };
    },
  };
}

/** Le réglage de la tour, tel que `public.paiement_reglage()` le rend. */
export interface ReglagePaiement {
  prestataire: "aucun" | "simulateur" | "clictopay";
  url_api: string | null;
  url_retour: string | null;
}

/** Les secrets du compte marchand sont-ils posés sur ce serveur ? (Rien d'autre n'en sort.) */
export function secretsClictopayPoses(env: Record<string, string | undefined> = process.env) {
  return Boolean(env["CLICTOPAY_UTILISATEUR"]?.trim() && env["CLICTOPAY_MOT_DE_PASSE"]?.trim());
}

/** Le prestataire que la tour a ouvert, ou `null` quand le paiement en ligne est fermé. */
export function prestataireDuReglage(
  reglage: ReglagePaiement,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): { prestataire: Prestataire; urlPublique: string } | null {
  const urlPublique = reglage.url_retour?.trim().replace(/\/+$/, "");
  if (reglage.prestataire === "aucun" || !urlPublique) return null;
  if (reglage.prestataire === "simulateur") {
    return { prestataire: simulateur(urlPublique), urlPublique };
  }
  if (reglage.prestataire === "clictopay") {
    const url = reglage.url_api?.trim();
    if (!url || !secretsClictopayPoses(env)) return null;
    return {
      prestataire: clictopay(
        {
          url,
          utilisateur: env["CLICTOPAY_UTILISATEUR"]!.trim(),
          motDePasse: env["CLICTOPAY_MOT_DE_PASSE"]!.trim(),
        },
        fetchImpl,
      ),
      urlPublique,
    };
  }
  return null;
}
