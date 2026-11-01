/**
 * Le paramétrage du cabinet — volet 1.
 *
 * Ce dépôt sert un seul écran, et il porte une idée : l'expert ne choisit pas
 * un compte pour une écriture, il choisit un compte pour un RÔLE. « Le timbre
 * collecté », « la TVA déductible », « les achats de marchandises » — cent
 * soixante rôles, que les 182 schémas d'écriture citent sans jamais nommer un
 * numéro. Renuméroter le plan ne réécrit donc aucun schéma.
 *
 * Ce que ce dépôt NE fait PAS : décider. Les quatre règles du plan et le
 * contrôle de classe des rôles sont des déclencheurs en base. Un écran se
 * contourne ; un déclencheur, non. Ici on lit, on écrit, et on laisse la base
 * refuser.
 */

import type { OrigineDuParametrage, ReglagesComptables } from "@malica/socle/ports/repositories";

import { debutDExercice } from "@malica/socle/exercice";

import type { Requete } from "../db.ts";
import { nomsDesReglages, optionsDeLaRegleDeChange } from "./referentiel.ts";
import { versReport } from "./report-d-echeance.ts";

/** Les réglages d'un cabinet, tels que la base les rend (défauts compris). */
interface ReglagesCabinetBruts {
  seuilConfianceLot: number | string;
  seuilConfianceRevue: number | string;
  doubleValidationAuDela: number | string | null;
  propositionsProactives: boolean;
  capaciteDossiers: number | string;
  ton: string;
  seuilCertitudeConseil: number | string;
  regle: boolean;
}

/** Une obligation du calendrier, telle que la base la rend. */
interface ObligationBrute {
  code: string;
  libelle: string;
  periodicite: string;
  echeanceJour: number | string;
  echeanceMois: number | string | null;
  regle: string;
  texteSource: string | null;
  article: string | null;
  propre: boolean;
  secteur: string;
  formeJuridique: string | null;
  modeDepot: string | null;
  regime: string | null;
  mandats: number | string;
  active: boolean;
  rappelJours: number | string;
  regle_par_le_cabinet: boolean;
}

function versReglages(brut: ReglagesCabinetBruts) {
  return {
    seuilConfianceLot: Number(brut.seuilConfianceLot),
    seuilConfianceRevue: Number(brut.seuilConfianceRevue),
    doubleValidationAuDela:
      brut.doubleValidationAuDela == null ? null : String(brut.doubleValidationAuDela),
    propositionsProactives: Boolean(brut.propositionsProactives),
    capaciteDossiers: Number(brut.capaciteDossiers),
    ton: String(brut.ton),
    seuilCertitudeConseil: Number(brut.seuilCertitudeConseil),
    regle: Boolean(brut.regle),
  };
}

interface FuseauBrut {
  fuseau: string | null;
  defaut: string | null;
  regle: boolean;
  aujourdhui: string | null;
}

function versFuseau(r: FuseauBrut | undefined) {
  if (!r) throw new Error("fuseau.illisible");
  return {
    fuseau: r.fuseau ?? null,
    defaut: r.defaut ?? null,
    regle: Boolean(r.regle),
    aujourdhui: r.aujourdhui ?? null,
  };
}

export const parametrage = {
  /**
   * Les seuils et préférences du cabinet. Absents, la base rend les défauts
   * de son schéma — jamais un écran ne les porte.
   */
  async reglagesCabinet(db: Requete, tenantId: string) {
    const { rows } = await db.query<{ r: ReglagesCabinetBruts }>(
      `select public.cabinet_reglages_lire($1) as r`,
      [tenantId],
    );
    const r = rows[0]?.r;
    if (!r) throw new Error("reglages.illisibles");
    return versReglages(r);
  },

  /** Quand la mise en route a été terminée — ou rien. Elle se rejoue à volonté. */
  async miseEnRoute(db: Requete, tenantId: string): Promise<{ termineeLe: string | null }> {
    const { rows } = await db.query<{ quand: Date | string | null }>(
      `select public.cabinet_mise_en_route_lire($1) as quand`,
      [tenantId],
    );
    const quand = rows[0]?.quand ?? null;
    return { termineeLe: quand === null ? null : new Date(quand).toISOString() };
  },

  async terminerMiseEnRoute(db: Requete, tenantId: string): Promise<{ termineeLe: string }> {
    const { rows } = await db.query<{ quand: Date | string }>(
      `select public.cabinet_mise_en_route_terminer($1) as quand`,
      [tenantId],
    );
    const quand = rows[0]?.quand;
    if (!quand) throw new Error("mise_en_route.non_terminee");
    return { termineeLe: new Date(quand).toISOString() };
  },

  async definirReglagesCabinet(
    db: Requete,
    input: {
      tenantId: string;
      seuilConfianceLot: number;
      seuilConfianceRevue: number;
      doubleValidationAuDela: string | null;
      propositionsProactives: boolean;
      capaciteDossiers: number;
      ton: string;
      seuilCertitudeConseil: number;
    },
  ) {
    const { rows } = await db.query<{ r: ReglagesCabinetBruts }>(
      `select public.cabinet_reglages_definir($1, $2, $3, $4, $5, $6, $7, $8) as r`,
      [
        input.tenantId,
        input.seuilConfianceLot,
        input.seuilConfianceRevue,
        input.doubleValidationAuDela,
        input.propositionsProactives,
        input.capaciteDossiers,
        input.ton,
        input.seuilCertitudeConseil,
      ],
    );
    const r = rows[0]?.r;
    if (!r) throw new Error("reglages.non_enregistres");
    return versReglages(r);
  },

  /**
   * Le fuseau horaire du cabinet (décision du dirigeant, 29 octobre 2026) :
   * un paramètre métier, en base. Le référentiel de la juridiction livre le
   * défaut ; l'expert l'arrête ici. Le jour du journal, son numéro et la
   * comparaison des exports en dépendent.
   */
  async fuseauDuCabinet(db: Requete, tenantId: string) {
    const { rows } = await db.query<{ r: FuseauBrut }>(
      `select public.cabinet_fuseau_lire($1) as r`,
      [tenantId],
    );
    return versFuseau(rows[0]?.r);
  },

  async definirFuseauDuCabinet(db: Requete, tenantId: string, fuseau: string | null) {
    const { rows } = await db.query<{ r: FuseauBrut }>(
      `select public.cabinet_fuseau_definir($1, $2) as r`,
      [tenantId, fuseau],
    );
    return versFuseau(rows[0]?.r);
  },

  /**
   * Le calendrier du cabinet pour un exercice et un secteur : les
   * obligations du pack et les siennes, ce qu'il en a réglé, et le nombre
   * RÉEL de mandats concernés, compté depuis les fiches.
   */
  async calendrierCabinet(db: Requete, tenantId: string, exercice: number, secteur: string) {
    const { rows } = await db.query<{ r: ObligationBrute[] }>(
      `select public.cabinet_calendrier_lire($1, $2, $3) as r`,
      [tenantId, exercice, secteur],
    );
    return (rows[0]?.r ?? []).map((o) => ({
      code: o.code,
      libelle: o.libelle,
      periodicite: o.periodicite,
      echeanceJour: Number(o.echeanceJour),
      echeanceMois: o.echeanceMois == null ? null : Number(o.echeanceMois),
      regle: o.regle,
      texteSource: o.texteSource ?? null,
      article: o.article ?? null,
      propre: Boolean(o.propre),
      secteur: o.secteur,
      formeJuridique: o.formeJuridique ?? null,
      modeDepot: o.modeDepot ?? null,
      regime: o.regime ?? null,
      mandats: Number(o.mandats),
      active: Boolean(o.active),
      rappelJours: Number(o.rappelJours),
      regleParLeCabinet: Boolean(o.regle_par_le_cabinet),
    }));
  },

  /** Le cabinet suit ou écarte une obligation, et choisit son rappel. */
  async definirObligation(
    db: Requete,
    input: {
      tenantId: string;
      code: string;
      exercice: number;
      secteur: string;
      active: boolean;
      rappelJours: number;
    },
  ): Promise<{ active: boolean; rappelJours: number }> {
    const { rows } = await db.query<{ r: { active: boolean; rappelJours: number } }>(
      `select public.cabinet_obligation_definir($1, $2, $3, $4, $5, $6) as r`,
      [input.tenantId, input.code, input.exercice, input.secteur, input.active, input.rappelJours],
    );
    const r = rows[0]?.r;
    if (!r) throw new Error("obligation.non_reglee");
    return { active: Boolean(r.active), rappelJours: Number(r.rappelJours) };
  },

  /** Une obligation qui n'existe que pour les mandats de ce cabinet. */
  async creerObligationPropre(
    db: Requete,
    input: {
      tenantId: string;
      libelle: string;
      periodicite: string;
      echeanceJour: number;
      echeanceMois: number | null;
      regle: string;
      secteur: string;
    },
  ): Promise<{ id: string }> {
    const { rows } = await db.query<{ r: { id: string } }>(
      `select public.cabinet_obligation_propre_creer($1, $2, $3, $4, $5, $6, $7) as r`,
      [
        input.tenantId,
        input.libelle,
        input.periodicite,
        input.echeanceJour,
        input.echeanceMois,
        input.regle,
        input.secteur,
      ],
    );
    const id = rows[0]?.r.id;
    if (!id) throw new Error("obligation.non_creee");
    return { id };
  },

  /** Les secteurs d'activité que les fiches des mandats déclarent. */
  async secteursDuCabinet(db: Requete, tenantId: string): Promise<string[]> {
    const { rows } = await db.query<{ secteur: string }>(
      `select distinct f.secteur
         from identity.engagements e
         join identity.fiches_fiscales f on f.tenant_id = e.pme_org_id and f.valid_to is null
        where e.cabinet_org_id = $1 and e.status = 'actif' and f.secteur is not null
        order by 1`,
      [tenantId],
    );
    return rows.map((r) => r.secteur);
  },

  /**
   * Les reports exceptionnels qui touchent les dossiers du cabinet : ceux
   * qu'il a saisis, et ceux qu'ALGORIA a publiés pour sa juridiction. La date
   * légale ne change jamais ; le report dit la date retenue, et pourquoi.
   */
  async reportsDuCabinet(db: Requete, tenantId: string) {
    const { rows } = await db.query<{ r: Array<Record<string, unknown>> }>(
      `select public.cabinet_reports_lire($1) as r`,
      [tenantId],
    );
    return (rows[0]?.r ?? []).map(versReport);
  },

  async poserReport(
    db: Requete,
    input: {
      tenantId: string;
      code: string;
      periode: string;
      nouvelleDate: string;
      motif: string;
      source: string | null;
    },
  ): Promise<{ id: string }> {
    const { rows } = await db.query<{ r: { id: string } }>(
      `select public.cabinet_report_poser($1, $2, $3, $4::date, $5, $6) as r`,
      [input.tenantId, input.code, input.periode, input.nouvelleDate, input.motif, input.source],
    );
    const id = rows[0]?.r.id;
    if (!id) throw new Error("report.non_pose");
    return { id };
  },

  async retirerReport(db: Requete, tenantId: string, id: string): Promise<{ id: string }> {
    await db.query(`select public.cabinet_report_retirer($1, $2) as r`, [tenantId, id]);
    return { id };
  },

  /**
   * Les rôles, groupés par famille, avec le compte résolu et SON ORIGINE.
   *
   * L'origine est la colonne qui compte. Voir « 4371 » ne dit rien ; voir
   * « 4371 — livré par le pack » ou « 4371 — arrêté par votre cabinet » dit
   * qui répond de ce choix. C'est la deuxième conséquence de R10, et elle se
   * calcule ici plutôt que dans l'écran : la question « qui a décidé » ne doit
   * pas dépendre de la page qui l'affiche.
   */
  async roles(db: Requete, tenantId: string, dossierId: string | null) {
    const { rows } = await db.query(
      `select r.code, r.libelle, r.famille, r.classes_admises, r.note,
              coalesce(d.account_code, c.account_code, p.account_code) as compte,
              case
                when d.account_code is not null then 'dossier'
                when c.account_code is not null then 'cabinet'
                when p.account_code is not null then 'pack'
                else 'aucun'
              end as origine,
              coalesce(d.motif, c.motif) as motif,
              coalesce(d.decide_le, c.decide_le) as decide_le,
              p.account_code as defaut_du_pack,
              p.justification as justification_du_pack,
              a.label as compte_libelle
         from ref.account_roles r
         left join ref.role_bindings p
           on p.role_code = r.code
          and p.pack_version_id = (select id from ref_packs_v
                                    where jurisdiction = (select jurisdiction from organizations_v where id = $1)
                                      and effective_from <= current_date
                                    order by effective_from desc limit 1)
         left join parametrage_role_bindings_v c
           on c.role_code = r.code and c.portee = 'cabinet' and c.portee_id = $1
         left join parametrage_role_bindings_v d
           on d.role_code = r.code and d.portee = 'dossier' and d.portee_id = $2
         left join plan_comptable_v a
           on a.account_code = coalesce(d.account_code, c.account_code, p.account_code)
          and (a.tenant_id is null or a.tenant_id = $1)
        order by r.famille, r.code`,
      // La juridiction est celle du cabinet, lue en base : aucune n'est écrite ici (R4, R5).
      [tenantId, dossierId],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      code: r["code"] as string,
      libelle: r["libelle"] as string,
      famille: r["famille"] as string,
      classesAdmises: (r["classes_admises"] as number[]) ?? [],
      note: (r["note"] as string | null) ?? null,
      compte: (r["compte"] as string | null) ?? null,
      compteLibelle: (r["compte_libelle"] as string | null) ?? null,
      origine: r["origine"] as string,
      motif: (r["motif"] as string | null) ?? null,
      decideLe: (r["decide_le"] as string | null) ?? null,
      defautDuPack: (r["defaut_du_pack"] as string | null) ?? null,
      justificationDuPack: (r["justification_du_pack"] as string | null) ?? null,
    }));
  },

  /**
   * Le plan tel que ce cabinet le voit : le livré et le sien.
   *
   * Filtré par classe quand l'écran propose un compte pour un rôle — inutile
   * d'offrir six cents lignes quand le rôle n'en admet qu'une classe.
   */
  async plan(db: Requete, tenantId: string, classes: number[] | null) {
    const { rows } = await db.query(
      `select account_code, label, parent_code, account_class, normal_side,
              origine, is_official, source_ref, is_collective
         from plan_comptable_v
        where (tenant_id is null or tenant_id = $1)
          and ($2::int[] is null or account_class::int = any($2))
        order by account_code`,
      [tenantId, classes],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      code: r["account_code"] as string,
      libelle: r["label"] as string,
      parent: (r["parent_code"] as string | null) ?? null,
      classe: r["account_class"] as string,
      sensUsuel: (r["normal_side"] as string | null) ?? null,
      origine: r["origine"] as string,
      officiel: Boolean(r["is_official"]),
      // Un collectif reçoit des tiers, pas des subdivisions : l'écran doit
      // pouvoir le dire AVANT que l'expert ne tente.
      collectif: Boolean(r["is_collective"]),
      source: (r["source_ref"] as string | null) ?? null,
    }));
  },

  /** Ouvre un compte propre au cabinet. La base vérifie les quatre règles. */
  async ouvrirCompte(
    db: Requete,
    input: {
      tenantId: string;
      code: string;
      libelle: string;
      parent: string;
      sensUsuel?: string | null;
      motif?: string | null;
    },
  ): Promise<string> {
    // La classe n'est pas demandée : le déclencheur la déduit du parent. La
    // demander à l'appelant, c'est lui offrir de se contredire.
    const { rows } = await db.query<{ id: string }>(
      `select public.compte_cabinet_ouvrir($1, $2, $3, $4, $5, $6) as id`,
      [
        input.tenantId,
        input.code,
        input.libelle,
        input.parent,
        input.sensUsuel ?? null,
        input.motif ?? null,
      ],
    );
    return rows[0]!.id;
  },

  /** Referme un compte ouvert par le cabinet. Les comptes livrés ne s'effacent pas. */
  async fermerCompte(db: Requete, tenantId: string, code: string): Promise<void> {
    await db.query(`select public.compte_cabinet_fermer($1, $2)`, [tenantId, code]);
  },

  /**
   * Arrête le compte d'un rôle, pour le cabinet ou pour un dossier.
   *
   * Une décision remplace la précédente : c'est un paramétrage, pas un journal.
   * L'écriture qu'elle produira, elle, restera immuable — R7 porte sur les
   * écritures, pas sur les réglages qui les précèdent.
   */
  async definirLiaison(
    db: Requete,
    input: {
      tenantId: string;
      portee: string;
      porteeId: string;
      roleCode: string;
      compte: string;
      motif?: string | null;
    },
  ): Promise<void> {
    await db.query(`select public.role_compte_definir($1, $2, $3, $4, $5, $6)`, [
      input.tenantId,
      input.portee,
      input.porteeId,
      input.roleCode,
      input.compte,
      input.motif ?? null,
    ]);
  },

  /** Rend un rôle au défaut du pack : la surcharge disparaît, le livré reprend. */
  async rendreAuPack(
    db: Requete,
    input: { tenantId: string; portee: string; porteeId: string; roleCode: string },
  ): Promise<void> {
    await db.query(`select public.role_compte_rendre_au_pack($1, $2, $3, $4)`, [
      input.tenantId,
      input.portee,
      input.porteeId,
      input.roleCode,
    ]);
  },

  /**
   * Arrête les lignes de la déclaration de TVA (R10) : pour chaque sens et
   * nature, la ligne qui la reçoit — pour tout le cabinet (l'expert), ou pour
   * un dossier qu'il supervise. Confirmer, c'est arrêter l'affectation telle
   * qu'elle est ; `ligne: null` rend au défaut du pack. Rien ne se réécrit :
   * chaque décision s'ajoute, datée et signée (`app.tva_affecter`), et la base
   * refuse qui n'est pas du cabinet (`refus.tva.affectation.droits`).
   */
  async arreterDeclarationTva(
    db: Requete,
    input: {
      cabinetId: string;
      portee: "cabinet" | "dossier";
      porteeId: string;
      packId: string;
      /** La première déclaration à laquelle la décision s'applique. */
      depuis: string;
      affectations: Array<{ sens: string; nature: string; ligne: string | null }>;
      motif?: string | null;
    },
  ): Promise<{ decisions: number }> {
    const { rows } = await db.query<{ n: number }>(
      `select app.tva_affecter($1, $2, $3, $4, $5::date, $6::jsonb, $7) as n`,
      [
        input.cabinetId,
        input.portee,
        input.porteeId,
        input.packId,
        input.depuis,
        JSON.stringify(input.affectations),
        input.motif ?? null,
      ],
    );
    return { decisions: Number(rows[0]?.n ?? 0) };
  },

  /**
   * LES RÉGLAGES COMPTABLES (R10 ; décisions du CEO du 31 octobre 2026), vus
   * d'un cabinet ou d'un dossier, au jour dit. Un seul résolveur
   * (`app.reglage_comptable` : le dossier, son cabinet, le pack) ; la règle de
   * change y entre par sa propre table. Chaque sujet porte ce que dit le
   * texte, la pratique, le risque, le point INCERTAIN et ses sources ; et ce
   * que les tables existantes en imputent déjà (droits hors TVA, barème,
   * catégories d'immobilisations) — montré, jamais recopié.
   */
  async reglagesComptables(
    db: Requete,
    cabinetId: string,
    dossierId: string | null,
    packId: string,
    jour: string,
    locale = "fr",
  ): Promise<ReglagesComptables> {
    // Vu du dossier, s'il y en a un ; vu du cabinet sinon. Les valeurs du
    // CABINET se lisent aussi : arrêter « pour tout le cabinet » depuis un
    // dossier se compare à elles, jamais à celles du dossier (revue de #154).
    const vu = dossierId ?? cabinetId;
    const resoudre = (org: string) =>
      db.query<{
        code: string;
        valeur: string | null;
        origine: OrigineDuParametrage;
        decide_le: Date | null;
        reference: string | null;
      }>(
        `select code, valeur, origine, decide_le, reference
           from app.reglage_comptable($1, $2, $3::date)`,
        [org, packId, jour],
      );
    // Le libellé d'une clé dans la langue demandée (le paramètre `langue` de
    // la requête), le français à défaut. L'espace de noms s'écrit en entier
    // à l'appel (`ns = '…'`) : la garde des libellés orphelins le cherche.
    const libelle = (espace: string, cle: string, langue = "$1") =>
      `coalesce((select l.value from ref_labels_v l where l.${espace} and l.key = ${cle}
                   and l.locale = ${langue}),
                (select l.value from ref_labels_v l where l.${espace} and l.key = ${cle}
                   and l.locale = 'fr'))`;
    const [
      resolus,
      duCabinet,
      sujets,
      reglages,
      options,
      sources,
      droits,
      baremes,
      categories,
      natures,
      noms,
      change,
      clotures,
    ] = await Promise.all([
      resoudre(vu),
      dossierId ? resoudre(cabinetId) : null,
      db.query<{
        code: string;
        titre: string | null;
        texte: string | null;
        pratique: string | null;
        risque: string | null;
        incertain: string | null;
        droit_hors_tva: string | null;
        categories_d_immobilisation: boolean;
        natures_de_vente: boolean;
      }>(
        `select s.code, ${libelle("ns = 'reglage_sujet'", "s.code")} as titre,
                  ${libelle("ns = 'reglage_sujet_texte'", "s.code")} as texte,
                  ${libelle("ns = 'reglage_sujet_pratique'", "s.code")} as pratique,
                  ${libelle("ns = 'reglage_sujet_risque'", "s.code")} as risque,
                  ${libelle("ns = 'reglage_sujet_incertain'", "s.code")} as incertain,
                  s.droit_hors_tva, s.categories_d_immobilisation, s.natures_de_vente
             from ref.reglages_comptables_sujets s
            order by s.ordre`,
        [locale],
      ),
      db.query<{
        code: string;
        sujet: string;
        nature: "option" | "nombre";
        porte: string;
        applique: boolean;
      }>(
        `select code, sujet, nature, porte, applique from ref.reglages_comptables
            order by sujet, ordre`,
      ),
      db.query<{ reglage: string; code: string; applique: boolean; label: string | null }>(
        `select o.reglage, o.code, o.applique,
                  ${libelle("ns = 'reglage_comptable_option'", "o.reglage || ':' || o.code")} as label
             from ref.reglages_comptables_options o
            order by o.reglage, o.ordre`,
        [locale],
      ),
      db.query<{
        sujet: string;
        titre: string;
        url: string;
        datee_du: string | null;
        consultee_le: string;
      }>(
        `select sujet, titre, url, to_char(datee_du, 'YYYY-MM-DD') as datee_du,
                  to_char(consultee_le, 'YYYY-MM-DD') as consultee_le
             from ref.reglages_comptables_sources order by sujet, ordre`,
      ),
      db.query<{
        code: string;
        document_kind: "facture_achat" | "facture_vente";
        account_code: string;
        fixed_amount: string | null;
        rate: string | null;
      }>(
        `select distinct on (c.code, c.document_kind) c.code, c.document_kind, c.account_code,
                  c.fixed_amount::text as fixed_amount, c.rate::text as rate
             from ref.fiscal_charges c
            where c.pack_version_id = $1 and c.valid_from <= $2::date
              and (c.valid_to is null or c.valid_to >= $2::date)
              and c.document_kind in ('facture_achat', 'facture_vente')
            order by c.code, c.document_kind, c.valid_from desc`,
        [packId, jour],
      ),
      db.query<{
        droit: string;
        categorie: string;
        libelle: string | null;
        de: string;
        a: string | null;
        montant: string;
        unite_incertaine: boolean;
      }>(
        `select droit, categorie, montant_de::text as de, montant_a::text as a,
                  ${libelle("ns = 'bareme_categorie'", "categorie", "$3")} as libelle,
                  montant_du_droit::text as montant, unite_incertaine
             from ref.baremes_des_droits
            where pack_version_id = $1 and valid_from <= $2::date
              and (valid_to is null or valid_to >= $2::date)
            order by droit, categorie, montant_de`,
        [packId, jour, locale],
      ),
      db.query<{
        code: string;
        libelle: string;
        compte: string;
        taux_lineaire: string;
        taux_maximal: string | null;
        depasse: boolean;
      }>(
        `select c.code, c.label as libelle, c.account_immo as compte,
                  round(100.0 / c.duree_annees, 2)::text as taux_lineaire,
                  m.taux_pourcent::text as taux_maximal,
                  coalesce(round(100.0 / c.duree_annees, 2) > m.taux_pourcent, false) as depasse
             from ref.immo_categories c
             left join lateral (
                    select t.taux_pourcent from ref.taux_d_amortissement_maximaux t
                     where t.pack_version_id = c.pack_version_id and t.categorie = c.code
                       and t.valid_from <= $2::date
                       and (t.valid_to is null or t.valid_to >= $2::date)
                     order by t.valid_from desc limit 1) m on true
            where c.pack_version_id = $1 and c.valid_from <= $2::date
              and (c.valid_to is null or c.valid_to >= $2::date)
            order by c.code`,
        [packId, jour],
      ),
      db.query<{ code: string; libelle: string | null; compte: string; repli: boolean }>(
        `select n.code, ${libelle("ns = 'nature_de_vente'", "n.code", "$3")} as libelle,
                  b.account_code as compte, n.repli
             from ref.natures_de_vente n
             join ref.role_bindings b
               on b.pack_version_id = n.pack_version_id and b.role_code = n.role_code
            where n.pack_version_id = $1 and n.valid_from <= $2::date
              and (n.valid_to is null or n.valid_to >= $2::date)
            order by n.rang`,
        [packId, jour, locale],
      ),
      nomsDesReglages(db, locale),
      optionsDeLaRegleDeChange(db, locale),
      // La clôture de l'exercice du dossier (sa fiche fiscale en vigueur) :
      // une décision vaut, par défaut, depuis le début de l'exercice.
      dossierId
        ? db.query<{ cloture: string | null }>(
            `select f.cloture_exercice as cloture from identity.fiches_fiscales f
                where f.tenant_id = $1 and f.valid_to is null
                order by f.valid_from desc limit 1`,
            [dossierId],
          )
        : null,
    ]);

    const resolu = new Map(resolus.rows.map((r) => [r.code, r]));
    const resoluAuCabinet = duCabinet ? new Map(duCabinet.rows.map((r) => [r.code, r])) : resolu;
    return {
      debutExercice: debutDExercice(clotures?.rows[0]?.cloture ?? null, jour.slice(0, 7)),
      sujets: sujets.rows.flatMap((s) => {
        // Un réglage que le pack ne porte pas au jour dit ne se montre pas :
        // il n'a ni valeur ni défaut à confirmer.
        const lignes = reglages.rows.flatMap((g) => {
          const r = resolu.get(g.code);
          if (g.sujet !== s.code || !r) return [];
          const choix = options.rows.filter((o) => o.reglage === g.code);
          const liste =
            g.porte === "regles_de_change"
              ? (change.get(g.code)?.map((o) => ({ ...o, appliquee: g.applique })) ?? null)
              : g.nature === "option"
                ? choix.map((o) => ({
                    code: o.code,
                    label: o.label ?? o.code,
                    appliquee: g.applique && o.applique,
                  }))
                : null;
          const option = choix.find((o) => o.code === r.valeur);
          return [
            {
              code: g.code,
              libelle: noms.get(g.code) ?? g.code,
              nature: g.nature,
              valeur: r.valeur,
              origine: r.origine,
              decideLe: r.decide_le ? r.decide_le.toISOString() : null,
              valeurDuCabinet: resoluAuCabinet.get(g.code)?.valeur ?? null,
              origineDuCabinet: resoluAuCabinet.get(g.code)?.origine ?? "pack",
              reference: r.reference,
              // Le Socle applique-t-il ce qui est résolu ? Le réglage, puis
              // l'option : une règle de change ou un nombre n'ont que le premier.
              appliquee:
                g.applique &&
                (g.nature !== "option" ||
                  g.porte !== "reglages_comptables" ||
                  option?.applique === true),
              options: liste,
            },
          ];
        });
        if (lignes.length === 0) return [];
        return [
          {
            code: s.code,
            titre: s.titre ?? s.code,
            texte: s.texte ?? "",
            pratique: s.pratique ?? "",
            risque: s.risque ?? "",
            incertain: s.incertain,
            sources: sources.rows
              .filter((x) => x.sujet === s.code)
              .map((x) => ({
                titre: x.titre,
                url: x.url,
                dateeDu: x.datee_du,
                consulteeLe: x.consultee_le,
              })),
            reglages: lignes,
            droits: droits.rows
              .filter((d) => d.code === s.droit_hors_tva)
              .map((d) => ({
                sens: d.document_kind,
                compte: d.account_code,
                montantFixe: d.fixed_amount,
                taux: d.rate,
              })),
            bareme: baremes.rows
              .filter((b) => b.droit === s.droit_hors_tva)
              .map((b) => ({
                categorie: b.libelle ?? b.categorie,
                de: b.de,
                a: b.a,
                droit: b.montant,
                uniteIncertaine: b.unite_incertaine,
              })),
            categories: s.categories_d_immobilisation
              ? categories.rows.map((c) => ({
                  code: c.code,
                  libelle: c.libelle,
                  compte: c.compte,
                  tauxLineaire: c.taux_lineaire,
                  tauxMaximal: c.taux_maximal,
                  depasse: c.depasse,
                }))
              : [],
            naturesDeVente: s.natures_de_vente
              ? natures.rows.map((x) => ({
                  code: x.code,
                  libelle: x.libelle ?? x.code,
                  compte: x.compte,
                  repli: x.repli,
                }))
              : [],
          },
        ];
      }),
    };
  },

  /**
   * ARRÊTER (ou CONFIRMER) DES RÉGLAGES COMPTABLES (R10), pour tout le
   * cabinet (l'expert-comptable) ou pour un dossier qu'il supervise : une
   * seule porte (`app.reglages_comptables_arreter`), qui vérifie qui décide et
   * ce qui se décide, et transmet la règle de change à la sienne. Confirmer,
   * c'est arrêter la valeur telle qu'elle est : une décision, datée et signée.
   */
  async arreterReglagesComptables(
    db: Requete,
    input: {
      cabinetId: string;
      portee: "cabinet" | "dossier";
      porteeId: string;
      packId: string;
      depuis: string;
      valeurs: Array<{ code: string; valeur: string | null }>;
      motif?: string | null;
    },
  ): Promise<{ decisions: number }> {
    const { rows } = await db.query<{ n: number }>(
      `select app.reglages_comptables_arreter($1, $2, $3, $4, $5::date, $6::jsonb, $7) as n`,
      [
        input.cabinetId,
        input.portee,
        input.porteeId,
        input.packId,
        input.depuis,
        JSON.stringify(input.valeurs),
        input.motif ?? null,
      ],
    );
    return { decisions: Number(rows[0]?.n ?? 0) };
  },
};
