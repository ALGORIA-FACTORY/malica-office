/**
 * Le briefing de transfert d'un dossier, rédigé par Regalica.
 *
 * ============================================================== POURQUOI
 *
 * Une réaffectation emporte un briefing : le collaborateur qui reçoit le
 * dossier reçoit aussi ce qu'il doit savoir. Regalica le rédige — mais
 * depuis les faits que les moteurs rendent pour CE dossier (la file, les
 * échéances dérivées du pack, la fiche fiscale, le journal du mandat), et
 * jamais depuis sa mémoire. L'expert relit, complète, puis affecte.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { FicheCourante } from "@/lib/fiche.functions";
import { redigerDepuisLesFaits, type Fait } from "@/lib/regalica/redaction.server";
import { exigerSession } from "@/lib/session-middleware";
import { sommeDecimale } from "@/lib/somme-decimale";
import type {
  ClientSummary,
  Echeance,
  QueueItem,
  ReglagesCabinet,
} from "@/verticals/regalica-office/ports/repositories";

const Input = z.object({
  cabinetId: z.string().uuid(),
  clientId: z.string().uuid(),
  /** L'adresse de la personne qui reçoit le dossier. */
  collaborateur: z.string().trim().min(1).max(200),
  langue: z.string().min(2).max(8),
});

export interface Briefing {
  texte: string;
  faits: Fait[];
}

export const briefingRediger = createServerFn({ method: "POST" })
  .middleware([exigerSession])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }): Promise<Briefing> => {
    const [clients, file, echeances, fiche, journal, reglages] = await Promise.all([
      context.api.rpc<ClientSummary[]>("supervision", "listClients", [data.cabinetId]),
      context.api.rpc<QueueItem[]>("supervision", "queue", [data.cabinetId, data.clientId]),
      context.api.rpc<Echeance[]>("collab", "echeances", [[data.clientId]]),
      context.api.rpc<FicheCourante | null>("identite", "ficheCourante", [data.clientId]),
      context.api.rpc<Array<{ action: string; at: string }>>("supervision", "journalDuMandat", [
        data.clientId,
        5,
      ]),
      context.api.rpc<ReglagesCabinet>("parametrage", "reglagesCabinet", [data.cabinetId]),
    ]);
    const client = clients.find((c) => c.tenantId === data.clientId);
    if (!client) throw new Error("briefing.dossier_inconnu");

    const today = new Date().toISOString().slice(0, 10);
    const aSuperviser = file.filter((p) => p.status === "comptabilisee");
    const retournees = file.filter((p) => p.status === "retournee");
    const nonLues = file.filter((p) => p.status === "capturee");
    const enRetard = echeances.filter((e) => e.status === "en_retard");
    const prochaine = echeances.find((e) => e.status === "a_venir" && e.dueDate >= today) ?? null;

    const faits: Fait[] = [
      { label: "Client", valeur: client.name, source: "mandat" },
      ...(client.mandatDepuis
        ? [{ label: "Mandat depuis le", valeur: client.mandatDepuis, source: "mandat" }]
        : []),
      {
        label: "Pièces à superviser",
        valeur: String(aSuperviser.length),
        source: "file du cabinet",
      },
      {
        label: `Montant total des pièces à superviser (${client.currency})`,
        valeur: sommeDecimale(aSuperviser.map((p) => p.montant ?? "0")),
        source: "Socle · écritures",
      },
      {
        label: "Pièces retournées au client",
        valeur: String(retournees.length),
        source: "file du cabinet",
      },
      {
        label: "Pièces déposées non lues",
        valeur: String(nonLues.length),
        source: "file du cabinet",
      },
      { label: "Échéances en retard", valeur: String(enRetard.length), source: "moteur échéances" },
      ...(prochaine
        ? [
            {
              label: "Prochaine échéance",
              valeur: `${prochaine.label} le ${prochaine.dueDate}`,
              source: "moteur échéances · pack",
            },
          ]
        : []),
      ...(fiche?.regimeImposition
        ? [
            {
              label: "Régime d'imposition",
              valeur: fiche.regimeImposition,
              source: "fiche fiscale",
            },
          ]
        : []),
      ...(fiche?.regimeTva
        ? [{ label: "Régime de TVA", valeur: fiche.regimeTva, source: "fiche fiscale" }]
        : []),
      ...(fiche?.clotureExercice
        ? [
            {
              label: "Clôture de l'exercice (jour-mois)",
              valeur: fiche.clotureExercice,
              source: "fiche fiscale",
            },
          ]
        : []),
      ...(journal[0]
        ? [
            {
              label: "Dernier événement du mandat le",
              valeur: journal[0].at.slice(0, 10),
              source: "journal du mandat",
            },
          ]
        : []),
    ];

    const consigne = `Rédige le briefing de transfert du dossier « ${client.name} » pour ${data.collaborateur}, qui le reçoit aujourd'hui : ce qu'il doit savoir pour reprendre le dossier sans rien manquer, en un ou deux paragraphes courts. Commence par l'état de la file, puis les échéances, puis la situation fiscale.`;
    const redaction = await redigerDepuisLesFaits({
      consigne,
      faits,
      ton: reglages.ton,
      langue: data.langue,
    });
    return { texte: redaction.texte, faits: redaction.faits };
  });
