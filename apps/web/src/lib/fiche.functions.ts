/**
 * La fiche fiscale : lire la carte, établir la fiche.
 *
 * =============================================== DEUX GESTES, PAS UN
 *
 * Lire n'établit rien. La lecture propose ce qu'elle a vu ; c'est l'expert qui
 * arrête la fiche — R10. Entre les deux il corrige, complète, ou renonce.
 *
 * Confondre les deux gestes ferait qu'une carte mal cadrée deviendrait le
 * régime fiscal du dossier sans que personne ne l'ait regardée.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { lireCarteFiscale } from "@/lib/capture/lire-carte.server";
import { exigerSession } from "@/lib/session-middleware";

const RegimesInput = z.object({
  jurisdiction: z.string().min(2).max(8),
});

const LireInput = z.object({
  jurisdiction: z.string().min(2).max(8),
  /** L'image de la carte, telle que l'appareil ou le fichier l'a rendue. */
  dataUrl: z.string().startsWith("data:").max(12_000_000),
  mime: z.string().min(3).max(120).optional(),
});

const EtablirInput = z.object({
  tenantId: z.string().uuid(),
  regimeImposition: z.string().min(1).max(40).nullish(),
  regimeTva: z.string().min(1).max(40).nullish(),
  prorataTva: z.number().min(0).max(100).nullish(),
  secteur: z.string().trim().min(1).max(200).nullish(),
  debutActivite: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  clotureExercice: z
    .string()
    .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/)
    .nullish(),
  formeJuridique: z.string().min(1).max(40).nullish(),
  modeDepot: z.string().min(1).max(40).nullish(),
  source: z.enum(["carte", "saisie"]),
  pieceId: z.string().uuid().nullish(),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export interface RegimeDisponible {
  axe: "imposition" | "tva";
  code: string;
  libelle: string;
  fondement: string;
}

export const ficheRegimes = createServerFn({ method: "POST" })
  .middleware([exigerSession])
  .inputValidator((data: unknown) => RegimesInput.parse(data))
  .handler(({ data, context }) =>
    context.api.rpc<RegimeDisponible[]>("identite", "regimesDisponibles", [data.jurisdiction]),
  );

export const ficheLireCarte = createServerFn({ method: "POST" })
  .middleware([exigerSession])
  .inputValidator((data: unknown) => LireInput.parse(data))
  .handler(async ({ data, context }) => {
    // Les régimes viennent de la base AVANT la lecture : le désignateur choisit
    // dans une liste, il n'invente pas un intitulé.
    const regimes = await context.api.rpc<RegimeDisponible[]>("identite", "regimesDisponibles", [
      data.jurisdiction,
    ]);
    /*
     * Les octets, pour le PDF.
     *
     * L'appareil photo natif ne rend pas une image : le produit l'emballe en
     * PDF, comme toute pièce. Or la lecture d'un PDF extrait ses pages depuis
     * les OCTETS, pas depuis une adresse de données — sans eux, le relevé
     * revient vide et la carte semble illisible alors qu'elle est parfaite.
     */
    const virgule = data.dataUrl.indexOf(",");
    const octets =
      virgule > 0 ? new Uint8Array(Buffer.from(data.dataUrl.slice(virgule + 1), "base64")) : null;

    return lireCarteFiscale({
      dataUrl: data.dataUrl,
      ...(data.mime ? { mime: data.mime } : {}),
      ...(octets && octets.length > 0 ? { bytes: octets } : {}),
      regimes,
    });
  });

export const ficheEtablir = createServerFn({ method: "POST" })
  .middleware([exigerSession])
  .inputValidator((data: unknown) => EtablirInput.parse(data))
  .handler(({ data, context }) =>
    context.api.rpc<{ id: string }>("identite", "etablirFiche", [
      {
        tenantId: data.tenantId,
        regimeImposition: data.regimeImposition ?? null,
        regimeTva: data.regimeTva ?? null,
        prorataTva: data.prorataTva ?? null,
        secteur: data.secteur ?? null,
        debutActivite: data.debutActivite ?? null,
        clotureExercice: data.clotureExercice ?? null,
        formeJuridique: data.formeJuridique ?? null,
        modeDepot: data.modeDepot ?? null,
        source: data.source,
        pieceId: data.pieceId ?? null,
        validFrom: data.validFrom,
      },
    ]),
  );

export interface FicheCourante {
  id: string;
  regimeImposition: string | null;
  regimeTva: string | null;
  prorataTva: string | null;
  secteur: string | null;
  debutActivite: string | null;
  clotureExercice: string | null;
  formeJuridique: string | null;
  modeDepot: string | null;
  source: string;
  pieceId: string | null;
  validFrom: string;
  validTo: string | null;
}

/** Une forme juridique ou un mode de dépôt que le calendrier distingue. */
export interface FormeDisponible {
  axe: "forme" | "mode";
  code: string;
}

export const ficheFormes = createServerFn({ method: "POST" })
  .middleware([exigerSession])
  .inputValidator((data: unknown) => RegimesInput.parse(data))
  .handler(({ data, context }) =>
    context.api.rpc<FormeDisponible[]>("identite", "formesDisponibles", [data.jurisdiction]),
  );

export const ficheCourante = createServerFn({ method: "POST" })
  .middleware([exigerSession])
  .inputValidator((data: unknown) => z.object({ tenantId: z.string().uuid() }).parse(data))
  .handler(({ data, context }) =>
    context.api.rpc<FicheCourante | null>("identite", "ficheCourante", [data.tenantId]),
  );
