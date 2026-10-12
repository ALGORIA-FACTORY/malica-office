/**
 * 3B-6 — La proposition d'écriture, calculée côté serveur.
 *
 * Jusqu'au 18 septembre 2026, le navigateur composait l'écriture : il relisait
 * l'extraction, appliquait les taux, posait les comptes, puis envoyait les
 * lignes à l'API, qui les enregistrait telles quelles. Désormais le serveur la
 * calcule, depuis ce qu'il a lui-même jugé :
 *
 *   • pas d'écriture pour une pièce que le verdict ne déclare pas
 *     comptabilisable — le refus porte les motifs du verdict ;
 *   • les montants sont ceux IMPRIMÉS et normalisés (analyse.ts), jamais ceux
 *     que le solveur de la lecture a posés dans l'extraction ;
 *   • décimales et seuils viennent du paramétrage daté, pas d'une table de
 *     devises ni de constantes ;
 *   • le moteur est le même : `buildProposal` du socle.
 *
 * Le navigateur des versions installées calcule encore de son côté ; les
 * nouvelles demandent `office.propositionDePiece`, puis `office.proposerDepuisPiece`
 * enregistre sans qu'aucune ligne ne transite par le client.
 */

import {
  buildProposal,
  LectureIncomplete,
  type ProposalResult,
} from "@malica/socle/use-cases/propose-ecriture";

import { autoriseUneEcriture, codeDuVerdict, type CodeVerdict } from "@malica/socle/verdicts";

import type { Requete } from "../db.ts";
import { enDecimal } from "../malica/lecture/montants.ts";
import { referentiel } from "../depots/referentiel.ts";

import { analyserPiece, lireParametres } from "./analyse.ts";
import { tvaDeBase, type ResultatNormalisation } from "./normaliser-montants.ts";

type SensConnu = { documentKind: "facture_achat" | "facture_vente" };
const sensConnu = (k: string): k is SensConnu["documentKind"] =>
  k === "facture_achat" || k === "facture_vente";

// La liste vivait ici, en phrases francaises. Elle vit au Socle, avec son
// epreuve, parce que les deux rives en ont besoin — celle qui inscrit et
// celle qui affiche. Un verdict inconnu n autorise rien.

export type PropositionDePiece =
  | {
      ok: true;
      verdict: string;
      /** Le verdict sous forme de CODE : c est la-dessus que les ecrans branchent. */
      verdictCode: CodeVerdict | null;
      packVersionId: string;
      proposition: ProposalResult;
    }
  | { ok: false; raison: string; verdict?: string; verdictCode?: CodeVerdict | null };

/*
 * `enDecimal` vivait ici en double : même signature, même sémantique, deux
 * implémentations. La première qui aurait corrigé un cas limite aurait laissé
 * l'autre en arrière — et c'est celle-ci qui écrit l'écriture comptable.
 * Elle vient désormais de la lecture, où elle est éprouvée.
 */

export async function propositionDePiece(
  db: Requete,
  pieceId: string,
  dateSaisie: string | null = null,
): Promise<PropositionDePiece> {
  // Le jugement de la DERNIÈRE lecture ; s'il manque, on juge maintenant.
  const { rows: derniers } = await db.query<{
    extraction: string;
    payload: Record<string, unknown>;
    analyse_extraction: string | null;
    verdict: string | null;
    motifs: Array<{ motif: string }> | null;
    normalisation: ResultatNormalisation | null;
    pack_version_id: string | null;
    jurisdiction: string;
  }>(
    `select e.id as extraction, e.payload,
            a.extraction_id as analyse_extraction, a.verdict, a.motifs, a.normalisation,
            a.pack_version_id, o.jurisdiction
       from capture.pieces p
       join identity.organizations o on o.id = p.tenant_id
       join lateral (select id, payload from capture.extractions x
                      where x.piece_id = p.id order by created_at desc limit 1) e on true
       left join lateral (select * from capture.analyses y
                           where y.piece_id = p.id order by created_at desc limit 1) a on true
      where p.id = $1`,
    [pieceId],
  );
  let ligne = derniers[0];
  if (!ligne) return { ok: false, raison: "Cette pièce n'a pas encore été lue." };
  if (ligne.analyse_extraction !== ligne.extraction) {
    const a = await analyserPiece(db, pieceId);
    const { rows } = await db.query<{ pack_version_id: string }>(
      `select pack_version_id from capture.analyses where id = $1`,
      [a.id],
    );
    ligne = {
      ...ligne,
      verdict: a.verdict,
      motifs: a.motifs,
      normalisation: a.normalisation,
      pack_version_id: rows[0]!.pack_version_id,
    };
  }
  const verdict = ligne.verdict!;
  const n = ligne.normalisation!;
  const pack = ligne.pack_version_id!;

  if (!autoriseUneEcriture(verdict))
    return {
      ok: false,
      verdict,
      verdictCode: codeDuVerdict(verdict),
      raison: `Aucune écriture ne se propose : la pièce est « ${verdict} ». ${(ligne.motifs ?? [])
        .map((m) => m.motif)
        .join(" ")}`,
    };
  if (n.etat !== "tranche" && n.etat !== "non_verifie")
    return {
      ok: false,
      verdict,
      verdictCode: codeDuVerdict(verdict),
      raison: `Aucune écriture ne se propose : ${n.raison}.`,
    };

  const payload = ligne.payload as {
    document_date?: string | null;
    lines?: Array<Record<string, unknown>>;
    other_charges?: Array<Record<string, unknown>>;
  };
  const lue = payload.document_date && /^\d{4}-\d{2}-\d{2}$/.test(payload.document_date);
  const saisie = dateSaisie && /^\d{4}-\d{2}-\d{2}$/.test(dateSaisie) ? dateSaisie : null;
  // Une date lue n'est jamais remplacée ; la saisie ne complète que ce qui manque.
  const date = lue ? payload.document_date! : saisie;
  const p = await lireParametres(db, pack, date ?? new Date().toISOString().slice(0, 10));
  const dec = p["money.decimals"];

  const m = n.montants;
  const lignesLues = payload.lines ?? [];
  const droits = payload.other_charges ?? [];
  if (m.bases.length !== lignesLues.length || m.bases.some((b) => b.ht === null))
    return {
      ok: false,
      verdict,
      verdictCode: codeDuVerdict(verdict),
      raison: "Aucune écriture ne se propose : une base n'a pas été lue.",
    };
  if (m.autres.length !== droits.length || m.autres.some((a) => a === null))
    return {
      ok: false,
      verdict,
      verdictCode: codeDuVerdict(verdict),
      raison: "Aucune écriture ne se propose : un droit hors TVA n'a pas été lu.",
    };

  const tvas = m.bases.map((b, i) =>
    lignesLues.length === 1 && m.tva !== null ? m.tva : tvaDeBase(b.ht!, m.bases[i]!.taux),
  );
  const somme = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  const totalHt = somme(m.bases.map((b) => b.ht!));
  const totalTva = m.tva ?? somme(tvas);
  const autres = m.autres as number[];

  const normalise = {
    ...ligne.payload,
    document_date: date,
    lines: lignesLues.map((l, i) => ({
      ...l,
      base_ht: enDecimal(m.bases[i]!.ht!, dec),
      vat_amount: enDecimal(tvas[i]!, dec),
      ttc: enDecimal(m.bases[i]!.ht! + tvas[i]!, dec),
    })),
    other_charges: droits.map((c, i) => ({ ...c, amount: enDecimal(autres[i]!, dec) })),
    totals: {
      base_ht: enDecimal(totalHt, dec),
      vat: enDecimal(totalTva, dec),
      ttc: enDecimal(m.ttc ?? totalHt + totalTva + somme(autres), dec),
    },
  };

  const [taxRates, tousLesComptes, tousLesDroits] = await Promise.all([
    referentiel.taxRates(db, pack, ligne.jurisdiction),
    referentiel.accountMappings(db, pack),
    referentiel.fiscalCharges(db, pack),
  ]);
  // Le moteur ne connaît que l'achat et la vente : le reste n'y entre pas.
  const mappings = tousLesComptes.filter((c): c is typeof c & SensConnu =>
    sensConnu(c.documentKind),
  );
  const fiscalCharges = tousLesDroits.filter((c): c is typeof c & SensConnu =>
    sensConnu(c.documentKind),
  );

  try {
    const proposition = buildProposal({
      pieceId,
      payload: normalise,
      taxRates,
      mappings,
      fiscalCharges,
      currency: String((ligne.payload as { currency?: string }).currency ?? ""),
      parametres: {
        decimals: dec,
        confianceReserve: p["lecture.confiance_reserve"],
        confianceBloquante: p["lecture.confiance_bloquante"],
      },
    });
    if (!proposition.pivot.approvable)
      return {
        ok: false,
        verdict,
        verdictCode: codeDuVerdict(verdict),
        raison: `L'écriture ne s'équilibre pas : ${proposition.pivot.motifs.map((x) => x.message).join(" ; ")}`,
      };
    return {
      ok: true,
      verdict,
      verdictCode: codeDuVerdict(verdict),
      packVersionId: pack,
      proposition,
    };
  } catch (e) {
    if (e instanceof LectureIncomplete)
      return {
        ok: false,
        verdict,
        verdictCode: codeDuVerdict(verdict),
        raison: `Aucune écriture ne se propose : à compléter — ${e.champs.join(", ")}.`,
      };
    if (e instanceof Error && e.message === "MISSING_ACCOUNT_MAPPING")
      return {
        ok: false,
        verdict,
        verdictCode: codeDuVerdict(verdict),
        raison:
          "Aucune écriture ne se propose : le paramétrage n'a pas de compte pour ce type de pièce.",
      };
    throw e;
  }
}
