/**
 * La page Clients de la comptabilité : ce que chaque ligne dit, et les filtres
 * « ce qui reste à faire ». Des fonctions pures, lues par la page et testées
 * seules ; tout ce qu'elles lisent vient de la base.
 */
import type {
  ClientSummary,
  EtatDuClient,
  FicheCourante,
  MandatHonoraires,
} from "@malica/socle/ports/repositories";

export type FiltreClients = "tous" | "relancer" | "fiche" | "sansmandat" | "sansabo";

export const FILTRES: readonly FiltreClients[] = [
  "tous",
  "relancer",
  "fiche",
  "sansmandat",
  "sansabo",
];

/** Une fiche est complète quand le calendrier fiscal peut en naître. */
export function ficheComplete(f: FicheCourante | null | undefined): boolean {
  return Boolean(f?.regimeImposition && f.regimeTva && f.clotureExercice && f.formeJuridique);
}

/** Le dirigeant n'est pas venu : invitation en attente, expirée, ou jamais envoyée. */
function aRelancer(e: EtatDuClient | undefined): boolean {
  return Boolean(e && !e.dirigeantPresent);
}

/** Aucun abonnement que la comptabilité paie ou propose, ni par la licence partagée. */
function sansAbonnementCouvert(e: EtatDuClient | undefined, parLaLicence?: string | null): boolean {
  return !e?.accesStatut && !parLaLicence;
}

export interface LigneClient {
  client: ClientSummary;
  etat: EtatDuClient | undefined;
  fiche: FicheCourante | null | undefined;
  mandat: MandatHonoraires | undefined;
  /**
   * L'offre qui couvre déjà la licence partagée, payée par la comptabilité
   * pour une autre société du même dirigeant ; `null` sinon.
   */
  parLaLicence?: string | null;
}

export function correspond(l: LigneClient, filtre: FiltreClients): boolean {
  switch (filtre) {
    case "relancer":
      return aRelancer(l.etat);
    case "fiche":
      return l.fiche !== undefined && !ficheComplete(l.fiche);
    case "sansmandat":
      return !l.mandat;
    case "sansabo":
      return sansAbonnementCouvert(l.etat, l.parLaLicence);
    default:
      return true;
  }
}

export interface GroupeDeClients {
  /** La licence partagée, ou `null` : une société seule sous sa licence. */
  licenceId: string | null;
  titulaire: string | null;
  lignes: LigneClient[];
}

/**
 * Les lignes regroupées par propriétaire principal : les sociétés qui
 * partagent une licence se suivent sous son nom ; les autres restent seules.
 * L'ordre d'arrivée est gardé.
 */
export function regrouperParProprietaire(lignes: readonly LigneClient[]): GroupeDeClients[] {
  const parLicence = new Map<string, LigneClient[]>();
  for (const l of lignes) {
    const id = l.etat?.licenceId;
    if (id) parLicence.set(id, [...(parLicence.get(id) ?? []), l]);
  }
  const groupes: GroupeDeClients[] = [];
  const vus = new Set<string>();
  for (const l of lignes) {
    const id = l.etat?.licenceId ?? null;
    if (id && (parLicence.get(id)?.length ?? 0) > 1) {
      if (vus.has(id)) continue;
      vus.add(id);
      groupes.push({
        licenceId: id,
        titulaire: l.etat?.titulaireNom ?? null,
        lignes: parLicence.get(id)!,
      });
    } else {
      groupes.push({ licenceId: null, titulaire: null, lignes: [l] });
    }
  }
  return groupes;
}

/** Ce que la comptabilité règle chaque mois : les seuls abonnements actifs. */
function rangDe(
  code: string | null | undefined,
  offres: ReadonlyArray<{ code: string; rang: number }>,
) {
  return offres.find((o) => o.code === code)?.rang ?? 0;
}

/** L'effet d'un choix d'offre, avant de l'enregistrer. */
export type EffetDuChoix =
  "a_proposer" | "attente_dirigeant" | "montee" | "descente" | "actuelle" | "couvrir";

export function effetDuChoix(
  e: EtatDuClient | undefined,
  choix: string,
  offres: ReadonlyArray<{ code: string; rang: number }>,
): EffetDuChoix {
  if (!e?.accesStatut) return e?.dirigeantPresent ? "couvrir" : "a_proposer";
  if (e.accesStatut === "propose") return "attente_dirigeant";
  if (choix === e.accesOffre) return "actuelle";
  return rangDe(choix, offres) > rangDe(e.accesOffre, offres) ? "montee" : "descente";
}

/** Pour chaque société sans abonnement à elle : l'offre payée sur sa licence partagée. */
export function couverturesParLicence(lignes: readonly LigneClient[]): LigneClient[] {
  const payee = new Map<string, string>();
  for (const l of lignes) {
    if (l.etat?.licenceId && l.etat.accesStatut === "actif" && l.etat.accesOffre) {
      payee.set(l.etat.licenceId, l.etat.accesOffre);
    }
  }
  return lignes.map((l) =>
    !l.etat?.accesStatut && l.etat?.licenceId && payee.has(l.etat.licenceId)
      ? { ...l, parLaLicence: payee.get(l.etat.licenceId)! }
      : l,
  );
}
