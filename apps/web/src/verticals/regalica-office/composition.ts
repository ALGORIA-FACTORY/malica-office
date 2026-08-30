import { createSupabaseCaptureRepository } from "./adapters/supabase/capture.repository";
import { createSupabaseIdentityRepository } from "./adapters/supabase/identity.repository";
import { createSupabaseOfficeRepository } from "./adapters/supabase/office.repository";
import { createSupabaseReferentialRepository } from "./adapters/supabase/ref.repository";
import { createSupabaseSupervisionRepository } from "./adapters/supabase/supervision.repository";
import { createSupabaseImmoRepository } from "./adapters/supabase/immo.repository";
import { createSupabaseStocksRepository } from "./adapters/supabase/stocks.repository";
import { createSupabaseBanqueRepository } from "./adapters/supabase/banque.repository";
import { createSupabaseCollabRepository } from "./adapters/supabase/collab.repository";
import { createSupabaseChargesRepository } from "./adapters/supabase/charges.repository";
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
import { creerDepotHttp } from "./adapters/http/rpc";
import { isRegalicaDevAccessEnabled } from "@/lib/dev-access";
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
 * Remplacer Supabase par l'API se fait ici, sans toucher un écran.
 *
 * La sortie de Supabase est en cours, dépôt par dépôt. Chaque dépôt porté et
 * vérifié bascule ici, et un seul endroit dit lequel passe par où — plutôt
 * qu'un drapeau global qui basculerait dix dépôts dont neuf ne sont pas prêts.
 *
 * Tous à `false` pour l'instant, et la raison mérite d'être écrite : l'API
 * authentifie par jeton JWT, l'application par Supabase. Tant que les deux ne
 * sont pas la même chose, un dépôt basculé ici appellerait l'API sans session
 * et recevrait un 401 sur chaque écran authentifié.
 *
 * **L'authentification doit donc être portée avant les données.** L'adaptateur
 * HTTP et le dépôt `referentiel` sont écrits et vérifiés côté API ; ils
 * attendent que la session soit commune.
 *
 * Quand les dix seront portés, cette carte disparaîtra avec la branche Supabase.
 */
const DEPOTS_PORTES = { referential: false } as const;
export interface OfficeRuntime {
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
          identity: createSupabaseIdentityRepository(),
          referential: DEPOTS_PORTES.referential
            ? creerDepotHttp<ReferentialRepository>("referentiel")
            : createSupabaseReferentialRepository(),
          capture: createSupabaseCaptureRepository(),
          office: createSupabaseOfficeRepository(),
          supervision: createSupabaseSupervisionRepository(),
          immo: createSupabaseImmoRepository(),
          stocks: createSupabaseStocksRepository(),
          banque: createSupabaseBanqueRepository(),
          collab: createSupabaseCollabRepository(),
          charges: createSupabaseChargesRepository(),
        };
  }
  return runtime;
}
