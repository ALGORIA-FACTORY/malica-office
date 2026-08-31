import {
  createDevCaptureRepository,
  createDevIdentityRepository,
  createDevOfficeRepository,
  createDevReferentialRepository,
  createDevSupervisionRepository,
} from "./adapters/dev/demo.repository";
import {
  createDevBanqueRepository,
  createDevImmoRepository,
  createDevStocksRepository,
} from "./adapters/dev/patrimoine.demo";
import { createDevCollabRepository } from "./adapters/dev/collab.demo";
import { createDevChargesRepository } from "./adapters/dev/charges.demo";
import { creerAuthHttp } from "./adapters/http/auth";
import { creerCaptureHttp } from "./adapters/http/capture";
import { creerDepotHttp } from "./adapters/http/rpc";
import { isRegalicaDevAccessEnabled } from "@/lib/dev-access";
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
    runtime = isRegalicaDevAccessEnabled()
      ? {
          auth: creerAuthHttp(),
          identity: createDevIdentityRepository(),
          referential: createDevReferentialRepository(),
          capture: createDevCaptureRepository(),
          office: createDevOfficeRepository(),
          supervision: createDevSupervisionRepository(),
          immo: createDevImmoRepository(),
          stocks: createDevStocksRepository(),
          banque: createDevBanqueRepository(),
          collab: createDevCollabRepository(),
          charges: createDevChargesRepository(),
          // La démonstration ne simule pas le paramétrage : elle passe par
          // l'API comme la production. Un faux plan comptable ne dirait rien.
          parametrage: creerDepotHttp<ParametrageRepository>("parametrage"),
          tiers: creerDepotHttp<TiersRepository>("tiers"),
        }
      : {
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
