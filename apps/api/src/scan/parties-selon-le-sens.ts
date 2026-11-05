/**
 * Les parties d'une pièce selon le sens que la personne a CONFIRMÉ — sans relire l'image.
 *
 * ================================================================== POURQUOI
 *
 * Le dirigeant, 5 novembre 2026 : « l'utilisateur identifie le sens (achat ou vente) et peut
 * le corriger après la lecture, ce qui impacte la proposition de l'écriture ; le comptable
 * peut lui aussi l'éditer ». Corriger le sens ne relit pas la pièce (décision du 23 octobre)
 * : le jugement lisait alors les cases émetteur / client de la lecture, placées au moment de
 * la lecture — avant la correction. Décision du 5 novembre (option A) : la lecture se REJOUE
 * sur ses jetons gardés, avec le sens confirmé ; aucun OCR, aucun modèle.
 *
 * ================================================================== CE QUI SE FAIT
 *
 * Le moteur reçoit le matricule du dossier (sa fiche), ses tiers connus et le sens confirmé.
 * Le matricule de celui qui scanne place le dossier — client d'un achat, émetteur d'une
 * vente — et l'autre matricule est le tiers. Le jugement prend :
 *
 *   — pour le dossier, son matricule, prouvé par la fiche ;
 *   — pour le tiers, le matricule que le moteur PROUVE ; à défaut, ce que la lecture avait
 *     lu, s'il n'est pas le matricule du dossier.
 *
 * Quand la pièce contredit la déclaration (des indices unanimes), ou que le moteur ne place
 * rien, les cases de la lecture restent telles quelles : le contrôle du destinataire dit
 * alors ce qui ne va pas. La lecture inscrite ne change pas (R7) : seul le jugement lit
 * autrement.
 */
import { memeMatricule, type FormatDuMatricule } from "@malica/socle/matricule";
import type { PageToken } from "@malica/socle/ports/malica";
import { resoudre } from "@malica/sudoku";

import type { Requete } from "../db.ts";
import { sensConfirme } from "../depots/sens.ts";
import {
  GRILLE_DE_LA_LECTURE_CITEE,
  jetonsDuSudoku,
  lireLeContexteDuSudoku,
  resoudreLaPiece,
} from "../malica/lecture/sudoku.ts";
import type { DeviseLue } from "@malica/socle/montant-imprime";

/** Les deux cases de la lecture : le matricule de l'émetteur et celui du client. */
export interface MatriculesDesParties {
  readonly emetteur: string | null;
  readonly client: string | null;
}

/**
 * Les matricules des parties que le jugement retient, ou `null` quand le sens n'est pas
 * confirmé, ou que le moteur ne place pas les parties : la lecture fait alors foi.
 */
export async function partiesSelonLeSens(
  db: Requete,
  p: {
    readonly tenantId: string;
    readonly packId: string;
    readonly jour: string;
    readonly documentKind: string | null;
    readonly documentKindStatut: string;
    readonly plan: readonly PageToken[];
    readonly lues: MatriculesDesParties;
    readonly dossier: { readonly matricule: string | null; readonly raisonSociale: string };
    readonly devise: DeviseLue | undefined;
    readonly formatDuMatricule: FormatDuMatricule;
  },
): Promise<MatriculesDesParties | null> {
  const sens = sensConfirme(p.documentKind, p.documentKindStatut);
  if (!sens || !p.dossier.matricule || !p.devise || p.plan.length === 0) return null;
  const [contexte, { rows: tiers }] = await Promise.all([
    lireLeContexteDuSudoku(db, p.packId, GRILLE_DE_LA_LECTURE_CITEE, p.devise.code, p.jour),
    db.query<{ code: string; raison_sociale: string; identifiant_fiscal: string | null }>(
      `select code, raison_sociale, identifiant_fiscal
         from tiers_v where tenant_id = $1 and actif order by nature, code`,
      [p.tenantId],
    ),
  ]);
  const sortie = resoudreLaPiece(jetonsDuSudoku(p.plan, p.devise, contexte), contexte, resoudre, {
    dossier: { matricule: p.dossier.matricule, raison_sociale: p.dossier.raisonSociale },
    tiers: tiers.flatMap((t) =>
      t.identifiant_fiscal
        ? [{ code: t.code, matricule: t.identifiant_fiscal, raison_sociale: t.raison_sociale }]
        : [],
    ),
    formes_juridiques: contexte.formesJuridiques,
    sens,
  });
  const parties = sortie.parties;
  if (parties?.statut !== "prouve") return null;
  const prouve = (v: { valeur: string; statut: string } | null) =>
    v && v.statut === "prouve" ? v.valeur : null;
  const duDossier = (v: string | null) =>
    v !== null && memeMatricule(v, p.dossier.matricule, p.formatDuMatricule);
  // Ce que la lecture avait lu pour le tiers, dans l'une ou l'autre case, sauf le dossier.
  const luDuTiers = [p.lues.emetteur, p.lues.client].find((v) => v && !duDossier(v)) ?? null;
  const dossier = sens === "achat" ? parties.client.matricule : parties.emetteur.matricule;
  const tiersLu = sens === "achat" ? parties.emetteur.matricule : parties.client.matricule;
  const leDossier = prouve(dossier) ?? p.dossier.matricule;
  const leTiers = prouve(tiersLu) ?? luDuTiers;
  return sens === "achat"
    ? { emetteur: leTiers, client: leDossier }
    : { emetteur: leDossier, client: leTiers };
}
