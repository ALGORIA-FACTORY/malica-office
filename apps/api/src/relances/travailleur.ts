/**
 * Le travailleur des relances — ce qui fait partir ce que la base a décidé.
 *
 * Un tour : l'ordonnanceur de la base pose les relances dues
 * (`notif.relancer_les_impayes`, une par facture et par palier, quatre
 * verrous), puis le travailleur remet les courriels décidés
 * (`notif.courriels_a_remettre`) par Brevo et inscrit chaque tentative
 * (`notif.remettre`). Il ne décide de rien : ni qui, ni quand, ni quoi dire.
 *
 * Rien ne part tant que la tour n'a pas ouvert les relances (la base rend
 * `actives: false` et aucune ligne), ni sans la clé Brevo du serveur : sans
 * elle, les courriels restent « à remettre », et on le dit au journal.
 *
 * Le travailleur se connecte avec le rôle de l'API, sans endosser personne :
 * ces trois fonctions ne sont ouvertes qu'à ce rôle.
 */
import { configurationCourriel, envoyerParBrevo } from "../courriel/brevo.ts";
import type { Requete } from "../db.ts";

import { courrielDeNotification } from "./courriel-de-notification.ts";

interface CourrielARemettre {
  envoi_id: string;
  email: string;
  locale: string;
  titre: string;
  corps: string;
  action_libelle: string | null;
  action_route: string | null;
}

/** Combien de courriels un tour remet au plus : un incident ne vide pas la file d'un coup. */
const PAR_TOUR = 50;

export interface Dependances {
  executer: <T>(travail: (db: Requete) => Promise<T>) => Promise<T>;
  env: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}

export async function tourDeRelances(d: Dependances) {
  const decision = await d.executer(async (db) => {
    const { rows } = await db.query<{ r: Record<string, unknown> }>(
      "select notif.relancer_les_impayes() as r",
    );
    return rows[0]!.r;
  });

  const config = configurationCourriel(d.env);
  if (!config) return { decision, remis: 0, echecs: 0, sansCle: true };

  let remis = 0;
  let echecs = 0;
  // Un courriel par transaction : la base le verrouille en le rendant, le
  // travailleur l'envoie et inscrit la tentative avant de le relâcher. Deux
  // API qui tournent ne remettent donc jamais le même, et un incident sur
  // l'un n'efface pas ce qui est déjà inscrit pour les autres.
  for (let i = 0; i < PAR_TOUR; i += 1) {
    const traite = await d.executer(async (db) => {
      const { rows } = await db.query<CourrielARemettre>(
        "select * from notif.courriels_a_remettre(1)",
      );
      const c = rows[0];
      if (!c) return null;
      const message = courrielDeNotification({
        locale: c.locale,
        titre: c.titre,
        corps: c.corps,
        action:
          c.action_libelle && c.action_route
            ? { libelle: c.action_libelle, url: `${config.urlPublique}${c.action_route}` }
            : null,
      });
      let erreur: string | null = null;
      try {
        await envoyerParBrevo(
          { cle: config.cle, expediteur: config.expediteur, destinataire: c.email, ...message },
          d.fetchImpl,
        );
      } catch (e) {
        erreur = e instanceof Error ? e.message.slice(0, 500) : "échec";
      }
      await db.query("select notif.remettre($1, $2, $3)", [
        c.envoi_id,
        erreur === null ? "remis" : "echoue",
        erreur,
      ]);
      return erreur === null ? "remis" : "echoue";
    });
    if (traite === null) break;
    if (traite === "remis") remis += 1;
    else echecs += 1;
  }
  return { decision, remis, echecs, sansCle: false };
}
