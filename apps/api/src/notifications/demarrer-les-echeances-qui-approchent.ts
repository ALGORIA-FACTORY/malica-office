/**
 * L'alerte « échéance qui approche » (décisions du 22 novembre 2026) : un tic
 * toutes les heures, lancé par `server.ts` seul.
 *
 * Toute la règle est en base (`notif.echeances_qui_approchent`, migration
 * 20261231130000) : le préavis (`notif.preavis`), le jour de chaque dossier
 * (son fuseau, jamais l'heure du serveur — R4), le groupement par société et
 * par jour d'échéance, le « une fois » et le verrou entre deux API. Ce
 * travailleur ne décide que QUAND il passe.
 */
import { horsRlsAuthentificationSeule, type Requete } from "../db.ts";
import { tracerUnTravail } from "../observabilite/journal.ts";

/** Toutes les heures, et une première fois cinq minutes après le démarrage. */
const CADENCE_MS = 60 * 60 * 1000;
const PREMIER_TOUR_MS = 5 * 60 * 1000;

/** Ce que rend `notif.echeances_qui_approchent`. */
export interface BilanDesEcheances {
  /** `null` : aucun préavis en vigueur, rien ne part. */
  preavis: number | null;
  /** Les jours d'échéance annoncés à ce tour (une alerte par société et par jour). */
  dites: number;
  /** Les personnes qui les ont reçues. */
  destinataires: number;
  /** Les dossiers passés faute de fuseau défini. */
  passes: number;
}

type Executer = <T>(travail: (db: Requete) => Promise<T>) => Promise<T>;

/** Un tour, dans UNE transaction de l'exécuteur. Les épreuves l'appellent avec la leur. */
export async function tourDesEcheances(executer: Executer): Promise<BilanDesEcheances> {
  return executer(async (db) => {
    const { rows } = await db.query<{ r: BilanDesEcheances }>(
      "select notif.echeances_qui_approchent() as r",
    );
    return rows[0]!.r;
  });
}

/** Lancé par `server.ts` : jamais par les épreuves, qui appellent `tourDesEcheances`. */
export function demarrerLesEcheancesQuiApprochent() {
  const tic = async () => {
    try {
      const b = await tracerUnTravail(
        "echeances_qui_approchent",
        null,
        () => tourDesEcheances(horsRlsAuthentificationSeule),
        {
          juger: (bilan) => ({
            issue: "ok",
            resultat: bilan.preavis === null ? "sans_preavis" : `dites_${bilan.dites}`,
          }),
        },
      );
      if (b.dites > 0) {
        console.log(
          `[echeances] ${b.dites} jour(s) d'échéance annoncé(s), ` +
            `${b.destinataires} destinataire(s), ${b.passes} dossier(s) sans fuseau`,
        );
      }
    } catch (e) {
      console.error("[echeances] passage interrompu :", e instanceof Error ? e.message : e);
    }
  };
  setTimeout(() => void tic(), PREMIER_TOUR_MS).unref();
  setInterval(() => void tic(), CADENCE_MS).unref();
}
