/**
 * L'émission automatique des factures (décisions du 4 novembre 2026) : un tic
 * toutes les heures, lancé par `server.ts` seul.
 *
 * Toute la règle est en base (`fabrique.facturation_du_jour`, migrations
 * 20261127090000 et 20261128090000) : deux périmètres que la tour ouvre
 * chacun seul — les cabinets au mois, à terme échu ; les PME d'avance, à leur
 * date anniversaire —, qui paie, ce qui est déjà facturé, le prorata, le
 * timbre. Ce travailleur ne décide que QUAND il passe :
 *
 *   - la tour a coupé les deux périmètres : rien, pas même le jour lu ;
 *   - sinon, le jour de la PLATEFORME (le fuseau de l'émetteur, lu en base —
 *     jamais une heure du serveur, R4) est passé à la base, qui ne fait le
 *     travail qu'une fois par jour et par décision de la tour.
 *
 * Un seul passage à la fois, même si deux API tournent : le verrou
 * consultatif de session (`sousVerrouDeSession`), relâché avec sa connexion
 * si le processus meurt ; la base en prend un second, de transaction.
 */
import { horsRlsAuthentificationSeule, sousVerrouDeSession, type Requete } from "../db.ts";
import { tracerUnTravail } from "../observabilite/journal.ts";

/** Toutes les heures, et une première fois trois minutes après le démarrage. */
const CADENCE_MS = 60 * 60 * 1000;
const PREMIER_TOUR_MS = 3 * 60 * 1000;

/** Ce qu'un périmètre a fait ce jour-là. */
interface BilanDuPerimetre {
  etat: "coupee" | "deja_passee" | "passee";
  emises?: number;
  deja_emises?: number;
  rien_a_facturer?: number;
  erreurs?: number;
}

/** Ce que rend `fabrique.facturation_du_jour`. */
export interface BilanDuJour {
  etat: "coupee" | "deja_passee" | "passee";
  jour: string;
  cabinets?: BilanDuPerimetre;
  pme?: BilanDuPerimetre;
}

const PERIMETRES = ["cabinets", "pme"] as const;

/** Les erreurs des deux périmètres. */
const erreursDu = (b: BilanDuJour | null) =>
  PERIMETRES.reduce((n, p) => n + (b?.[p]?.erreurs ?? 0), 0);

type Executer = <T>(travail: (db: Requete) => Promise<T>) => Promise<T>;

/**
 * Un tour, dans UNE transaction de l'exécuteur : `null` si les deux
 * périmètres sont coupés, sinon le bilan du jour. Les épreuves l'appellent avec leur propre
 * transaction, sous le rôle de l'API.
 */
export async function tourDeFacturation(executer: Executer): Promise<BilanDuJour | null> {
  return executer(async (db) => {
    const { rows: ouverte } = await db.query<{ ouverte: boolean }>(
      `select plateforme.facturation_auto_ouverte('cabinets')
              or plateforme.facturation_auto_ouverte('pme') as ouverte`,
    );
    if (!ouverte[0]?.ouverte) return null;
    const { rows: jour } = await db.query<{ jour: string }>(
      "select (now() at time zone plateforme.fuseau_de_la_plateforme())::date::text as jour",
    );
    const { rows } = await db.query<{ r: BilanDuJour }>(
      "select fabrique.facturation_du_jour($1::date) as r",
      [jour[0]!.jour],
    );
    return rows[0]!.r;
  });
}

/** Lancé par `server.ts` : jamais par les épreuves, qui appellent `tourDeFacturation`. */
export function demarrerLaFacturation() {
  const tic = async () => {
    try {
      const cle = await horsRlsAuthentificationSeule(async (db) => {
        const { rows } = await db.query<{ cle: string }>(
          "select fabrique.facturation_du_jour_verrou()::text as cle",
        );
        return rows[0]!.cle;
      });
      const bilan = await tracerUnTravail(
        "facturation_du_jour",
        null,
        () => sousVerrouDeSession(cle, () => tourDeFacturation(horsRlsAuthentificationSeule)),
        {
          juger: (b) => ({
            issue: erreursDu(b) > 0 ? "erreur" : "ok",
            // Sans bilan : l'émission est coupée, ou une autre API tient le verrou.
            resultat: b ? b.etat : "sans_passage",
          }),
        },
      );
      for (const p of PERIMETRES) {
        const b = bilan?.[p];
        if (b?.etat !== "passee") continue;
        console.log(
          `[facturation] ${bilan!.jour} ${p} — ${b.emises} émise(s), ${b.deja_emises} déjà ` +
            `émise(s), ${b.rien_a_facturer} sans rien à facturer, ${b.erreurs} erreur(s)`,
        );
      }
    } catch (e) {
      console.error("[facturation] passage interrompu :", e instanceof Error ? e.message : e);
    }
  };
  setTimeout(() => void tic(), PREMIER_TOUR_MS).unref();
  setInterval(() => void tic(), CADENCE_MS).unref();
}
