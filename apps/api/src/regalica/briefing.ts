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
import type { Briefing, Fait } from "@regalica/socle/ports/regalica";
import type {
  ClientSummary,
  Echeance,
  FicheCourante,
  QueueItem,
  ReglagesCabinet,
} from "@regalica/socle/ports/repositories";
import { sommeDecimale } from "@regalica/socle/somme-decimale";

import type { AppelApi } from "./appel-local.ts";
import { redigerDepuisLesFaits } from "./conseil/redaction.ts";

export async function redigerLeBriefing(
  api: AppelApi,
  input: { cabinetId: string; clientId: string; collaborateur: string; langue: string },
): Promise<Briefing> {
  const [clients, file, echeances, fiche, journal, reglages] = await Promise.all([
    api.rpc<ClientSummary[]>("supervision", "listClients", [input.cabinetId]),
    api.rpc<QueueItem[]>("supervision", "queue", [input.cabinetId, input.clientId]),
    api.rpc<Echeance[]>("collab", "echeances", [[input.clientId]]),
    api.rpc<FicheCourante | null>("identite", "ficheCourante", [input.clientId]),
    api.rpc<Array<{ action: string; at: string }>>("supervision", "journalDuMandat", [
      input.clientId,
      5,
    ]),
    api.rpc<ReglagesCabinet>("parametrage", "reglagesCabinet", [input.cabinetId]),
  ]);
  const client = clients.find((c) => c.tenantId === input.clientId);
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

  const consigne = `Rédige le briefing de transfert du dossier « ${client.name} » pour ${input.collaborateur}, qui le reçoit aujourd'hui : ce qu'il doit savoir pour reprendre le dossier sans rien manquer, en un ou deux paragraphes courts. Commence par l'état de la file, puis les échéances, puis la situation fiscale.`;
  const redaction = await redigerDepuisLesFaits({
    consigne,
    faits,
    ton: reglages.ton,
    langue: input.langue,
  });
  return { texte: redaction.texte, faits: redaction.faits };
}
