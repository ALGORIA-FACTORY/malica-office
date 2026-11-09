/**
 * Ce que le transport apprend et que l'écran doit savoir : la session est
 * finie, ou la coque doit se mettre à jour.
 *
 * Le transport ne connaît ni le routeur ni React. Il pose ici deux faits, et
 * la racine de l'application s'y abonne — par `useSyncExternalStore`, sans
 * contexte à traverser. Un émetteur de dix lignes ; une bibliothèque de plus
 * serait une dette pour deux booléens.
 */
import { useSyncExternalStore } from "react";

export interface EtatTransport {
  /** La coque est trop ancienne. La version minimale, si l'API l'a dite. */
  miseAJourRequise: { versionMinimale: string | null } | null;
}

let etat: EtatTransport = { miseAJourRequise: null };
const abonnes = new Set<() => void>();

function publier(suivant: EtatTransport): void {
  etat = suivant;
  for (const abonne of abonnes) abonne();
}

export function signalerMiseAJourRequise(versionMinimale: string | null): void {
  if (etat.miseAJourRequise) return;
  publier({ ...etat, miseAJourRequise: { versionMinimale } });
}

function lireEtatTransport(): EtatTransport {
  return etat;
}

function sAbonner(abonne: () => void): () => void {
  abonnes.add(abonne);
  return () => {
    abonnes.delete(abonne);
  };
}

export function useEtatTransport(): EtatTransport {
  return useSyncExternalStore(sAbonner, lireEtatTransport, lireEtatTransport);
}

/*
 * La déconnexion n'est pas un état : c'est un geste. La racine l'exécute —
 * vider les requêtes, aller à l'écran de connexion — et l'adaptateur
 * d'authentification y oublie le compte qu'il gardait en mémoire (8 novembre
 * 2026) : plusieurs auditeurs, chacun retiré par sa propre fonction.
 */
const surDeconnexion = new Set<() => void>();

export function ecouterLaDeconnexion(auditeur: () => void): () => void {
  surDeconnexion.add(auditeur);
  return () => {
    surDeconnexion.delete(auditeur);
  };
}

export function signalerLaDeconnexion(): void {
  for (const auditeur of [...surDeconnexion]) auditeur();
}
