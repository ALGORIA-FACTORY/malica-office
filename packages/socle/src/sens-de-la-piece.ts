/**
 * Le sens d'une pièce — déterminé par les matricules, avant tout modèle.
 *
 * ================================================================= POURQUOI
 *
 * Le 5 octobre 2026, en mesurant les modèles de désignation, l'un d'eux a rendu
 * « facture_vente » sur une facture d'achat, avec les deux matricules inversés.
 * Tout était faux et COHÉRENT dans son inversion : le contrôle `destinataire`,
 * qui ne regarde qu'une partie, concluait « conforme ». La pièce serait partie
 * en vente dans les comptes du client.
 *
 * Aucune arithmétique ne rattrape cela — le sens n'est pas un montant. Et un
 * contrôle en aval ne fait que signaler : il ne rend pas le sens juste.
 *
 * ======================================================== LE RENVERSEMENT
 *
 * Le dossier CONNAÎT son propre matricule. Le sens d'une pièce n'a donc pas à
 * être deviné : il se déduit de la position de ce matricule sur le document.
 *
 *   matricule du dossier côté CLIENT    → facture d'achat
 *   matricule du dossier côté ÉMETTEUR  → facture de vente
 *
 * C'est une comparaison, pas un jugement. Elle ne coûte rien, elle ne varie pas
 * d'un appel à l'autre, et elle ne peut pas se tromper sur ce qu'elle voit.
 *
 * Le modèle ne décide que là où la comparaison est impossible : quand AUCUN
 * matricule n'a été lu sur la pièce. Partout ailleurs, il est confronté — et
 * s'il contredit la comparaison, c'est la comparaison qui gagne, avec un
 * signalement.
 *
 * ==================================================== JAMAIS DE CHOIX SILENCIEUX
 *
 * Trois situations ne se tranchent pas toutes seules, et aucune ne doit se
 * résoudre par un défaut :
 *
 *   — le matricule du dossier est des DEUX côtés : la lecture se contredit ;
 *   — il n'est d'AUCUN des deux, alors que les deux ont été lus : la pièce
 *     concerne quelqu'un d'autre ;
 *   — un matricule a été lu mais reste INCOMPLET : on ne compare pas sur sept
 *     chiffres sans la lettre de contrôle, ce serait confondre deux entreprises.
 *
 * Chacune rend `sens: null` et un signalement. L'écran pose alors une question
 * en un geste, avec la zone de la pièce sous les yeux.
 */
import { normaliserMatricule } from "./matricule.ts";

export type SensDeLaPiece = "facture_achat" | "facture_vente";

export type OrigineDuSens =
  /** Le matricule du dossier est du côté client : achat. */
  | "matricule_client"
  /** Il est du côté émetteur : vente. */
  | "matricule_emetteur"
  /** Aucun matricule lisible sur la pièce : le modèle a tranché, faute de mieux. */
  | "modele"
  /** Rien ne tranche sans risque : la personne doit répondre. */
  | "a_confirmer";

export interface LectureDuSens {
  sens: SensDeLaPiece | null;
  origine: OrigineDuSens;
  /**
   * Ce qu'il faut dire quand on ne tranche pas, ou quand le modèle a été
   * contredit. `null` quand la lecture est franche.
   */
  signalement: string | null;
}

export function lireLeSens(e: {
  /** Le matricule de la fiche du dossier, tel qu'enregistré. */
  matriculeDossier: string | null | undefined;
  /** Le matricule lu du côté émetteur de la pièce. */
  matriculeEmetteur: string | null | undefined;
  /** Le matricule lu du côté client de la pièce. */
  matriculeClient: string | null | undefined;
  /** Ce que le modèle a proposé. Confronté, jamais suivi d'office. */
  sensDuModele: SensDeLaPiece | null | undefined;
}): LectureDuSens {
  const dossier = normaliserMatricule(e.matriculeDossier);
  const emetteur = normaliserMatricule(e.matriculeEmetteur);
  const client = normaliserMatricule(e.matriculeClient);
  const duModele = e.sensDuModele ?? null;

  /** Le modèle décide, et on dit pourquoi on l'a laissé décider. */
  const auModele = (pourquoi: string): LectureDuSens => ({
    sens: duModele,
    origine: "modele",
    signalement: duModele === null ? pourquoi : null,
  });

  const aConfirmer = (pourquoi: string): LectureDuSens => ({
    sens: null,
    origine: "a_confirmer",
    signalement: pourquoi,
  });

  // Sans matricule au dossier, il n'y a rien à comparer. C'est permis — une
  // entreprise en cours d'immatriculation s'inscrit sans (R10) — mais le sens
  // repose alors entièrement sur le modèle, et cela doit se savoir.
  if (dossier.cle === null) {
    return {
      sens: duModele,
      origine: "modele",
      signalement:
        "Le dossier n'a pas de matricule fiscal enregistré : le sens de la pièce n'a pas pu être vérifié.",
    };
  }

  // Un matricule lu mais incomplet ne se compare pas : sept chiffres sans la
  // lettre de contrôle désignent plusieurs entreprises possibles.
  const incomplets = [
    emetteur.forme === "partielle" ? "l'émetteur" : null,
    client.forme === "partielle" ? "le client" : null,
  ].filter((x): x is string => x !== null);
  if (incomplets.length > 0) {
    return aConfirmer(
      `Le matricule de ${incomplets.join(" et ")} est incomplet : la lettre de contrôle manque. Le sens de la pièce est à confirmer.`,
    );
  }

  const cotEmetteur = emetteur.cle !== null && emetteur.cle === dossier.cle;
  const cotClient = client.cle !== null && client.cle === dossier.cle;

  if (cotEmetteur && cotClient) {
    return aConfirmer(
      "Le matricule du dossier est lu des deux côtés de la pièce : le sens est à confirmer.",
    );
  }

  if (cotClient || cotEmetteur) {
    const sens: SensDeLaPiece = cotClient ? "facture_achat" : "facture_vente";
    const origine: OrigineDuSens = cotClient ? "matricule_client" : "matricule_emetteur";
    // Le modèle est confronté, pas suivi. Quand il diverge, la comparaison
    // gagne — et la divergence se dit, parce qu'elle annonce souvent une
    // inversion de tous les champs.
    return {
      sens,
      origine,
      signalement:
        duModele !== null && duModele !== sens
          ? `Le modèle a lu « ${duModele} », le matricule du dossier dit « ${sens} » : c'est le matricule qui tranche, et le reste de la lecture est à relire.`
          : null,
    };
  }

  // Aucun matricule n'a été lu du tout : le modèle est le seul recours.
  if (emetteur.cle === null && client.cle === null) {
    return auModele(
      "Aucun matricule n'a été lu sur la pièce, et le modèle n'a pas tranché le sens : à confirmer.",
    );
  }

  // Des matricules ont été lus, et aucun n'est celui du dossier.
  return aConfirmer(
    "Aucun des matricules lus n'est celui du dossier : la pièce concerne peut-être une autre entreprise.",
  );
}
