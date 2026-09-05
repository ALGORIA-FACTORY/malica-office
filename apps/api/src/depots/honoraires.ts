/**
 * Les honoraires du cabinet — mandats, factures, encaissements, synthèse.
 *
 * Ce dépôt ne calcule rien. Les totaux d'une facture se déduisent de ses
 * lignes par déclencheur ; le taux de TVA est lu dans le pack par la fonction
 * qui crée le brouillon ; le numéro s'attribue à l'émission ; la synthèse d'un
 * mois se somme en SQL. Ici on lit, on transmet, et on laisse la base refuser.
 *
 * Les montants voyagent en chaînes décimales — `pg` rend les `numeric` ainsi,
 * et c'est la seule forme qui ne perd pas un millime.
 */

import type { Requete } from "../db.ts";
import { dec, decOuNul } from "./decimal.ts";

/** Une ligne de facture telle que l'écran la saisit : rien n'est calculé. */
interface LigneSaisie {
  libelle: string;
  quantite: string;
  prixUnitaire: string;
}

function versLignesJson(lignes: LigneSaisie[]) {
  return JSON.stringify(
    lignes.map((l) => ({
      libelle: l.libelle,
      quantite: l.quantite,
      prix_unitaire: l.prixUnitaire,
    })),
  );
}

function versFacture(r: Record<string, unknown>) {
  return {
    id: r["id"] as string,
    tenantId: r["tenant_id"] as string,
    clientTenantId: r["client_tenant_id"] as string,
    clientName: (r["client_name"] as string | null) ?? "—",
    mandatId: (r["mandat_id"] as string | null) ?? null,
    numero: (r["numero"] as string | null) ?? null,
    periodeDu: r["periode_du"] as string,
    periodeAu: r["periode_au"] as string,
    statut: r["statut"] as string,
    tauxTvaCode: r["taux_tva_code"] as string,
    tauxTva: dec(r["taux_tva"], 4),
    totalHt: dec(r["total_ht"]),
    totalTva: dec(r["total_tva"]),
    droitsFixes: dec(r["droits_fixes"]),
    droitsLibelle: (r["droits_libelle"] as string | null) ?? null,
    totalTtc: dec(r["total_ttc"]),
    encaisse: dec(r["encaisse"]),
    devise: r["devise"] as string,
    emiseLe: (r["emise_le"] as string | null) ?? null,
    echeanceLe: (r["echeance_le"] as string | null) ?? null,
    payeeLe: (r["payee_le"] as string | null) ?? null,
    annuleeLe: (r["annulee_le"] as string | null) ?? null,
    avoirDe: (r["avoir_de"] as string | null) ?? null,
    createdAt: r["created_at"] as string,
  };
}

/** Le tronc commun des lectures de factures : la vue, le client, l'encaissé. */
const SELECT_FACTURE = `
  select f.*, o.name as client_name,
         coalesce((select sum(e.montant) from encaissements_honoraires_v e
                    where e.facture_id = f.id), 0) as encaisse
    from factures_honoraires_v f
    left join organizations_v o on o.id = f.client_tenant_id`;

export const honoraires = {
  /** Les mandats ouverts du cabinet, avec la prochaine facturation dérivée. */
  async mandats(db: Requete, cabinetTenantId: string) {
    const { rows } = await db.query(
      `select m.*, o.name as client_name,
              public.honoraires_prochaine_facturation(m.frequence, m.jour_facturation,
                                                       m.valid_from, m.valid_to) as prochaine
         from mandats_honoraires_v m
         left join organizations_v o on o.id = m.client_tenant_id
        where m.tenant_id = $1 and m.valid_to is null
        order by o.name`,
      [cabinetTenantId],
    );
    return (rows as Record<string, unknown>[]).map((m) => ({
      id: m["id"] as string,
      clientTenantId: m["client_tenant_id"] as string,
      clientName: (m["client_name"] as string | null) ?? "—",
      mode: m["mode"] as string,
      frequence: m["frequence"] as string,
      jourFacturation: Number(m["jour_facturation"]),
      forfait: decOuNul(m["forfait"]),
      tauxHoraire: decOuNul(m["taux_horaire"]),
      delaiPaiementJours: Number(m["delai_paiement_jours"]),
      couverture: (m["couverture"] as string[] | null) ?? [],
      validFrom: m["valid_from"] as string,
      prochaine: (m["prochaine"] as string | null) ?? null,
    }));
  },

  /** Clôt le mandat ouvert du client, s'il existe, et en ouvre un autre. */
  async definirMandat(
    db: Requete,
    input: {
      cabinetTenantId: string;
      clientTenantId: string;
      mode: string;
      frequence: string;
      jourFacturation: number;
      forfait: string | null;
      tauxHoraire: string | null;
      delaiPaiementJours: number;
      couverture: string[];
    },
  ): Promise<{ id: string }> {
    const { rows } = await db.query<{ r: { id: string } }>(
      `select public.honoraires_mandat_definir($1, $2, $3, $4, $5, $6, $7, $8, $9) as r`,
      [
        input.cabinetTenantId,
        input.clientTenantId,
        input.mode,
        input.frequence,
        input.jourFacturation,
        input.forfait,
        input.tauxHoraire,
        input.delaiPaiementJours,
        input.couverture,
      ],
    );
    const id = rows[0]?.r.id;
    if (!id) throw new Error("mandat.non_defini");
    return { id };
  },

  async cloreMandat(db: Requete, id: string): Promise<{ id: string }> {
    const { rows } = await db.query<{ r: { id: string } }>(
      `select public.honoraires_mandat_clore($1) as r`,
      [id],
    );
    const clos = rows[0]?.r.id;
    if (!clos) throw new Error("mandat.non_clos");
    return { id: clos };
  },

  /**
   * Les factures du cabinet. Le mois filtre sur l'émission, ou sur le début
   * de période pour un brouillon qui n'a pas encore de date d'émission.
   */
  async factures(
    db: Requete,
    cabinetTenantId: string,
    filtres?: { mois?: string | null; statut?: string | null; clientTenantId?: string | null },
  ) {
    const { rows } = await db.query(
      `${SELECT_FACTURE}
        where f.tenant_id = $1
          and ($2::text is null
               or to_char(coalesce(f.emise_le, f.periode_du), 'YYYY-MM') = $2)
          and ($3::text is null or f.statut = $3)
          and ($4::uuid is null or f.client_tenant_id = $4)
        order by f.emise_le desc nulls first, f.created_at desc
        limit 500`,
      [
        cabinetTenantId,
        filtres?.mois ?? null,
        filtres?.statut ?? null,
        filtres?.clientTenantId ?? null,
      ],
    );
    return (rows as Record<string, unknown>[]).map(versFacture);
  },

  /** Les encaissements d'un mois « AAAA-MM », avec la facture et le client qu'ils règlent. */
  async encaissements(db: Requete, cabinetTenantId: string, mois: string) {
    const { rows } = await db.query(
      `select e.id, e.facture_id, e.montant, e.encaisse_le, e.moyen, e.reference,
              f.numero, o.name as client_name
         from encaissements_honoraires_v e
         join factures_honoraires_v f on f.id = e.facture_id
         left join organizations_v o on o.id = f.client_tenant_id
        where e.tenant_id = $1 and to_char(e.encaisse_le, 'YYYY-MM') = $2
        order by e.encaisse_le desc, e.created_at desc`,
      [cabinetTenantId, mois],
    );
    return (rows as Record<string, unknown>[]).map((e) => ({
      id: e["id"] as string,
      factureId: e["facture_id"] as string,
      numero: (e["numero"] as string | null) ?? null,
      clientName: (e["client_name"] as string | null) ?? "—",
      montant: dec(e["montant"]),
      encaisseLe: e["encaisse_le"] as string,
      moyen: e["moyen"] as string,
      reference: (e["reference"] as string | null) ?? null,
    }));
  },

  /** Une facture, ses lignes, ses encaissements, et les deux identités qu'elle porte. */
  async facture(db: Requete, id: string) {
    const entete = await db.query(`${SELECT_FACTURE} where f.id = $1`, [id]);
    const brut = (entete.rows as Record<string, unknown>[])[0];
    if (!brut) return null;
    const f = versFacture(brut);

    const [lignes, encaissements, cabinet, client, mandat, mentions] = await Promise.all([
      db.query(
        `select id, ordre, libelle, quantite, prix_unitaire, montant_ht
           from factures_honoraires_lignes_v where facture_id = $1 order by ordre`,
        [id],
      ),
      db.query(
        `select id, montant, encaisse_le, moyen, reference, created_at
           from encaissements_honoraires_v where facture_id = $1 order by encaisse_le, created_at`,
        [id],
      ),
      db.query(`select name, legal_id from organizations_v where id = $1`, [f.tenantId]),
      db.query(`select name, legal_id from organizations_v where id = $1`, [f.clientTenantId]),
      db.query(
        `select mode, frequence, delai_paiement_jours, couverture, forfait, taux_horaire
           from mandats_honoraires_v where id = $1`,
        [f.mandatId],
      ),
      // Les mentions que le pack exige sur une facture : elles se lisent, elles
      // ne s'écrivent pas dans le code (R4).
      db.query(
        `select code, label, mandatory, legal_reference
           from ref_mentions_v where pack_version_id = $1 order by mandatory desc, label`,
        [brut["pack_version_id"]],
      ),
    ]);
    const c = (cabinet.rows as Record<string, unknown>[])[0] ?? {};
    const k = (client.rows as Record<string, unknown>[])[0] ?? {};
    const m = (mandat.rows as Record<string, unknown>[])[0];

    return {
      ...f,
      cabinet: {
        name: (c["name"] as string) ?? "—",
        legalId: (c["legal_id"] as string | null) ?? null,
      },
      client: {
        name: (k["name"] as string) ?? "—",
        legalId: (k["legal_id"] as string | null) ?? null,
      },
      mandat: m
        ? {
            mode: m["mode"] as string,
            frequence: m["frequence"] as string,
            delaiPaiementJours: Number(m["delai_paiement_jours"]),
            couverture: (m["couverture"] as string[] | null) ?? [],
            forfait: decOuNul(m["forfait"]),
            tauxHoraire: decOuNul(m["taux_horaire"]),
          }
        : null,
      lignes: (lignes.rows as Record<string, unknown>[]).map((l) => ({
        id: l["id"] as string,
        ordre: Number(l["ordre"]),
        libelle: l["libelle"] as string,
        quantite: dec(l["quantite"]),
        prixUnitaire: dec(l["prix_unitaire"]),
        montantHt: dec(l["montant_ht"]),
      })),
      encaissements: (encaissements.rows as Record<string, unknown>[]).map((e) => ({
        id: e["id"] as string,
        montant: dec(e["montant"]),
        encaisseLe: e["encaisse_le"] as string,
        moyen: e["moyen"] as string,
        reference: (e["reference"] as string | null) ?? null,
      })),
      mentions: (mentions.rows as Record<string, unknown>[]).map((x) => ({
        code: x["code"] as string,
        label: x["label"] as string,
        mandatory: Boolean(x["mandatory"]),
        legalReference: (x["legal_reference"] as string | null) ?? null,
      })),
    };
  },

  async creerBrouillon(
    db: Requete,
    input: {
      cabinetTenantId: string;
      clientTenantId: string;
      periodeDu: string;
      periodeAu: string;
      tauxTvaCode: string;
      lignes: LigneSaisie[];
    },
  ): Promise<{ id: string }> {
    const { rows } = await db.query<{ r: { id: string } }>(
      `select public.honoraires_brouillon_creer($1, $2, $3, $4, $5, $6::jsonb) as r`,
      [
        input.cabinetTenantId,
        input.clientTenantId,
        input.periodeDu,
        input.periodeAu,
        input.tauxTvaCode,
        versLignesJson(input.lignes),
      ],
    );
    const id = rows[0]?.r.id;
    if (!id) throw new Error("brouillon.non_cree");
    return { id };
  },

  async modifierBrouillon(
    db: Requete,
    input: {
      id: string;
      periodeDu: string;
      periodeAu: string;
      tauxTvaCode: string;
      lignes: LigneSaisie[];
    },
  ): Promise<{ id: string }> {
    const { rows } = await db.query<{ r: { id: string } }>(
      `select public.honoraires_brouillon_modifier($1, $2, $3, $4, $5::jsonb) as r`,
      [input.id, input.periodeDu, input.periodeAu, input.tauxTvaCode, versLignesJson(input.lignes)],
    );
    const id = rows[0]?.r.id;
    if (!id) throw new Error("brouillon.non_modifie");
    return { id };
  },

  async supprimerBrouillon(db: Requete, id: string): Promise<boolean> {
    const { rows } = await db.query<{ ok: boolean }>(
      `select public.honoraires_brouillon_supprimer($1) as ok`,
      [id],
    );
    return Boolean(rows[0]?.ok);
  },

  async emettre(db: Requete, id: string): Promise<{ id: string; numero: string }> {
    const { rows } = await db.query<{ r: { id: string; numero: string } }>(
      `select public.honoraires_facture_emettre($1) as r`,
      [id],
    );
    const r = rows[0]?.r;
    if (!r) throw new Error("facture.non_emise");
    return { id: r.id, numero: r.numero };
  },

  async encaisser(
    db: Requete,
    input: {
      factureId: string;
      montant: string;
      encaisseLe: string;
      moyen: string;
      reference: string | null;
    },
  ): Promise<{ id: string; encaisse: string; soldee: boolean }> {
    const { rows } = await db.query<{ r: { id: string; encaisse: unknown; soldee: boolean } }>(
      `select public.honoraires_encaisser($1, $2, $3, $4, $5) as r`,
      [input.factureId, input.montant, input.encaisseLe, input.moyen, input.reference],
    );
    const r = rows[0]?.r;
    if (!r) throw new Error("encaissement.non_enregistre");
    return { id: r.id, encaisse: dec(r.encaisse), soldee: Boolean(r.soldee) };
  },

  async avoir(db: Requete, id: string): Promise<{ id: string; numero: string }> {
    const { rows } = await db.query<{ r: { id: string; numero: string } }>(
      `select public.honoraires_avoir($1) as r`,
      [id],
    );
    const r = rows[0]?.r;
    if (!r) throw new Error("avoir.non_cree");
    return { id: r.id, numero: r.numero };
  },

  /** La synthèse d'un mois « AAAA-MM » : tout est sommé en base. */
  async synthese(db: Requete, cabinetTenantId: string, mois: string) {
    const { rows } = await db.query<{ r: Record<string, unknown> }>(
      `select public.honoraires_synthese_lire($1, $2) as r`,
      [cabinetTenantId, mois],
    );
    const r = rows[0]?.r;
    if (!r) throw new Error("synthese.illisible");
    return {
      mois: String(r["mois"]),
      devise: String(r["devise"] ?? ""),
      factureHt: dec(r["factureHt"]),
      factureTtc: dec(r["factureTtc"]),
      nbFactures: Number(r["nbFactures"] ?? 0),
      encaisse: dec(r["encaisse"]),
      nbEncaissements: Number(r["nbEncaissements"] ?? 0),
      resteDu: dec(r["resteDu"]),
      nbOuvertes: Number(r["nbOuvertes"] ?? 0),
      enRetard: dec(r["enRetard"]),
      nbRetard: Number(r["nbRetard"] ?? 0),
      tauxEncaissement: decOuNul(r["tauxEncaissement"], 4),
      nbBrouillons: Number(r["nbBrouillons"] ?? 0),
    };
  },
};
