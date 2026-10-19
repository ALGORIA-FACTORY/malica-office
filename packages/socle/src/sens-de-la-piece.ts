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

  /*
   * ============ DEUX SITUATIONS QUI N'ONT RIEN À VOIR, ET QUI DISAIENT PAREIL
   *
   * Relevé le 7 octobre 2026 sur la facture SUARL CASA-ELECT. Elle imprime le
   * matricule du FOURNISSEUR et pas celui du client — ce qui est le cas le plus
   * courant d'une facture d'achat tunisienne, et non une anomalie.
   *
   * Le message unique disait « la pièce concerne peut-être une autre
   * entreprise ». Alarmant, et faux : il n'y a rien d'anormal à ce qu'un
   * fournisseur n'imprime pas le matricule de son client.
   *
   * Les deux cas se traitent donc à part :
   *
   *   un seul côté lu, et ce n'est pas le dossier  → le cas normal d'un achat,
   *                                                  dont il manque la confirmation
   *   les DEUX côtés lus, et aucun n'est le dossier → là, oui, c'est douteux
   *
   * Dans les deux cas on ne tranche pas — le dirigeant déclare. Mais on ne lui
   * fait pas craindre une erreur quand il n'y en a pas : un avertissement qui
   * se révèle infondé une fois sur deux cesse d'être lu.
   */
  if (client.cle === null) {
    return aConfirmer(
      "Le matricule du client n'est pas imprimé sur la pièce — c'est courant sur une facture d'achat. Indiquez s'il s'agit d'un achat ou d'une vente.",
    );
  }
  if (emetteur.cle === null) {
    return aConfirmer(
      "Le matricule de l'émetteur n'est pas imprimé sur la pièce. Indiquez s'il s'agit d'un achat ou d'une vente.",
    );
  }
  return aConfirmer(
    "Les deux matricules lus sur la pièce sont étrangers au dossier : elle concerne peut-être une autre entreprise.",
  );
}

/**
 * Faut-il ENCORE demander le sens de cette pièce ?
 *
 * ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
 *
 * 13 octobre 2026 : « il y a une deuxième fois où l'app demande achat ou
 * vente ». C'était exact, et systématique sur le cas le plus courant de la
 * facture d'achat tunisienne.
 *
 * À la capture, la personne déclare « une facture que j'ai reçue ». Puis la
 * lecture ne tranche pas — le fournisseur n'imprime pas le matricule du
 * client, ce qui est normal sur un achat — et l'écran, qui ne regardait que
 * la lecture, reposait la question. La réponse était en base, sur la pièce, à
 * deux champs de distance.
 *
 * ======================================================== POURQUOI DANS LE SOCLE
 *
 * Parce que trois lecteurs du sens coexistent — la lecture, la précision, le
 * type déclaré sur la pièce — et que chacun en jugeait dans son coin. Deux
 * questions valaient mieux que deux réponses divergentes, mais la bonne issue
 * est une seule décision, écrite une fois, éprouvée une fois, appelée par qui
 * en a besoin.
 */
export function leSensResteADemander(e: {
  /** Ce que la lecture a tranché, ou `null` si elle n'a pas su. */
  sensLu: string | null | undefined;
  /** Ce que la personne a déclaré à la capture, ou corrigé depuis. */
  typeDeclare: string | null | undefined;
}): boolean {
  const estUnSens = (v: string | null | undefined): v is SensDeLaPiece =>
    v === "facture_achat" || v === "facture_vente";
  // Un type déclaré qui n'est ni l'un ni l'autre — un relevé bancaire, un
  // ticket — ne répond pas à la question : il dit seulement que ce n'est pas
  // une facture, et l'écran qui demande le sens ne s'affiche pas sur ces
  // pièces-là de toute façon.
  return !estUnSens(e.sensLu) && !estUnSens(e.typeDeclare);
}

/* ======================= LE VOCABULAIRE QUI TRANCHE LE SENS ============= */

/**
 * Un nom de référence emprunte-t-il au vocabulaire qui tranche le sens ?
 *
 * ================================================================= POURQUOI
 *
 * `lireLeSens` ci-dessus reçoit deux matricules. Ils arrivent de la réponse
 * d'un modèle, sous deux noms que l'invite IMPOSE et ne VÉRIFIE pas. Un
 * modèle qui rend « mf » au lieu de « matricule_fiscal » désigne le bon
 * jeton, la lecture est juste, la citation pointe le bon endroit — et
 * `lireLeSens` reçoit `null` des deux côtés. La pièce sort « sens à
 * confirmer » sans que rien n'explique pourquoi.
 *
 * C'est la sixième fois dans ce dépôt qu'un nom composé librement casse un
 * appariement muet. Le symptôme est toujours le même : ça marche, et une
 * mesure disparaît.
 *
 * =================================================== LA RÈGLE, ET SA FORME
 *
 * Elle est SYMÉTRIQUE, et c'est ce qui la rend sûre : on refuse si l'ensemble
 * des mots du nom est INCLUS dans celui d'un nom réservé (« matricule »,
 * « fiscal », « matricule_client »), ou s'il l'INCLUT
 * (« matricule_fiscal_du_client »). Un sigle compte pour les mots qu'il
 * abrège, donc « mf » et « mf_client » tombent aussi.
 *
 * Les mots et les sigles sont DÉRIVÉS des noms réservés eux-mêmes. Il n'y a
 * aucune liste d'alias écrite à la main : une liste d'alias est un jugement,
 * et quatre des cinq appariements muets de ce dépôt viennent d'un jugement de
 * ce genre.
 *
 * Elle refuse large, et c'est voulu. Un faux refus coûte un drapeau, que
 * l'écran traite déjà. Un faux passage coûte une pièce correctement lue dont
 * le sens est perdu, et cela ne se voit nulle part. L'asymétrie décide.
 *
 * ================================================ CE QU'ELLE NE JUGE PAS
 *
 * Les noms réservés EUX-MÊMES la déclenchent — ils sont inclus dans
 * eux-mêmes. C'est à l'appelant de les écarter d'abord : ce sont les noms
 * attendus, pas des emprunts.
 *
 * @param nom      le nom de référence tel qu'il est rendu, en mots séparés
 *                 par des `_`.
 * @param reserves les noms réservés, source unique, passée par l'appelant.
 */
export function empruntAuVocabulaireReserve(nom: string, reserves: readonly string[]): boolean {
  const motsDe = (n: string): string[] => n.split("_");

  const sigles = new Map<string, ReadonlySet<string>>(
    reserves.map((n) => [
      motsDe(n)
        .map((m) => m[0])
        .join(""),
      new Set(motsDe(n)),
    ]),
  );

  const mots = new Set(
    motsDe(nom).flatMap((m) => {
      const abrege = sigles.get(m);
      return abrege ? [...abrege] : [m];
    }),
  );

  return reserves
    .map((n) => new Set(motsDe(n)))
    .some(
      (reserve) => [...mots].every((m) => reserve.has(m)) || [...reserve].every((m) => mots.has(m)),
    );
}
