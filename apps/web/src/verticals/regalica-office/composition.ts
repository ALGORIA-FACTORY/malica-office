import { createSupabaseCaptureRepository } from "./adapters/supabase/capture.repository";
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
} from "./ports/repositories";

/**
 * Point de composition unique : seul endroit qui connaît les adaptateurs.
 *
 * La sortie de Supabase est faite pour les données : les neuf dépôts métier
 * passent par l'API, sous la RLS, avec la session portée par cookie httpOnly.
 * Les adaptateurs Supabase correspondants ont été supprimés — on ne garde pas
 * un chemin mort en réserve (R9).
 *
 * Reste `capture`, et une seule raison : elle dépose des fichiers. Le stockage
 * de l'API n'existe pas encore ; le jour où il existera, cette dernière ligne
 * Supabase partira avec le client.
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
        }
      : {
          auth: creerAuthHttp(),
          identity: creerDepotHttp<IdentityRepository>("identite"),
          referential: creerDepotHttp<ReferentialRepository>("referentiel"),
          capture: createSupabaseCaptureRepository(),
          office: creerDepotHttp<OfficeRepository>("office"),
          supervision: creerDepotHttp<SupervisionRepository>("supervision"),
          immo: creerDepotHttp<ImmoRepository>("immo"),
          stocks: creerDepotHttp<StocksRepository>("stocks"),
          banque: creerDepotHttp<BanqueRepository>("banque"),
          collab: creerDepotHttp<CollabRepository>("collab"),
          charges: creerDepotHttp<ChargesRepository>("charges"),
        };
  }
  return runtime;
}
