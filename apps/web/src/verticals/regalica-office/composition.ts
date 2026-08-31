import { creerAuthHttp } from "./adapters/http/auth";
import { creerCaptureHttp } from "./adapters/http/capture";
import { creerDepotHttp } from "./adapters/http/rpc";
import type { AuthPort } from "./ports/auth";
import type {
  CaptureRepository,
  IdentityRepository,
  OfficeRepository,
  ReferentialRepository,
  SupervisionRepository,
  ImmoRepository,
  StocksRepository,
  BanqueRepository,
  CollabRepository,
  ChargesRepository,
  ParametrageRepository,
  TiersRepository,
} from "./ports/repositories";

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
  immo: ImmoRepository;
  stocks: StocksRepository;
  banque: BanqueRepository;
  collab: CollabRepository;
  charges: ChargesRepository;
  parametrage: ParametrageRepository;
  tiers: TiersRepository;
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
      immo: creerDepotHttp<ImmoRepository>("immo"),
      stocks: creerDepotHttp<StocksRepository>("stocks"),
      banque: creerDepotHttp<BanqueRepository>("banque"),
      collab: creerDepotHttp<CollabRepository>("collab"),
      charges: creerDepotHttp<ChargesRepository>("charges"),
      parametrage: creerDepotHttp<ParametrageRepository>("parametrage"),
      tiers: creerDepotHttp<TiersRepository>("tiers"),
    };
  }

  return runtime;
}
