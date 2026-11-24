/**
 * Le travailleur des relances — ce qui fait partir ce que la base a décidé.
 *
 * Un tour : l'ordonnanceur de la base pose les relances dues
 * (`notif.relancer_les_impayes`, une par facture et par palier, quatre
 * verrous), puis le travailleur RÉSERVE des courriels (`notif.reserver_courriels`),
 * les envoie par Brevo, et inscrit chaque résultat (`notif.remettre`). Il ne
 * décide de rien : ni qui, ni quand, ni quoi dire.
 *
 * Trois temps, trois transactions : la réservation pose une échéance et rend
 * les lignes ; l'envoi se fait HORS de toute transaction, donc aucun verrou ne
 * tient pendant un appel Brevo lent ; l'inscription relâche la réservation par
 * son résultat. Une réservation sans résultat à son échéance repart au tour
 * suivant.
 *
 * Rien ne part sans la clé Brevo du serveur : sans elle, rien n'est réservé, et
 * on le dit au journal.
 *
 * Le travailleur se connecte avec le rôle de l'API, sans endosser personne.
 */
import { configurationCourriel, envoyerParBrevo, type Expedition } from "../courriel/brevo.ts";
import type { Requete } from "../db.ts";
import { consigner } from "../observabilite/journal.ts";

import {
  courrielDeNotification,
  routeDuBouton,
  type LigneDeCarte,
  type Palier,
} from "./courriel-de-notification.ts";

interface CourrielARemettre {
  envoi_id: string;
  email: string;
  locale: string;
  titre: string;
  corps: string;
  action_libelle: string | null;
  action_route: string | null;
  ton: string;
  code: string;
  organisation: string | null;
  donnees: Record<string, unknown> | null;
  frise: Palier[] | null;
  sujet: string | null;
  libelles: Record<string, string>;
  carte: LigneDeCarte[] | null;
}

/** Combien de courriels un tour remet au plus : un incident ne vide pas la file d'un coup. */
const PAR_TOUR = 50;
/** Combien de courriels une réservation pose d'un coup. */
const PAR_RESERVATION = 10;
/** Au-delà, une réservation sans résultat repart au tour suivant. */
const DUREE_RESERVATION = "10 minutes";

export interface Dependances {
  executer: <T>(travail: (db: Requete) => Promise<T>) => Promise<T>;
  env: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  /** Le transport : par défaut, l'appel Brevo réel. Une épreuve peut le surveiller. */
  envoyer?: (e: Expedition) => Promise<unknown>;
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

  const envoyer = d.envoyer ?? ((e: Expedition) => envoyerParBrevo(e, d.fetchImpl));
  let remis = 0;
  let echecs = 0;
  while (remis + echecs < PAR_TOUR) {
    const reserve = Math.min(PAR_RESERVATION, PAR_TOUR - remis - echecs);
    // Temps 1 : la réservation, dans sa propre transaction, committée à son retour.
    const lot = await d.executer(async (db) => {
      const { rows } = await db.query<CourrielARemettre>(
        "select * from notif.reserver_courriels($1, $2::interval)",
        [reserve, DUREE_RESERVATION],
      );
      return rows;
    });
    if (lot.length === 0) break;

    for (const c of lot) {
      // Temps 2 : l'envoi, HORS transaction. Le rendu et l'appel relèvent du même
      // échec : une ligne qu'on ne sait pas rendre s'inscrit « échoué ».
      let erreur: string | null = null;
      try {
        const message = courrielDeNotification({
          locale: c.locale,
          code: c.code,
          organisation: c.organisation,
          urlPublique: config.urlPublique,
          donnees: c.donnees,
          frise: c.frise,
          libelles: c.libelles,
          carte: c.carte,
          sujet: c.sujet,
          // Répondre à une adresse qui ne lit pas ne sert à rien : pas de lien alors.
          repondreA: /^no-?reply@/i.test(config.expediteur.email) ? null : config.expediteur.email,
          titre: c.titre,
          corps: c.corps,
          action: (() => {
            const route = c.action_route ? routeDuBouton(c.action_route, c.donnees) : null;
            return c.action_libelle && route
              ? { libelle: c.action_libelle, url: `${config.urlPublique}${route}` }
              : null;
          })(),
          ton: c.ton,
        });
        await envoyer({
          cle: config.cle,
          expediteur: config.expediteur,
          destinataire: c.email,
          ...message,
        });
      } catch (e) {
        erreur = e instanceof Error ? e.message.slice(0, 500) : "échec";
      }
      // Temps 3 : l'inscription du résultat, dans sa propre transaction.
      await d.executer(async (db) => {
        await db.query("select notif.remettre($1, $2, $3)", [
          c.envoi_id,
          erreur === null ? "remis" : "echoue",
          erreur,
        ]);
      });
      // L'étape `envoi`, sous la trace du tour : ni l'adresse, ni le message.
      consigner("envoi", erreur === null ? "ok" : "erreur", {
        cle: c.envoi_id,
        detail: { canal: "courriel", resultat: erreur === null ? "remis" : "echoue" },
      });
      if (erreur === null) remis += 1;
      else echecs += 1;
    }
  }
  return { decision, remis, echecs, sansCle: false };
}
