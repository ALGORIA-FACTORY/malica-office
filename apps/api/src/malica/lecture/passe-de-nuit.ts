/**
 * La passe de nuit — les relectures, la nuit, sous le relecteur de nuit.
 *
 * ================================================================ POURQUOI
 *
 * La relecture d'une pièce imparfaite (un autre lecteur, ~15 s de modèle de
 * vision) ne part plus en journée (décision du 2 novembre 2026). Elle part la
 * nuit, à l'heure locale du DOSSIER, sous un compte de service que la base
 * borne à la relecture (`20261118100000_le_relecteur_de_nuit`). ALGORIA paie :
 * rien ne se décompte du forfait du client.
 *
 * ========================================================== CE QUI DÉCIDE
 *
 * La base, toujours (R3) : qui est à relire, dans quelle fenêtre, sous quel
 * plafond (`fabrique.dossiers_a_relire`, `app.dans_la_fenetre_de_nuit`,
 * `fabrique.relecture_nuit_budget`), et ce qu'une relecture a le droit de
 * toucher. Ce module enchaîne, et redemande avant CHAQUE relecture, parce
 * qu'une passe dure : la fenêtre se ferme, le plafond se remplit, un client
 * dépose une pièce.
 *
 * Avant chaque relecture, dans cet ordre :
 *   1. une lecture fraîche attend → la passe CÈDE (le client passe d'abord) ;
 *   2. le dossier est sorti de sa fenêtre → on ne le relit pas ;
 *   3. la tour a coupé la passe, ou le plafond est atteint → on ne PREND pas
 *      le travail : aucune tentative consommée ; la coupure (« coupe ») et le
 *      plafond de la plateforme ferment le passage ;
 *   4. sinon, une relecture, avec le code existant (`relirePiece`).
 *
 * Une relecture par dossier et par tour, une seule à la fois : un dossier
 * chargé ne prive pas les autres de leur nuit.
 *
 * Révoquer le RELECTEUR pendant une relecture (raisonné, non éprouvé) : ses
 * appels suivants ne voient plus rien, l'issue ne s'inscrit plus sous lui, et
 * le passage reste « interrompu » ; le travail pris redevient prenable à son
 * âge d'abandon, une tentative consommée. L'interrupteur, lui, arrête avant la
 * relecture suivante sans rien consommer : c'est le geste à préférer.
 *
 * ============================================================ SANS HORLOGE
 *
 * `tourDeNuit` reçoit ses exécuteurs et son horloge : les épreuves la
 * conduisent à 03:00 à Tunis sans attendre la nuit. `demarrer-la-nuit.ts`
 * branche la vraie base et la vraie heure.
 */
import type { Requete } from "../../db.ts";
import { executerUnTravail, type AvecBase } from "../../fabrique/travaux-execution.ts";
import {
  creerAppelLocal,
  PieceIntrouvable,
  type AppelApi,
  type MethodesPermises,
} from "../appel-local.ts";

import { relirePiece } from "./read-flow.ts";

/**
 * Ce que le relecteur peut joindre de l'API, et rien d'autre : le chemin de
 * la relecture. Ni `persisterLecture`, ni `consommerLecture` — une relecture
 * n'est pas une première lecture, et elle ne se décompte pas. La base le
 * refuserait de toute façon ; l'API ne le tente pas.
 */
const METHODES_DU_RELECTEUR: MethodesPermises = {
  capture: new Set([
    "relectureAFaire",
    "contexteLecture",
    "contexteSudoku",
    "inscrireChampsLus",
    "journaliserAgent",
    "persisterRelecture",
    "analyser",
  ]),
  fabrique: new Set(["contexteDeDesignation", "inscrireExecution"]),
};

/** Pourquoi un passage s'arrête — les faits de fin de `fabrique.passage_faits`. */
type RaisonDArret = "cede" | "coupe" | "fenetre_close" | "plafond" | "termine";

export interface DependancesDeLaNuit {
  /** Hors RLS, sous le rôle de connexion de l'API : l'ordonnanceur seul. */
  executer: AvecBase;
  /** Sous le relecteur de nuit, pour UN dossier (`sousLeRelecteurDeNuit`). */
  avecService: (tenantId: string) => AvecBase;
  /** L'heure : la vraie en service, une heure choisie dans les épreuves. */
  maintenant: () => Date;
  /** Les organes payants ; ceux de la chaîne de lecture par défaut. */
  lecteurs?: Parameters<typeof relirePiece>[2];
  /**
   * Une lecture fraîche attend-elle ? La base par défaut
   * (`fabrique.lectures_en_attente`, toutes API confondues) ; une épreuve
   * peut la fixer, la base d'essai étant partagée avec d'autres épreuves.
   */
  lectureFraiche?: (a: Date) => Promise<boolean>;
}

export interface BilanDeNuit {
  /** Le passage ouvert, ou `null` : la passe est coupée, ou le relecteur révoqué. */
  passage: string | null;
  raison: RaisonDArret | null;
  retenues: number;
  ecartees: number;
  abstentions: number;
  pannes: number;
  /** Les dossiers qu'on n'a pas relus, par motif (hors fenêtre, sans fuseau, plafond…). */
  ecarts: Record<string, number>;
}

interface DossierARelire {
  tenant_id: string;
  en_attente: number;
  ecart: string | null;
}

/**
 * Combien de tours un passage accepte d'enchaîner. Ce n'est pas un seuil
 * métier — les plafonds de la tour bornent la dépense — mais une borne de
 * boucle : elle garantit qu'un passage se termine, comme `coureur.ts`.
 */
const TOURS_MAX = 500;

async function une<T>(executer: AvecBase, sql: string, params: unknown[]): Promise<T> {
  return executer(async (db: Requete) => {
    const { rows } = await db.query<{ r: T }>(sql, params);
    return rows[0]!.r;
  });
}

/**
 * L'API du relecteur, pour une relecture : le même code que celle d'une
 * personne, ses seules méthodes, et les octets de la seule pièce qu'il relit
 * — la base lui ouvre le dossier en lecture, pas ses photos.
 */
function appelDuRelecteur(d: DependancesDeLaNuit, tenantId: string, pieceId: string): AppelApi {
  const api = creerAppelLocal(d.avecService(tenantId), METHODES_DU_RELECTEUR);
  return {
    rpc: api.rpc,
    contenu: (id) =>
      id === pieceId ? api.contenu(id) : Promise.reject(new PieceIntrouvable(`pièce : ${id}`)),
  };
}

/**
 * Pourquoi plus rien n'est à relire maintenant : le plafond de la plateforme,
 * la fenêtre d'un dossier qui s'est fermée pendant le passage, ou rien de
 * plus à faire dans une fenêtre ouverte. Un dossier d'un autre fuseau, hors
 * de sa nuit, n'arrête rien : il a la sienne.
 */
function raisonDuRepos(dossiers: DossierARelire[], fenetreFermee: boolean): RaisonDArret {
  if (dossiers.some((x) => x.ecart === "passe.coupee")) return "coupe";
  if (dossiers.some((x) => x.ecart === "plafond.plateforme")) return "plafond";
  return fenetreFermee ? "fenetre_close" : "termine";
}

/**
 * Un passage de la passe de nuit. Rend son bilan ; le même bilan est inscrit
 * en base avec la raison d'arrêt. Une erreur qui remonte laisse le passage
 * SANS fait de fin : la tour le dit « interrompu », et c'est la vérité.
 */
export async function tourDeNuit(d: DependancesDeLaNuit): Promise<BilanDeNuit> {
  const bilan: BilanDeNuit = {
    passage: null,
    raison: null,
    retenues: 0,
    ecartees: 0,
    abstentions: 0,
    pannes: 0,
    ecarts: {},
  };
  const passage = await une<string | null>(
    d.executer,
    "select fabrique.passe_de_nuit_ouvrir($1) as r",
    [d.maintenant()],
  );
  if (!passage) return bilan;
  bilan.passage = passage;
  const lectureFraiche =
    d.lectureFraiche ??
    ((a: Date) => une<boolean>(d.executer, "select fabrique.lectures_en_attente($1) as r", [a]));
  const ecarter = (motif: string) => {
    bilan.ecarts[motif] = (bilan.ecarts[motif] ?? 0) + 1;
  };

  let raison: RaisonDArret = "termine";
  passe: for (let tour = 0; tour < TOURS_MAX; tour += 1) {
    const dossiers = await d.executer(async (db) => {
      const { rows } = await db.query<DossierARelire>(
        "select tenant_id, en_attente, ecart from fabrique.dossiers_a_relire($1, $2)",
        [passage, d.maintenant()],
      );
      return rows;
    });
    if (tour === 0) for (const x of dossiers) if (x.ecart) ecarter(x.ecart);

    let relu = false;
    let fenetreFermee = false;
    for (const dossier of dossiers.filter((x) => x.ecart === null)) {
      const a = d.maintenant();
      // 1. Le client passe d'abord.
      if (await lectureFraiche(a)) {
        raison = "cede";
        break passe;
      }
      // 2. La fenêtre du dossier a pu se fermer depuis la liste.
      const dans = await une<boolean>(
        d.executer,
        "select app.dans_la_fenetre_de_nuit($1, $2) as r",
        [dossier.tenant_id, a],
      );
      if (!dans) {
        fenetreFermee = true;
        continue;
      }
      // 3. La passe coupée par la tour, ou le plafond atteint : le travail n'est
      //    pas pris, aucune tentative consommée. La base relit l'interrupteur
      //    avant CHAQUE relecture : couper arrête un passage en cours.
      const plafond = await une<string | null>(
        d.executer,
        "select fabrique.relecture_nuit_budget($1, $2) as r",
        [dossier.tenant_id, a],
      );
      if (plafond === "passe.coupee") {
        raison = "coupe";
        break passe;
      }
      if (plafond === "plafond.plateforme") {
        raison = "plafond";
        break passe;
      }
      if (plafond) {
        if (tour > 0) ecarter(plafond);
        continue;
      }
      // 4. Une relecture, sous le relecteur, par le code qui existe.
      const fait = await executerUnTravail(
        d.avecService(dossier.tenant_id),
        dossier.tenant_id,
        ["relecture_piece"],
        (t) => relirePiece(appelDuRelecteur(d, dossier.tenant_id, t.pieceId), t, d.lecteurs),
      );
      if (!fait) continue;
      relu = true;
      if (fait.issue !== "termine") {
        bilan.pannes += 1;
        // Le motif technique reste en base et ici, jamais chez le client.
        console.error(
          `[nuit] ${fait.issue} — travail ${fait.travailId}, tentative ` +
            `${String(fait.tentative)} : ${fait.motif ?? "(sans motif)"}`,
        );
      } else if (fait.motif === "relecture.retenue") bilan.retenues += 1;
      else if (fait.motif === "relecture.ecartee") bilan.ecartees += 1;
      else bilan.abstentions += 1;
    }
    if (!relu) {
      raison = raisonDuRepos(dossiers, fenetreFermee);
      break;
    }
  }

  bilan.raison = raison;
  const compteurs = {
    retenues: bilan.retenues,
    ecartees: bilan.ecartees,
    abstentions: bilan.abstentions,
    pannes: bilan.pannes,
    ecarts: bilan.ecarts,
  };
  await d.executer((db) =>
    db.query("select fabrique.passe_de_nuit_fermer($1, $2, $3::jsonb, $4)", [
      passage,
      raison,
      JSON.stringify(compteurs),
      d.maintenant(),
    ]),
  );
  return bilan;
}
