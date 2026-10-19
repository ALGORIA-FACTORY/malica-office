/**
 * Le règlement d'une pièce, composé côté serveur.
 *
 * ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
 *
 * 13 octobre 2026, le dirigeant : « l'écriture comptable et le rapprochement
 * dépendent énormément du moyen de paiement ». Il a raison, et le produit ne
 * tenait rien de cette promesse.
 *
 * Le référentiel portait depuis le 11 octobre le compte de trésorerie de
 * chaque moyen — 54 Caisse, 532 Banques, 403 Effets à payer. Vérifié le
 * 13 octobre : `tresorerie_account` n'était lu par AUCUN code de production.
 * L'expert lisait le moyen à l'écran et choisissait le compte à la main.
 *
 * ========================================================= CE QUE CE MODULE FAIT
 *
 * Il LIT — le paiement, la pièce, le pack — et il APPELLE le moteur du Socle.
 * Il n'émet aucune valeur liante : les comptes viennent du pack, le montant du
 * paiement déclaré, la date du règlement. R3 tient.
 *
 * Et il refuse franchement ce qui ne s'écrit pas : un paiement éteint par une
 * annulation, un « pas encore payé », une pièce dont le sens n'est pas tranché.
 *
 * ================================================ LE DOSSIER, PAS LA PIÈCE SEULE
 *
 * 19 octobre 2026, le dirigeant : « pas une pièce, c'est un dossier si on
 * rattache le paiement ». La facture, son règlement et la preuve du règlement
 * vont ensemble à la comptabilité, et les deux écritures doivent se
 * retrouver l'une l'autre. Le règlement portait `tiers: null` et
 * `referencePiece: null` : deux règlements du même mois à deux fournisseurs
 * donnaient le même libellé, et rien ne reliait l'écriture du règlement à celle
 * de la facture. Il porte désormais l'émetteur et le numéro LUS sur la pièce.
 *
 * Et la retenue à la source se CONSTATE (`constaterLaRetenue`) : le TTC lu sur
 * la pièce, le payé déclaré, et les taux du référentiel disent si elle a été
 * opérée, à quel taux — ou si elle ne l'a pas été alors qu'elle était due.
 */
import {
  construireReglement,
  ReglementIncomplet,
  type EcritureDeReglement,
} from "@malica/socle/use-cases/ecriture-de-reglement";
import { referenceDuDocument } from "@malica/socle/use-cases/libelle-de-piece";
import {
  constaterLaRetenue,
  type ConstatDeRetenue,
} from "@malica/socle/use-cases/retenue-au-reglement";

import type { Requete } from "../db.ts";
import { enDecimal } from "../malica/lecture/montants.ts";

import { lireParametres } from "./analyse.ts";

export type PropositionDeReglement =
  | {
      ok: true;
      ecriture: EcritureDeReglement;
      packVersionId: string;
      pieceId: string;
      /** Ce que le règlement dit de la retenue à la source. */
      retenue: ConstatDeRetenue;
    }
  | { ok: false; raison: string };

const SENS_CONNU = new Set(["facture_achat", "facture_vente"]);

/** Le rôle du compte de retenue, selon le sens : opérée à l'achat, subie à la vente. */
const ROLE_DE_LA_RETENUE = {
  facture_achat: "RETENUE_SOURCE_OPEREE",
  facture_vente: "RETENUE_SOURCE_SUBIE",
} as const;

export async function propositionDeReglement(
  db: Requete,
  paiementId: string,
): Promise<PropositionDeReglement> {
  const { rows } = await db.query<{
    piece_id: string;
    tenant_id: string;
    moyen_code: string;
    montant_mineur: string | null;
    devise: string;
    paye_le: string | null;
    reference: string | null;
    eteint: boolean;
    pack_version_id: string;
    document_kind: string | null;
    tresorerie_account: string | null;
    journal_code: string | null;
    moyen_libelle: string;
  }>(
    `select p.piece_id, pi.tenant_id, p.moyen_code, p.montant_mineur, p.devise,
            p.paye_le::text as paye_le, p.reference, p.eteint, p.pack_version_id,
            pi.document_kind,
            m.tresorerie_account, m.journal_code, m.libelle as moyen_libelle
       from paiements_v p
       join pieces_v pi on pi.id = p.piece_id
       left join ref_payment_means_v m
         on m.pack_version_id = p.pack_version_id and m.code = p.moyen_code
      where p.id = $1`,
    [paiementId],
  );
  const l = rows[0];
  if (!l) return { ok: false, raison: "Ce règlement n'existe pas, ou n'est pas lisible ici." };

  // Un paiement éteint n'engage plus rien : lui faire produire une écriture
  // ferait entrer en comptabilité un fait que la personne a annulé.
  if (l.eteint)
    return { ok: false, raison: "Ce règlement a été annulé : il ne produit aucune écriture." };
  if (l.montant_mineur === null || l.paye_le === null)
    return { ok: false, raison: "Aucun montant n'a été réglé : il n'y a rien à écrire." };
  if (!SENS_CONNU.has(l.document_kind ?? ""))
    return {
      ok: false,
      raison: "Le sens de la pièce n'est pas tranché : achat ou vente reste à confirmer.",
    };
  const sens = l.document_kind as "facture_achat" | "facture_vente";

  // Le compte du tiers vient du pack, par le sens de la pièce. Toutes les
  // lignes d'un même sens le partagent — on lit donc la première venue.
  const { rows: mapping } = await db.query<{ counterparty_account: string }>(
    `select counterparty_account from ref_account_mappings_v
      where pack_version_id = $1 and document_kind = $2
      limit 1`,
    [l.pack_version_id, l.document_kind],
  );
  const counterparty = mapping[0]?.counterparty_account ?? "";

  // La pièce telle qu'elle a été LUE : l'émetteur, sa référence, et le TTC
  // tranché par l'analyse (en unités mineures). Rien n'est recalculé ici.
  const { rows: lue } = await db.query<{
    payload: { issuer?: string; references?: Record<string, string> } | null;
    ttc_mineur: number | null;
    tva_mineur: number | null;
    jurisdiction: string;
  }>(
    `select e.payload,
            (a.normalisation -> 'montants' ->> 'ttc')::bigint as ttc_mineur,
            (a.normalisation -> 'montants' ->> 'tva')::bigint as tva_mineur,
            o.jurisdiction
       from capture.pieces p
       join identity.organizations o on o.id = p.tenant_id
       left join lateral (select payload from capture.extractions x
                           where x.piece_id = p.id order by created_at desc limit 1) e on true
       left join lateral (select normalisation from capture.analyses y
                           where y.piece_id = p.id order by created_at desc limit 1) a on true
      where p.id = $1`,
    [l.piece_id],
  );
  const piece = lue[0];
  const tiers = piece?.payload?.issuer?.trim() || null;
  const referencePiece = referenceDuDocument(piece?.payload?.references);

  // Les décimales viennent du paramétrage daté, par la MÊME lecture que
  // l'analyse — deux définitions de la devise finiraient par diverger.
  const parametres = await lireParametres(db, l.pack_version_id, l.paye_le);
  const decimales = parametres["money.decimals"]!;
  const paye = enDecimal(Number(l.montant_mineur), decimales);

  let retenue: ConstatDeRetenue = { cas: "sans_objet" };
  const lignesDeRetenue: Array<{ montant: string; compte: string; libelle: string }> = [];
  if (piece && piece.ttc_mineur !== null) {
    // Tous les taux qu'un règlement peut porter, dans le sens de la pièce :
    // la TVA retenue par un payeur public ne joue qu'à la vente.
    const { rows: taux } = await db.query<{
      code: string;
      taux: string;
      libelle: string;
      seuil: string | null;
      base: "ttc" | "tva";
      famille: "ir" | "tva";
      sens: "tous" | "achat" | "vente";
    }>(
      `select code, taux::text, libelle, seuil::text, base, famille, sens
         from ref.retenues_au_reglement($1, $2::date) order by rang`,
      [piece.jurisdiction, l.paye_le],
    );
    const sensCourt = sens === "facture_achat" ? "achat" : "vente";
    retenue = constaterLaRetenue({
      ttc: enDecimal(Number(piece.ttc_mineur), decimales),
      tva: piece.tva_mineur === null ? null : enDecimal(Number(piece.tva_mineur), decimales),
      paye,
      seuil: null,
      taux: taux
        .filter((t) => t.sens === "tous" || t.sens === sensCourt)
        .map((t) => ({
          code: t.code,
          taux: t.taux,
          libelle: t.libelle,
          base: t.base,
          famille: t.famille,
          seuil: t.seuil,
        })),
      decimales,
    });
    if (retenue.cas === "operee") {
      for (const r of retenue.retenues) {
        // Le compte, à trois niveaux comme partout : le dossier, la
        // comptabilité qui le mandate, le pack.
        const role = r.famille === "tva" ? "TVA_RETENUE_SUBIE" : ROLE_DE_LA_RETENUE[sens];
        const { rows: compte } = await db.query<{ compte: string | null }>(
          `select coalesce(d.account_code, c.account_code, p.account_code) as compte
             from ref.account_roles r
             left join ref.role_bindings p
               on p.role_code = r.code and p.pack_version_id = $2
             left join parametrage_role_bindings_v d
               on d.role_code = r.code and d.portee = 'dossier' and d.portee_id = $1
             left join parametrage_role_bindings_v c
               on c.role_code = r.code and c.portee = 'cabinet'
              and c.portee_id in (select cabinet_org_id from engagements_v where pme_org_id = $1)
            where r.code = $3
            limit 1`,
          [l.tenant_id, l.pack_version_id, role],
        );
        lignesDeRetenue.push({
          montant: r.montant,
          compte: compte[0]?.compte ?? "",
          libelle: r.libelle,
        });
      }
    }
  }

  try {
    const ecriture = construireReglement({
      sens,
      montant: paye,
      devise: l.devise,
      payeLe: l.paye_le,
      moyenLibelle: l.moyen_libelle ?? l.moyen_code,
      tresorerieAccount: l.tresorerie_account ?? "",
      journalCode: l.journal_code ?? "",
      counterpartyAccount: counterparty,
      tiers,
      reference: l.reference,
      referencePiece,
      retenues: lignesDeRetenue,
    });
    return {
      ok: true,
      ecriture,
      packVersionId: l.pack_version_id,
      pieceId: l.piece_id,
      retenue,
    };
  } catch (e) {
    if (e instanceof ReglementIncomplet) return { ok: false, raison: e.message };
    throw e;
  }
}
