import { enUnitesExactes } from "@malica/socle/somme-decimale";
/** Règlement composé à partir des faits et d'une qualification fiscale explicite. */
import {
  construireReglement,
  ReglementIncomplet,
  type EcritureDeReglement,
} from "@malica/socle/use-cases/ecriture-de-reglement";
import { contrepartieDuDocument } from "@malica/socle/domain/contrepartie";
import { referenceDuDocument } from "@malica/socle/use-cases/libelle-de-piece";
import {
  constaterLaRetenue,
  RetenueNonQualifiee,
  type QualificationDeRetenue,
  type TauxDeRetenue,
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
      tauxDisponibles: TauxDeRetenue[];
      ttc: string | null;
      paye: string;
    }
  | { ok: false; raison: string };

const SENS_CONNU = new Set(["facture_achat", "facture_vente"]);

/** Le rôle du compte de retenue, selon le sens : opérée à l'achat, subie à la vente. */
const ROLE_DE_LA_RETENUE = {
  facture_achat: "RETENUE_SOURCE_OPEREE",
  facture_vente: "RETENUE_SOURCE_SUBIE",
} as const;

/** Plusieurs comptes possibles pour un même rôle : la base ne choisit pas au hasard. */
const AMBIGU = Symbol("ambigu");

/**
 * Le compte d'un rôle, à trois niveaux comme partout : le dossier, la
 * comptabilité qui le mandate, puis le défaut fourni (le compte du moyen de
 * paiement) ou, à défaut, le pack. Une seule lecture pour la trésorerie et
 * les retenues : deux surcharges contradictoires sont refusées, jamais
 * départagées par l'ordre d'une requête.
 */
async function compteDuRole(
  db: Requete,
  tenantId: string,
  role: string,
  packVersionId: string,
  defaut: string | null,
): Promise<string | null | typeof AMBIGU> {
  const { rows } = await db.query<{ compte: string | null }>(
    `select distinct coalesce(d.account_code, c.account_code, $4::text,
              (select p.account_code from ref.role_bindings p
                where p.role_code = $2 and p.pack_version_id = $3)) as compte
       from (select 1) source
       left join parametrage_role_bindings_v d on d.role_code = $2
         and d.portee = 'dossier' and d.portee_id = $1
       left join parametrage_role_bindings_v c on c.role_code = $2 and c.portee = 'cabinet'
         and c.portee_id in (select cabinet_org_id from engagements_v
                              where pme_org_id = $1 and status = 'actif')`,
    [tenantId, role, packVersionId, defaut],
  );
  return rows.length === 1 ? rows[0]!.compte : AMBIGU;
}

export async function propositionDeReglement(
  db: Requete,
  paiementId: string,
  qualification?: QualificationDeRetenue,
): Promise<PropositionDeReglement> {
  const { rows } = await db.query<{
    piece_id: string;
    /**
     * La photo courante de la pièce : celle qui en a remplacé l'ancienne, ou
     * la pièce elle-même. C'est SA lecture et SON écriture qui disent le sens,
     * le TTC et le tiers — jamais l'ancienne lecture (« Malica sans blocage »).
     * L'écriture du règlement reste sur la pièce du règlement (`piece_id`).
     */
    piece_courante: string;
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
    role_tresorerie: string | null;
    journal_code: string | null;
    moyen_libelle: string;
  }>(
    `select p.piece_id, pi.id as piece_courante, pi.tenant_id, p.moyen_code, p.montant_mineur, p.devise,
            p.paye_le::text as paye_le, p.reference, p.eteint, p.pack_version_id,
            pi.document_kind,
            case when pi.document_kind = 'facture_vente' then m.tresorerie_account_vente
                 else m.tresorerie_account end as tresorerie_account,
            case when pi.document_kind = 'facture_vente' then m.role_vente else m.role_achat end as role_tresorerie,
            m.journal_code, m.libelle as moyen_libelle
       from paiements_v p
       join pieces_v pi on pi.id = app.version_courante(p.piece_id)
       left join ref_payment_means_v m
         on m.pack_version_id = p.pack_version_id and m.code = p.moyen_code
        and m.valid_from <= p.paye_le and (m.valid_to is null or m.valid_to >= p.paye_le)
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

  let compteTresorerie = l.tresorerie_account;
  if (l.role_tresorerie) {
    const compte = await compteDuRole(
      db,
      l.tenant_id,
      l.role_tresorerie,
      l.pack_version_id,
      compteTresorerie,
    );
    if (compte === AMBIGU)
      return {
        ok: false,
        raison: "Plusieurs comptes de trésorerie sont configurés : précisez le compte du dossier.",
      };
    compteTresorerie = compte;
  }

  // La pièce telle qu'elle a été LUE : l'émetteur, sa référence, et le TTC
  // tranché par l'analyse (en unités mineures). Rien n'est recalculé ici.
  const { rows: lue } = await db.query<{
    payload: { issuer?: string; currency?: string; references?: Record<string, string> } | null;
    ttc_mineur: number | null;
    tva_mineur: number | null;
    jurisdiction: string;
    devise_comptable: string;
  }>(
    `select e.payload,
            (a.normalisation -> 'montants' ->> 'ttc')::bigint as ttc_mineur,
            (a.normalisation -> 'montants' ->> 'tva')::bigint as tva_mineur,
            o.jurisdiction, o.currency as devise_comptable
       from capture.pieces p
       join identity.organizations o on o.id = p.tenant_id
       left join lateral (select id, payload from capture.extractions x
                           where x.piece_id = p.id order by created_at desc limit 1) e on true
       left join lateral (select normalisation from capture.analyses y
                           where y.piece_id = p.id and y.extraction_id = e.id order by created_at desc limit 1) a on true
      where p.id = $1`,
    [l.piece_courante],
  );
  const piece = lue[0];
  if (
    piece &&
    (piece.devise_comptable !== l.devise ||
      (piece.payload?.currency && piece.payload.currency !== l.devise))
  )
    return {
      ok: false,
      raison: "Ce règlement nécessite une conversion de devise avant inscription.",
    };
  if (piece?.payload && piece.ttc_mineur === null)
    return {
      ok: false,
      raison: "La lecture courante doit être analysée avant de proposer le règlement.",
    };
  const tiers = piece?.payload
    ? contrepartieDuDocument({ ...piece.payload, document_kind: sens })
    : null;
  const referencePiece = referenceDuDocument(piece?.payload?.references);

  // Les décimales viennent du paramétrage daté, par la MÊME lecture que
  // l'analyse — deux définitions de la devise finiraient par diverger.
  const parametres = await lireParametres(db, l.pack_version_id, l.paye_le);
  const decimales = parametres["money.decimals"]!;
  // Une unité mineure hors entier sûr n'est jamais arrondie silencieusement.
  const mineurs = [l.montant_mineur, piece?.ttc_mineur, piece?.tva_mineur].filter((v) => v != null);
  if (mineurs.some((v) => !Number.isSafeInteger(Number(v))))
    return { ok: false, raison: "Le montant dépasse la précision prise en charge." };
  const paye = enDecimal(Number(l.montant_mineur), decimales);
  let ttc = piece?.ttc_mineur != null ? enDecimal(Number(piece.ttc_mineur), decimales) : null;

  if (ttc === null) {
    const { rows: totaux } = await db.query<{ total: string }>(
      `select sum(ll.debit)::text as total from ecritures_v e
         join ecriture_lignes_v ll on ll.ecriture_id = e.id
        where e.piece_id = $1 and e.nature = 'piece' and app.ecriture_vivante(e.id)
        group by e.id`,
      [l.piece_courante],
    );
    if (totaux.length === 1) ttc = totaux[0]!.total;
  }

  // Retrouver le tiers réellement comptabilisé, y compris un compte personnalisé.
  // Un résultat ambigu bloque : aucun « premier compte » arbitraire.
  const { rows: comptes } = await db.query<{ compte: string }>(
    `select distinct ll.account_code as compte
       from ecritures_v e join ecriture_lignes_v ll on ll.ecriture_id = e.id
      where e.piece_id = $1 and e.nature = 'piece' and app.ecriture_vivante(e.id)
        and (($2 = 'facture_achat' and ll.credit = $3::numeric and ll.debit = 0)
          or ($2 = 'facture_vente' and ll.debit = $3::numeric and ll.credit = 0))`,
    [l.piece_courante, sens, ttc],
  );
  let counterparty = comptes.length === 1 ? comptes[0]!.compte : "";
  if (!comptes.length) {
    const { rows: inscrite } = await db.query(
      `select id from ecritures_v where piece_id = $1 and nature = 'piece' and app.ecriture_vivante(id)`,
      [l.piece_courante],
    );
    if (inscrite.length)
      return { ok: false, raison: "Le compte du tiers inscrit doit être vérifié." };
    const { rows: mapping } = await db.query<{ counterparty_account: string }>(
      `select distinct counterparty_account from ref_account_mappings_v
        where pack_version_id = $1 and document_kind = $2`,
      [l.pack_version_id, sens],
    );
    counterparty = mapping.length === 1 ? mapping[0]!.counterparty_account : "";
  }
  let tauxDisponibles: TauxDeRetenue[] = [];

  let retenue: ConstatDeRetenue = { cas: "sans_objet" };
  const lignesDeRetenue: Array<{ montant: string; compte: string; libelle: string }> = [];
  if (piece && ttc !== null) {
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
    tauxDisponibles = taux.filter((t) => t.sens === "tous" || t.sens === sensCourt);
    try {
      retenue = constaterLaRetenue({
        ttc,
        tva: piece.tva_mineur === null ? null : enDecimal(Number(piece.tva_mineur), decimales),
        paye,
        seuil: null,
        taux: tauxDisponibles,
        decimales,
        ...(qualification ? { qualification } : {}),
      });
    } catch (e) {
      if (e instanceof RetenueNonQualifiee) return { ok: false, raison: e.message };
      throw e;
    }
    if (retenue.cas === "operee") {
      for (const r of retenue.retenues) {
        // Le compte, à trois niveaux comme partout : le dossier, la
        // comptabilité qui le mandate, le pack.
        const role = r.famille === "tva" ? "TVA_RETENUE_SUBIE" : ROLE_DE_LA_RETENUE[sens];
        const compte = await compteDuRole(db, l.tenant_id, role, l.pack_version_id, null);
        if (compte === AMBIGU)
          return {
            ok: false,
            raison:
              "Plusieurs comptes de retenue à la source sont configurés : précisez le compte du dossier.",
          };
        lignesDeRetenue.push({
          montant: r.montant,
          compte: compte ?? "",
          libelle: r.libelle,
        });
      }
    }
  }

  // Le cumul éteint une seule dette : ni le prochain solde ni une retenue
  // n'ont le droit de faire dépasser le TTC. Un trop-perçu exige une autre imputation.
  if (ttc !== null) {
    const { rows: autres } = await db.query<{
      montant_mineur: string | null;
      devise: string;
      brut: string | null;
    }>(
      `select p.montant_mineur::text, p.devise, app.dette_eteinte(p.id)::text as brut
         from paiements_v p where p.piece_id in (select app.versions_de_la_piece($1))
           and p.id <> $2 and not p.eteint
           and p.montant_mineur is not null`,
      [l.piece_id, paiementId],
    );
    if (autres.some((p) => p.devise !== l.devise))
      return {
        ok: false,
        raison: "Les règlements en devises différentes nécessitent un rapprochement de change.",
      };
    const total = autres.reduce(
      (a, p) =>
        a + (p.brut !== null ? enUnitesExactes(p.brut, decimales) : BigInt(p.montant_mineur!)),
      enUnitesExactes(paye, decimales) +
        lignesDeRetenue.reduce((a, r) => a + enUnitesExactes(r.montant, decimales), 0n),
    );
    if (total > enUnitesExactes(ttc, decimales))
      return {
        ok: false,
        raison:
          "Le cumul des paiements et retenues dépasse la dette de la facture : vérifiez le trop-perçu.",
      };
  }

  try {
    const ecriture = construireReglement({
      sens,
      montant: paye,
      devise: l.devise,
      decimales,
      payeLe: l.paye_le,
      moyenLibelle: l.moyen_libelle ?? l.moyen_code,
      tresorerieAccount: compteTresorerie ?? "",
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
      tauxDisponibles,
      ttc,
      paye,
    };
  } catch (e) {
    if (e instanceof ReglementIncomplet) return { ok: false, raison: e.message };
    throw e;
  }
}
