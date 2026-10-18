import { creerAuthHttp } from "./adapters/http/auth";
import { creerCaptureHttp } from "./adapters/http/capture";
import { creerMalicaHttp } from "./adapters/http/malica";
import { creerDepotHttp } from "./adapters/http/rpc";
import type { AuthPort } from "@malica/socle/ports/auth";
import type { MalicaPort } from "@malica/socle/ports/malica";
import type {
  CaptureRepository,
  ConversationsRepository,
  JournalRepository,
  IdentityRepository,
  OfficeRepository,
  ReferentialRepository,
  AccesRepository,
  SupervisionRepository,
  ImmoRepository,
  StocksRepository,
  BanqueRepository,
  CollabRepository,
  ChargesRepository,
  FacturationRepository,
  ConseilRepository,
  ParametrageRepository,
  TiersRepository,
  HonorairesRepository,
  ExportsRepository,
  IntegrationsRepository,
  SignalementsRepository,
} from "@malica/socle/ports/repositories";

/**
 * Point de composition unique : seul endroit qui connaît les adaptateurs.
 *
 * Il n'y a plus qu'un montage. Le mode de démonstration en avait un second,
 * peuplé d'adaptateurs qui inventaient des données — dix comptes là où le
 * référentiel en porte six cent vingt-six, des pièces qui n'existaient pas. Il
 * montrait donc une application qui n'était pas celle qui tourne, et le jour où
 * le paramétrage est arrivé il ne pouvait plus suivre.
 *
 * `db/dev/jeu_dessai.mjs` le remplace, et il est meilleur pour la seule raison
 * qui compte : ses données passent par l'API, la RLS et les déclencheurs. Si le
 * produit refuse, le jeu d'essai échoue — un adaptateur de démonstration, lui,
 * ne refuse jamais rien.
 *
 * La sortie du fournisseur précédent est faite : les onze dépôts passent par
 * l'API, sous la RLS, avec la session portée par cookie httpOnly. Ses
 * adaptateurs ont été supprimés — on ne garde pas un chemin mort en réserve (R9).
 *
 * `capture` a rejoint les autres : les octets passent par `/pieces/:id/contenu`.
 * Il ne reste plus une seule ligne de l'ancien fournisseur dans le chemin des
 * données — et le garde-fou de `src/__tests__/` le vérifie à chaque
 * exécution, pour que ce paragraphe ne devienne pas faux en silence.
 */

export interface OfficeRuntime {
  /** L'authentification est servie par l'API : plus aucun écran n'appelle un fournisseur. */
  auth: AuthPort;
  identity: IdentityRepository;
  referential: ReferentialRepository;
  capture: CaptureRepository;
  office: OfficeRepository;
  supervision: SupervisionRepository;
  acces: AccesRepository;
  immo: ImmoRepository;
  stocks: StocksRepository;
  banque: BanqueRepository;
  collab: CollabRepository;
  charges: ChargesRepository;
  /**
   * L'abonnement : le forfait, les places, ce que chaque société consomme.
   *
   * Il est entré ici le 18 octobre 2026 parce qu'il n'y était pas : trois
   * écrans PME montaient chacun leur propre dépôt `facturation` à côté de ce
   * fichier. Un dépôt monté ailleurs échappe au test qui confronte les ports
   * au contrat — une méthode mal nommée ne se voyait qu'à l'exécution.
   */
  facturation: FacturationRepository;
  conseil: ConseilRepository;
  parametrage: ParametrageRepository;
  tiers: TiersRepository;
  honoraires: HonorairesRepository;
  integrations: IntegrationsRepository;
  exports: ExportsRepository;
  /** Les fils de conversation — de la base, sans modèle : un dépôt comme les autres. */
  conversations: ConversationsRepository;
  /** Ce que la personne signale elle-même quand quelque chose n'a pas marché. */
  signalements: SignalementsRepository;
  /** Et ce que l'application constate toute seule quand un geste a échoué. */
  journal: JournalRepository;
  /** La couche agentique : tout ce qui fait parler un modèle, sur ses propres routes. */
  malica: MalicaPort;
}

let runtime: OfficeRuntime | null = null;

export function office(): OfficeRuntime {
  if (!runtime) {
    runtime = {
      auth: creerAuthHttp(),
      identity: creerDepotHttp<IdentityRepository>("identite"),
      referential: creerDepotHttp<ReferentialRepository>("referentiel"),
      capture: creerCaptureHttp(),
      office: creerDepotHttp<OfficeRepository>("office"),
      supervision: creerDepotHttp<SupervisionRepository>("supervision"),
      acces: creerDepotHttp<AccesRepository>("acces"),
      immo: creerDepotHttp<ImmoRepository>("immo"),
      stocks: creerDepotHttp<StocksRepository>("stocks"),
      banque: creerDepotHttp<BanqueRepository>("banque"),
      collab: creerDepotHttp<CollabRepository>("collab"),
      charges: creerDepotHttp<ChargesRepository>("charges"),
      facturation: creerDepotHttp<FacturationRepository>("facturation"),
      conseil: creerDepotHttp<ConseilRepository>("conseil"),
      parametrage: creerDepotHttp<ParametrageRepository>("parametrage"),
      tiers: creerDepotHttp<TiersRepository>("tiers"),
      journal: creerDepotHttp<JournalRepository>("journal"),
      honoraires: creerDepotHttp<HonorairesRepository>("honoraires"),
      integrations: creerDepotHttp<IntegrationsRepository>("integrations"),
      exports: creerDepotHttp<ExportsRepository>("exports"),
      conversations: creerDepotHttp<ConversationsRepository>("conversations"),
      signalements: creerDepotHttp<SignalementsRepository>("signalements"),
      malica: creerMalicaHttp(),
    };
  }

  return runtime;
}
