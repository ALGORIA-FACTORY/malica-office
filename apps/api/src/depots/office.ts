import {
  lireLaQualification,
  RetenueNonQualifiee,
  type ConstatDeRetenue,
  type QualificationDeRetenue,
} from "@malica/socle/use-cases/retenue-au-reglement";
/**
 * Le bureau — proposition, comptabilisation, lecture des écritures.
 *
 * Les deux gestes qui engagent — proposer et comptabiliser — restent des
 * fonctions PL/pgSQL. Elles portent l'équilibre, la numérotation et le refus
 * de mutation ; les déplacer en TypeScript les mettrait hors de la transaction
 * qui les protège.
 */

import { createHash } from "node:crypto";

import type {
  CoursDeChange,
  DerogationDeCours,
  FactureARattacher,
  PropositionDePiece,
} from "@malica/socle/ports/repositories";

import {
  controlerLaSaisie,
  ligneNormalisee,
  type LigneSaisie,
} from "@malica/socle/ecriture-saisie";
import { z } from "zod";

import type { Requete } from "../db.ts";
import { analyserPiece, exposantDeLaDevise, rejugerLaPiece } from "../scan/analyse.ts";
import {
  dansLaFenetre,
  hypotheseRetenue,
  leMoisDeTvaDuDossier,
  type HypotheseDuMois,
  type MoisDeTvaDuDossier,
} from "../scan/mois-de-tva.ts";
import { propositionDePiece } from "../scan/proposition.ts";
import { propositionDeReglement } from "../scan/reglement.ts";
import { rejugerALOuverture, rejugerLesPieces, type BilanDuRejeu } from "../scan/rejeu.ts";

import { dec } from "./decimal.ts";
import { extraitsEnDeviseDuDossier } from "./en-devise-du-dossier.ts";

interface Ligne {
  ordinal: number;
  accountCode: string;
  libelle: string;
  debit: string;
  credit: string;
  taxCode: string | null;
  deviseOrigine: string | null;
  montantOrigine: string | null;
  tauxDeChange: string | null;
}

/**
 * Les lignes arrivent à plat, groupées par écriture.
 *
 * L'adaptateur d'origine faisait deux requêtes puis regroupait en JavaScript.
 * On garde ce découpage : une jointure produirait l'entête autant de fois
 * qu'elle a de lignes, pour un gain nul à ces volumes.
 */
function parEcriture(lignes: Record<string, unknown>[]): Map<string, Ligne[]> {
  const carte = new Map<string, Ligne[]>();
  for (const l of lignes) {
    const cle = l["ecriture_id"] as string;
    const liste = carte.get(cle) ?? [];
    liste.push({
      ordinal: Number(l["ordinal"]),
      accountCode: l["account_code"] as string,
      libelle: (l["libelle"] as string) ?? "",
      debit: dec(l["debit"]),
      credit: dec(l["credit"]),
      taxCode: (l["tax_code"] as string | null) ?? null,
      // Une ligne convertie d'une pièce en devise (31 octobre 2026).
      deviseOrigine: (l["devise_origine"] as string | null) ?? null,
      montantOrigine: l["montant_origine"] == null ? null : String(l["montant_origine"]),
      tauxDeChange: l["taux_de_change"] == null ? null : String(l["taux_de_change"]),
    });
    carte.set(cle, liste);
  }
  return carte;
}

/** Un refus métier, rendu comme tel au client (22023), jamais comme une panne. */
function refusMetier(message: string): Error {
  return Object.assign(new Error(message), { code: "22023" });
}

/**
 * La qualification reçue du navigateur est relue avant tout usage : seuls ses
 * champs connus entrent dans le calcul et dans l'audit.
 */
function qualificationLue(entree: unknown): QualificationDeRetenue | undefined {
  if (entree === undefined || entree === null) return undefined;
  try {
    return lireLaQualification(entree);
  } catch (e) {
    if (e instanceof RetenueNonQualifiee) throw refusMetier(e.message);
    throw e;
  }
}

/** Deux jeux de lignes portent-ils exactement les mêmes comptes et montants ? */
function memesLignes(
  a: ReadonlyArray<{ account_code: string; debit: string; credit: string }>,
  b: ReadonlyArray<{ account_code: string; debit: string; credit: string }>,
): boolean {
  const cle = (l: { account_code: string; debit: string; credit: string }) =>
    `${l.account_code}|${Number(l.debit).toFixed(6)}|${Number(l.credit).toFixed(6)}`;
  const x = a.map(cle).sort();
  const y = b.map(cle).sort();
  return x.length === y.length && x.every((k, i) => k === y[i]);
}

/**
 * L'écriture VIVANTE de la pièce (toutes ses versions), son pack, sa devise,
 * et si un cabinet l'a prise en charge — `null` si la pièce n'en porte pas.
 */
async function ecritureVivante(
  db: Requete,
  pieceId: string,
): Promise<{ id: string; pack: string; devise: string; prise: boolean } | null> {
  const { rows } = await db.query<{ id: string; pack: string; devise: string; prise: boolean }>(
    `select e.id, e.pack_version_id as pack, e.devise,
            (select s.prise from app.suivi_de_la_piece($1) s) is not null as prise
       from ecritures_v e
      where e.piece_id in (select app.versions_de_la_piece($1))
        and e.nature = 'piece' and app.ecriture_vivante(e.id)
      limit 1`,
    [pieceId],
  );
  return rows[0] ?? null;
}

async function lignesDe(db: Requete, ids: string[]): Promise<Map<string, Ligne[]>> {
  const { rows } = await db.query(
    `select ecriture_id, ordinal, account_code, libelle, debit, credit, tax_code,
            devise_origine, montant_origine::text as montant_origine,
            taux_de_change::text as taux_de_change
       from ecriture_lignes_v where ecriture_id = any($1::uuid[]) order by ordinal`,
    [ids],
  );
  return parEcriture(rows as Record<string, unknown>[]);
}

/**
 * Les colonnes d'une écriture lue, et le fait qui manquait à l'écran : est-ce
 * l'écriture VIVANTE de sa pièce — inscrite, ni contre-passation ni
 * contre-passée, pas un règlement ? Deux écritures passées dans la même
 * transaction (contre-passation et réimputation) ont le même `created_at` :
 * l'ordre ne disait pas laquelle vit (ANO-CAB-005, ANO-FC-012).
 */
const COLONNES_ECRITURE = `e.id, e.piece_id, e.journal, e.date_ecriture, e.devise, e.libelle,
       e.status, e.pack_version_id, e.booked_at,
       (e.status = 'booked' and e.nature = 'piece' and e.reverses_id is null
        and not exists (select 1 from ecritures_v r where r.reverses_id = e.id)) as vivante`;

function versEcriture(r: Record<string, unknown>, lignes: Map<string, Ligne[]>) {
  return {
    vivante: r["vivante"] === true,
    id: r["id"] as string,
    pieceId: (r["piece_id"] as string | null) ?? null,
    journal: r["journal"] as string,
    dateEcriture: r["date_ecriture"] as string,
    devise: r["devise"] as string,
    libelle: (r["libelle"] as string) ?? "",
    status: r["status"] as string,
    packVersionId: r["pack_version_id"] as string,
    // Quand la personne a confirmé : la fiche le dit (« confirmé le … »).
    bookedAt: r["booked_at"] == null ? null : new Date(r["booked_at"] as string).toISOString(),
    lines: lignes.get(r["id"] as string) ?? [],
  };
}

type Proposee = Awaited<ReturnType<typeof propositionDePiece>>;

/**
 * L'empreinte d'une proposition : ce que l'écran montre au comptable (journal,
 * date, libellé, devise, pack, lignes), en une chaîne stable. VALIDER inscrit
 * ce qui a été montré, ou refuse : si la lecture ou le jugement a changé
 * entre l'affichage et le geste, la proposition n'est plus la même.
 */
function empreinteDe(r: Proposee): string | null {
  if (!r.ok) return null;
  const { journal, libelle, lignes, pivot } = r.proposition;
  const forme = [
    journal,
    pivot.entry_date,
    libelle,
    pivot.currency,
    r.packVersionId,
    lignes.map((l) => [
      l.account_code,
      l.libelle,
      l.debit,
      l.credit,
      l.tax_code,
      // Une pièce en devise : le cours appliqué fait partie de ce qui est montré.
      l.devise_origine ?? null,
      l.montant_origine ?? null,
      l.taux_de_change ?? null,
      l.cours_id ?? null,
    ]),
  ];
  return createHash("sha256").update(JSON.stringify(forme)).digest("hex");
}

/**
 * Ce que FORCER reçoit du navigateur, relu avant tout usage : une entrée
 * malformée est un refus qui dit quoi corriger, jamais une panne.
 */
const LIGNE_FORCEE = z.object({
  account_code: z.string(),
  libelle: z.string(),
  debit: z.string(),
  credit: z.string(),
  tax_code: z.string().nullable().optional(),
});
/** Un identifiant de pièce, relu avant tout usage. */
const ID = z.string().uuid();

const FORCER = z.object({
  pieceId: z.string().uuid(),
  journal: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  libelle: z.string(),
  lignes: z.array(LIGNE_FORCEE),
  typeDeDocument: z.string().nullable().optional(),
});

/**
 * Un cours tel que l'écran le saisit : un taux décimal positif, en chaîne
 * (jamais un flottant), pour une unité qui est une puissance de dix.
 */
const COURS = z.object({
  taux: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .refine((t) => /[1-9]/.test(t)),
  unite: z
    .number()
    .int()
    .positive()
    .refine((u) => /^10*$/.test(String(u))),
});
const SAISIE_DE_COURS = COURS.extend({
  orgId: z.string().uuid(),
  devise: z.string().regex(/^[A-Z]{3}$/),
  versDevise: z.string().regex(/^[A-Z]{3}$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.string().min(1),
  motif: z.string().nullable().optional(),
  dossierId: z.string().uuid().nullable().optional(),
});
const DEROGATION = z
  .object({ motif: z.string(), portee: z.enum(["dossier", "cabinet"]) })
  .nullable()
  .optional();
/** Combien de cours l'écran des cours lit : les plus récents. Une borne d'écran, pas une règle. */
const COURS_LUS = 200;

/**
 * Un retour en attente que le cabinet prend en charge malgré tout (« rien ne
 * bloque ») est CLOS, et un fait le dit : la carte du retour disparaît, le
 * client lit « Prise en charge » au lieu d'un geste devenu sans objet
 * (reprendre une photo d'une pièce déjà inscrite). Rien si la pièce n'était
 * pas en retour.
 */
async function enRetour(db: Requete, pieceId: string): Promise<boolean> {
  const { rows } = await db.query<{ r: boolean }>(
    `select status = 'retournee' as r from pieces_v where id = app.version_courante($1)`,
    [pieceId],
  );
  return rows[0]?.r === true;
}
async function closLeRetour(db: Requete, pieceId: string, ecritureId: string): Promise<void> {
  await db.query(
    `select public.fait_consigner('piece.retour_clos', app.version_courante($1),
                                  jsonb_build_object('ecriture_id', $2::uuid, 'par_le_cabinet', true))`,
    [pieceId, ecritureId],
  );
}

/**
 * La TVA d'une sélection de pièces : on CHOISIT d'abord les pièces (la
 * requête qui suit `AVEC_LEURS_EXTRAITS` rend `piece_id`, `payload` et ses
 * colonnes propres, que `lusParLaPorte` nomme), puis `app.extraits_de_la_tva` lit toutes les pièces en
 * un appel. Revue de #145 : la porte appelée PAR LIGNE, avant le
 * `distinct on`, coûtait 4,5 s pour 200 pièces contre 0,54 s sans elle.
 *
 * Ce qui reste (mesuré le 31 octobre 2026, 200 pièces dont 40 forcées) :
 * 1,2 s contre 0,41 s pour la sélection nue. L'écart est, pour l'essentiel,
 * les montants du cabinet (`app.montants_pris_en_charge`, #140) : environ
 * 9 ms par pièce FORCÉE, que la vue `pieces_qui_comptent_v` calcule déjà une
 * fois pour dire si l'écriture se lit, et que la porte recalcule pour en
 * lire les lignes. Les figer à la prise en charge, dans une table, a été
 * écarté : leur rangement dépend du paramétrage du cabinet et du dossier
 * (`parametrage.role_bindings`, R10), qui se change APRÈS la prise en charge
 * — une copie figée contredirait la vue, la fiche de la PME et « Vos
 * charges ». Le coût suit les pièces forcées, pas le nombre de pièces.
 */
const AVEC_LEURS_EXTRAITS = "with choisies as (";

/**
 * Les hypothèses du jour d'imputation d'une pièce (`app.jour_d_imputation_tva`,
 * une par exigibilité), et si l'une tombe dans la fenêtre ($2, $3) ; l'option
 * du dossier est $4. `args` : le dossier, la pièce, son jour, son arrivée.
 */
const HYPOTHESES_DU_MOIS = (args: string) => `
           select jsonb_agg(jsonb_build_object('exigibilite', h.exigibilite,
                                               'jour', h.jour::text,
                                               'reserve', h.reserve)) as hypotheses,
                  bool_or(h.jour between $2::date and $3::date) as dans_la_fenetre
             from app.jour_d_imputation_tva(${args}, $4) h`;

/** Le jour retenu d'une ligne lue, par la nature que ses articles disent. */
const jourDuMois = (r: Record<string, unknown>, mois: MoisDeTvaDuDossier) =>
  hypotheseRetenue(
    r["hypotheses"] as HypotheseDuMois[],
    (r["payload"] as { articles?: unknown } | null)?.articles,
    mois.natures,
  );
const lusParLaPorte = (colonnes: string) => `),
       lues as (
         select t.piece_id, t.payload
           from app.extraits_de_la_tva(
                  (select coalesce(jsonb_agg(jsonb_build_object('piece_id', c.piece_id,
                                                                'payload', c.payload)),
                                   '[]'::jsonb)
                     from choisies c)) t
       )
       select ${colonnes}, l.payload
         from choisies c
         join lues l on l.piece_id = c.piece_id
        order by c.piece_id`;

export const office = {
  /**
   * La proposition d'écriture d'une pièce, calculée par le SERVEUR (3B-6) :
   * depuis les montants imprimés et normalisés, seulement si le verdict la
   * déclare comptabilisable. `dateSaisie` complète une date non lue — elle ne
   * remplace jamais une date lue. Son `empreinte` accompagne VALIDER.
   */
  async propositionDePiece(db: Requete, pieceId: string, dateSaisie: string | null = null) {
    // Ouvrir une pièce jugée sous des règles plus anciennes la rejuge, si
    // l'appelant la supervise : quelques requêtes, et aucune ligne si rien ne
    // change (`scan/rejeu.ts`).
    await rejugerALOuverture(db, pieceId);
    const r = await propositionDePiece(db, pieceId, dateSaisie);
    return r.ok ? { ...r, empreinte: empreinteDe(r)! } : r;
  },

  /**
   * REJUGER LES PIÈCES aux règles du jour : celles d'un dossier, ou de tous
   * ceux que l'appelant supervise (le cabinet qui tient le dossier, la
   * société quand elle tient ses livres). N'écrit que des analyses, et
   * seulement quand le jugement change ; ni écriture, ni règlement, ni fait.
   * Par pages, sous un budget : repasser `suite` tant qu'elle n'est pas nulle.
   * `essai` joue tout et n'écrit rien. Voir `scan/rejeu.ts`.
   */
  async rejugerLesPieces(
    db: Requete,
    tenantId: string | null = null,
    apres: string | null = null,
    essai = false,
  ): Promise<BilanDuRejeu> {
    return rejugerLesPieces(db, { tenantId, apres, essai });
  },

  /**
   * Enregistre la proposition que le serveur calcule : aucune ligne ne vient
   * du client. Refuse, avec le motif, ce que `propositionDePiece` refuse.
   */
  async proposerDepuisPiece(
    db: Requete,
    pieceId: string,
    dateSaisie: string | null = null,
  ): Promise<string> {
    await rejugerALOuverture(db, pieceId);
    const r = await propositionDePiece(db, pieceId, dateSaisie);
    if (!r.ok) throw Object.assign(new Error(r.raison), { code: "22023" });
    return office.propose(db, {
      pieceId,
      journal: r.proposition.journal,
      date: r.proposition.pivot.entry_date,
      libelle: r.proposition.libelle,
      packVersionId: r.packVersionId,
      devise: r.proposition.pivot.currency,
      lignes: r.proposition.lignes,
    });
  },

  /**
   * VALIDER — le cabinet prend en charge l'écriture que le Socle propose
   * (« Malica sans blocage », 30 octobre 2026). Le client ne confirme rien.
   *
   * Le verrou R2 attend un type établi par une personne : le cabinet établit
   * le type LU, en son nom et tracé, puis le serveur propose et inscrit — la
   * pièce est prise en charge, « Validée ». Une écriture inscrite AVANT (par
   * le client, quand il confirmait encore) se valide par la revue, qui la
   * prend en charge à son tour. Un appel, une transaction.
   *
   * `empreinte` est celle de la proposition que l'écran a montrée : le
   * serveur n'inscrit que celle-là. Si elle a changé entre-temps, il refuse
   * et l'écran la relit (`refus.proposition.changee`).
   */
  async valider(db: Requete, pieceId: string, empreinte: string | null = null): Promise<string> {
    // D'abord : seul le cabinet du dossier établit le type, donc valide.
    await db.query(`select public.piece_type_etabli_par_le_cabinet($1)`, [pieceId]);
    const vivante = await ecritureVivante(db, pieceId);
    if (vivante?.prise) throw refusMetier("refus.prise_en_charge.deja");
    if (vivante) {
      await db.query(`select public.socle_ecriture_review($1, 'valide')`, [vivante.id]);
      return vivante.id;
    }
    const etaitEnRetour = await enRetour(db, pieceId);
    // Le jugement aux règles et au cours du jour : un cours importé ou
    // corrigé depuis l'affichage le rejuge, et l'empreinte ne tient plus.
    await rejugerALOuverture(db, pieceId);
    const r = await propositionDePiece(db, pieceId, null);
    if (!r.ok) throw refusMetier(r.raison);
    if (empreinte === null || empreinteDe(r) !== empreinte)
      throw refusMetier("refus.proposition.changee");
    /*
     * Un avoir que le numéro imprimé a lié à sa facture : le lien devient un
     * FAIT au moment où l'écriture le prend pour acquis (`avoirs_rattaches`).
     * Une facture du même numéro arrivée ensuite ne le déplace plus.
     */
    if (r.avoir?.facture && !r.avoir.lie)
      await db.query(`select public.avoir_rattacher($1, $2, 'numero')`, [pieceId, r.avoir.facture]);
    const id = await office.propose(db, {
      pieceId,
      journal: r.proposition.journal,
      date: r.proposition.pivot.entry_date,
      libelle: r.proposition.libelle,
      packVersionId: r.packVersionId,
      devise: r.proposition.pivot.currency,
      lignes: r.proposition.lignes,
    });
    await office.book(db, id);
    if (etaitEnRetour) await closLeRetour(db, pieceId, id);
    return id;
  },

  /**
   * RATTACHER LA FACTURE D'ORIGINE d'un avoir (réglage `avoirs.traitement` =
   * `lie_facture`, 1er novembre 2026) : le cabinet qui supervise le dossier
   * la désigne, quand le numéro imprimé sur l'avoir n'en désigne aucune (ou
   * plusieurs). Le lien est un fait, en ajout seul ; le plus récent fait foi.
   * Puis la proposition se relit : l'avoir se propose, ou dit ce qui manque.
   * Une pièce qui porte déjà une écriture vivante ne se rattache plus ici :
   * on force, ce qui contre-passe.
   */
  async rattacherLaFacture(
    db: Requete,
    pieceId: string,
    factureId: string,
  ): Promise<PropositionDePiece> {
    if (!ID.safeParse(pieceId).success || !ID.safeParse(factureId).success)
      throw refusMetier("refus.avoir.saisie");
    if (await ecritureVivante(db, pieceId)) throw refusMetier("refus.avoir.ecriture_vivante");
    await db.query(`select public.avoir_rattacher($1, $2, 'cabinet')`, [pieceId, factureId]);
    return office.propositionDePiece(db, pieceId);
  },

  /**
   * Les factures auxquelles un avoir peut se rattacher : celles du même
   * dossier et du même sens, déjà comptabilisées (une écriture prise en
   * charge), les plus récentes d'abord. Le numéro, la date, l'émetteur et le
   * total, tels que lus.
   */
  async facturesARattacher(db: Requete, pieceId: string): Promise<FactureARattacher[]> {
    const { rows } = await db.query<FactureARattacher>(
      `select f.id, x.payload -> 'references' ->> 'numero' as numero,
              x.payload ->> 'document_date' as date, x.payload ->> 'issuer' as emetteur,
              x.payload -> 'totals' ->> 'ttc' as ttc
         from pieces_v a
         join pieces_v f on f.tenant_id = a.tenant_id and f.document_kind = a.document_kind
         join lateral (select e.payload from capture.extractions e
                        where e.piece_id = f.id order by e.created_at desc limit 1) x on true
        where a.id = app.version_courante($1)
          and f.id = app.version_courante(f.id)
          and f.id not in (select app.versions_de_la_piece($1))
          and app.ecriture_prise_en_charge_de(f.id) is not null
        order by f.created_at desc
        limit 200`,
      [pieceId],
    );
    return rows;
  },

  /**
   * TRANCHER LE SENS — achat ou vente, quand la lecture ne l'a pas dit ou se
   * contredit (décision du dirigeant, 29 octobre 2026 : le comptable décide,
   * jamais la PME, qui ne confirme rien).
   *
   * Le sens est un type qui porte une écriture, établi par le cabinet du
   * dossier (`piece_type_etabli_par_le_cabinet`, lot 5) : une précision datée,
   * à son nom (R7). Puis le Socle rejuge la pièce — le contrôle du sens suit
   * la décision — et la proposition se relit : le comptable la valide, ou
   * force. Une pièce qui porte déjà une écriture vivante ne change plus de
   * sens ici : on force, ce qui contre-passe.
   */
  async trancherLeSens(db: Requete, pieceId: string, sens: string): Promise<{ type: string }> {
    if (await ecritureVivante(db, pieceId)) throw refusMetier("refus.sens.ecriture_vivante");
    const { rows } = await db.query<{ r: { type: string }; lue: boolean }>(
      `select public.piece_type_etabli_par_le_cabinet($1, $2) as r,
              exists (select 1 from extractions_v x where x.piece_id = $1) as lue`,
      [pieceId, sens],
    );
    // Une pièce sans lecture n'a rien à rejuger : son écriture se saisit.
    if (rows[0]!.lue) await analyserPiece(db, pieceId);
    return { type: rows[0]!.r.type };
  },

  /**
   * SAISIR LE COURS d'une pièce en devise, en un geste depuis la pièce
   * (31 octobre 2026) : le cours que son jugement demande — la devise, celle
   * du dossier, le jour et la source de la règle de change —, ou, si le
   * jugement en a trouvé un, sa correction au jour de la règle (R7 : une
   * ligne nouvelle, la plus récente fait foi). Le cours vaut pour l'organisation
   * qui supervise le dossier, donc pour tous ses dossiers. Puis le Socle
   * rejuge la pièce (#143) et rend la proposition du jour.
   *
   * Une pièce dont l'écriture vit ne change plus de cours ici : son écriture
   * porte le sien. On la retourne (contre-passation), puis on saisit.
   *
   * Revue de #148 : un cours SAISI cède devant le cours officiel importé
   * (`ref.rangs_des_cours`). Pour passer devant, ou pour corriger un cours
   * déjà saisi, le cabinet DÉROGE : un motif, et pour qui — ce dossier (le
   * dossier de la pièce), ou tout le cabinet. La base exige le motif.
   */
  async saisirLeCoursDeLaPiece(
    db: Requete,
    pieceId: string,
    taux: string,
    unite: number,
    derogation?: DerogationDeCours | null,
  ): Promise<PropositionDePiece> {
    if (!COURS.safeParse({ taux, unite }).success) throw refusMetier("refus.cours.invalide");
    const d = DEROGATION.safeParse(derogation);
    if (!d.success) throw refusMetier("refus.cours.invalide");
    if (await ecritureVivante(db, pieceId)) throw refusMetier("refus.cours.ecriture_vivante");
    const { rows } = await db.query<{
      preuves: { devise: string; versDevise: string; jour: string | null; source?: string } | null;
      org: string | null;
      dossier: string;
    }>(
      `select p.tenant_id as dossier, (select c -> 'preuves'
                 from capture.analyses a
                 cross join lateral jsonb_array_elements(
                        case when jsonb_typeof(a.controles) = 'array' then a.controles
                             else '[]'::jsonb end) c
                where a.piece_id = p.id and c ->> 'code' = 'cours_de_change'
                  and a.created_at = (select max(y.created_at) from capture.analyses y
                                       where y.piece_id = p.id)
                limit 1) as preuves,
              -- Qui supervise : le cabinet du dossier dont l'appelant est
              -- membre, sinon le dossier lui-même (il tient ses livres).
              coalesce((select g.cabinet_org_id from identity.engagements g
                         where g.pme_org_id = p.tenant_id and g.status = 'actif'
                           and g.cabinet_org_id in (select app.member_orgs())
                         order by g.cabinet_org_id limit 1),
                       p.tenant_id) as org
         from pieces_v p where p.id = app.version_courante($1)`,
      [pieceId],
    );
    const p = rows[0]?.preuves;
    if (!p?.jour || !p.source) throw refusMetier("refus.cours.sans_objet");
    const derogeant = d.data ?? null;
    await db.query(
      `select public.cours_de_change_saisir($1, $2, $3, $4::date, $5, $6, $7, $8, $9)`,
      [
        rows[0]!.org,
        p.devise,
        p.versDevise,
        // Le jour que la règle désigne : un cours trouvé plus tôt (recul) se
        // remplace par celui du jour, qui l'emporte (`app.cours_applicable`).
        p.jour,
        taux,
        unite,
        p.source,
        derogeant?.motif ?? null,
        derogeant?.portee === "dossier" ? rows[0]!.dossier : null,
      ],
    );
    await rejugerLaPiece(db, pieceId);
    return office.propositionDePiece(db, pieceId);
  },

  /**
   * Les cours que l'organisation lit : ceux qu'elle a saisis, et ceux que
   * l'exploitation a importés, du plus récent au plus ancien.
   */
  async coursDeChange(
    db: Requete,
    orgId: string,
    locale = "fr",
  ): Promise<{
    cours: CoursDeChange[];
    sources: Array<{ code: string; nom: string }>;
    devises: string[];
  }> {
    const { rows } = await db.query<{
      id: string;
      devise: string;
      vers_devise: string;
      date: string;
      taux: string;
      unite: number;
      source: string;
      origine: string;
      libelle_origine: string;
      motif: string | null;
      dossier_id: string | null;
      saisi_le: Date;
    }>(
      `select c.id, c.devise, c.vers_devise, to_char(c.date_du_cours, 'YYYY-MM-DD') as date,
              c.taux::text as taux, c.unite, c.source, c.origine,
              coalesce(demandee.value, francais.value, c.origine) as libelle_origine,
              c.motif, c.dossier_id, c.saisi_le
         from parametrage.cours_de_change c
         left join ref_labels_v demandee on demandee.ns = 'origine_du_cours'
              and demandee.key = c.origine and demandee.locale = $3
         left join ref_labels_v francais on francais.ns = 'origine_du_cours'
              and francais.key = c.origine and francais.locale = 'fr'
        where c.tenant_id is null or c.tenant_id = $1
        order by c.date_du_cours desc, c.saisi_le desc
        limit $2`,
      [orgId, COURS_LUS, locale],
    );
    const [{ rows: sources }, { rows: devises }] = await Promise.all([
      db.query<{ code: string; nom: string }>(
        `select code, nom from ref.sources_de_cours order by code collate "C"`,
      ),
      db.query<{ code: string }>(`select code from ref.devises order by code collate "C"`),
    ]);
    return {
      cours: rows.map((r) => ({
        id: r.id,
        devise: r.devise,
        versDevise: r.vers_devise,
        date: r.date,
        taux: r.taux,
        unite: Number(r.unite),
        source: r.source,
        origine: r.origine,
        libelleOrigine: r.libelle_origine,
        motif: r.motif,
        dossierId: r.dossier_id,
        saisiLe: new Date(r.saisi_le).toISOString(),
      })),
      sources,
      devises: devises.map((d) => d.code),
    };
  },

  /**
   * SAISIR UN COURS depuis l'écran des cours du cabinet : la paire, le jour,
   * la source, le taux pour une unité (1, 10, 100…). La base refuse ce qui
   * n'est pas un cours, et qui ne supervise rien (`cours_de_change_saisir`).
   * Un motif en fait une DÉROGATION (pour le cabinet, ou pour `dossierId`),
   * qui passe devant le cours officiel importé.
   */
  async saisirUnCours(
    db: Requete,
    brut: {
      orgId: string;
      devise: string;
      versDevise: string;
      date: string;
      taux: string;
      unite: number;
      source: string;
      motif?: string | null;
      dossierId?: string | null;
    },
  ): Promise<string> {
    const lu = SAISIE_DE_COURS.safeParse(brut);
    if (!lu.success) throw refusMetier("refus.cours.invalide");
    const c = lu.data;
    const { rows } = await db.query<{ id: string }>(
      `select public.cours_de_change_saisir($1, $2, $3, $4::date, $5, $6, $7, $8, $9) as id`,
      [
        c.orgId,
        c.devise,
        c.versDevise,
        c.date,
        c.taux,
        c.unite,
        c.source,
        c.motif ?? null,
        c.dossierId ?? null,
      ],
    );
    return rows[0]!.id;
  },

  /**
   * FORCER — le comptable modifie l'écriture, ou la saisit quand le Socle ne
   * propose rien (spec §4). C'est son acte : la pièce n'est ni retournée ni
   * signalée au client, qui lit « Prise en charge ».
   *
   * Une écriture inscrite ne se modifie pas (R7) : la vivante est
   * contre-passée, la nouvelle inscrite, dans la même transaction — tout passe
   * ou rien n'est écrit. Le fait `ecriture.forcee` dit au journal du jour
   * qu'elle vient du comptable (nom et heure : sa prise en charge).
   *
   * Le pack et la devise viennent de l'écriture remplacée, sinon de la pièce
   * et de son dossier — jamais de l'écran. Le type se précise quand la lecture
   * n'en a reconnu aucun (`typeDeDocument`).
   */
  async forcer(
    db: Requete,
    brut: {
      pieceId: string;
      journal: string;
      date: string;
      libelle: string;
      lignes: LigneSaisie[];
      typeDeDocument?: string | null;
    },
  ): Promise<string> {
    const lu = FORCER.safeParse(brut);
    if (!lu.success) throw refusMetier("refus.ecriture.saisie");
    const input = lu.data;
    await db.query(`select public.piece_type_etabli_par_le_cabinet($1, $2)`, [
      input.pieceId,
      input.typeDeDocument ?? null,
    ]);
    const vivante = await ecritureVivante(db, input.pieceId);
    const etaitEnRetour = await enRetour(db, input.pieceId);
    /*
     * La devise est celle des LIVRES du dossier, toujours (31 octobre 2026).
     * Elle venait de l'écriture remplacée, puis de la devise LUE : une pièce
     * en euros forcée en dinars s'inscrivait « EUR » avec des montants en
     * dinars, et une écriture en euros d'avant #142, forcée pour la corriger,
     * restait en euros. Le comptable saisit dans la devise du dossier ; une
     * pièce en devise se convertit, à la proposition, au cours de la règle.
     */
    const { rows } = await db.query<{ pack: string; devise: string; journal: boolean }>(
      `select coalesce($2::uuid, app.pack_de_la_piece($1)) as pack,
              (select o.currency from organizations_v o
                 join pieces_v p on p.tenant_id = o.id where p.id = $1) as devise,
              exists (select 1 from ref.journals j where j.code = $3) as journal`,
      [input.pieceId, vivante?.pack ?? null, input.journal],
    );
    const contexte = rows[0]!;
    if (!contexte.journal) throw refusMetier("refus.ecriture.journal");
    // L'exposant de la devise des livres, celle de l'écriture (`ref.devises`).
    const decimales = await exposantDeLaDevise(db, contexte.devise);
    const lignes: LigneSaisie[] = input.lignes.map((l) => ({ ...l, tax_code: l.tax_code ?? null }));
    const { defaut } = controlerLaSaisie(lignes, decimales);
    if (defaut) throw refusMetier(`refus.ecriture.${defaut}`);
    // Un code de taxe vient du référentiel du pack, en vigueur à la date de
    // l'écriture : un code inconnu fausserait la TVA déclarée (R4).
    const codes = [...new Set(lignes.map((l) => l.tax_code).filter((c): c is string => !!c))];
    if (codes.length > 0) {
      const { rows: connus } = await db.query<{ code: string }>(
        `select distinct code from ref_tva_rates_v
          where pack_version_id = $1 and code = any($2::text[])
            and valid_from <= $3::date and (valid_to is null or valid_to >= $3::date)`,
        [contexte.pack, codes, input.date],
      );
      if (connus.length !== codes.length) throw refusMetier("refus.ecriture.taxe");
    }
    /*
     * Le taux d'une ligne de TVA se dit, il ne se devine pas (revue de #140) :
     * une facture à deux taux forcée sans codes sortait de la TVA du mois sans
     * un mot. Chaque ligne de TVA porte son code ; une base aussi, dès que
     * l'écriture porte plusieurs taux. La nature d'un compte vient du
     * paramétrage du dossier, du cabinet, puis du pack (`app.nature_des_comptes`).
     */
    const { rows: natures } = await db.query<{ account_code: string; nature: string }>(
      `select n.account_code, n.nature
         from pieces_v p
         cross join lateral app.nature_des_comptes(
           (select g.cabinet_org_id from engagements_v g
              join memberships_v m on m.tenant_id = g.cabinet_org_id and m.user_id = auth.uid()
             where g.pme_org_id = p.tenant_id and g.status = 'actif' limit 1),
           p.tenant_id, $2::uuid, p.document_kind, $3::date, $4::text[]) n
        where p.id = app.version_courante($1)`,
      [input.pieceId, contexte.pack, input.date, [...new Set(lignes.map((l) => l.account_code))]],
    );
    const natureDe = new Map(natures.map((n) => [n.account_code, n.nature]));
    const tva = lignes.filter((l) => natureDe.get(l.account_code) === "tva");
    if (tva.some((l) => !l.tax_code)) throw refusMetier("refus.ecriture.taxe_tva");
    if (
      new Set(tva.map((l) => l.tax_code)).size > 1 &&
      lignes.some((l) => natureDe.get(l.account_code) === "base" && !l.tax_code)
    )
      throw refusMetier("refus.ecriture.taxe_base");
    // Sans ligne de TVA, la base dit son régime (exonérée, export…) : sinon
    // sa base manque à la déclaration (revue de #140, cas J).
    if (
      tva.length === 0 &&
      lignes.some((l) => natureDe.get(l.account_code) === "base" && !l.tax_code)
    )
      throw refusMetier("refus.ecriture.taxe_sans_tva");

    if (vivante) {
      // La contre-passation porte le motif gouverné du forçage (référentiel).
      await db.query(
        `select public.socle_ecriture_contre_passer(
                  $1, (select m.id from ref_rejet_motifs_v m where m.code = 'ecriture_forcee'))`,
        [vivante.id],
      );
    }
    const id = await office.propose(db, {
      pieceId: input.pieceId,
      journal: input.journal,
      date: input.date,
      libelle: input.libelle.trim(),
      packVersionId: contexte.pack,
      devise: contexte.devise,
      lignes: lignes.map(ligneNormalisee),
    });
    await office.book(db, id);
    // Le fait qui dit « forcée » au journal du jour (`app.ecriture_prise_en_charge`).
    await db.query(
      `select public.fait_consigner('ecriture.forcee', id,
                                    jsonb_build_object('piece_id', piece_id, 'remplace', $2::uuid))
         from ecritures_v where id = $1`,
      [id, vivante?.id ?? null],
    );
    if (etaitEnRetour) await closLeRetour(db, input.pieceId, id);
    return id;
  },

  /**
   * Ce que le moyen de paiement engage : l'ecriture du reglement.
   *
   * La facture constate une dette ; le reglement l'eteint. Ce sont DEUX
   * faits, a deux dates, et les confondre empeche tout rapprochement
   * bancaire — une facture de septembre payee en octobre touche la
   * tresorerie en octobre.
   */
  async propositionDeReglement(
    db: Requete,
    paiementId: string,
    qualification?: QualificationDeRetenue,
  ) {
    const r = await propositionDeReglement(db, paiementId, qualificationLue(qualification));
    if (!r.ok) return r;
    // Déjà inscrit ? L'écran le dit et retire le bouton (ANO-006) : la base,
    // elle, rend la même écriture si on redemande.
    const { rows } = await db.query<{
      id: string;
      journal: string;
      date_ecriture: string;
      libelle: string;
      devise: string;
      retenue: ConstatDeRetenue | null;
    }>(
      `select e.id, e.journal, e.date_ecriture::text, e.libelle, e.devise,
              (select a.payload -> 'retenue' from audit.event_log a
                where a.object_id = e.id and a.action = 'reglement.qualifie'
                order by a.at desc limit 1) as retenue
         from ecritures_v e
        where e.paiement_id = $1 and e.nature = 'reglement' and app.ecriture_vivante(e.id)
        limit 1`,
      [paiementId],
    );
    const inscrite = rows[0];
    if (!inscrite) return { ...r, inscrite: null };
    const lignes = (await lignesDe(db, [inscrite.id])).get(inscrite.id) ?? [];
    return {
      ...r,
      inscrite: { ecritureId: inscrite.id },
      retenue: inscrite.retenue ?? { cas: "a_confirmer" as const },
      ecriture: {
        journal: inscrite.journal,
        dateEcriture: inscrite.date_ecriture,
        libelle: inscrite.libelle,
        devise: inscrite.devise,
        lignes: lignes.map((l) => ({
          account_code: l.accountCode,
          libelle: l.libelle,
          debit: l.debit,
          credit: l.credit,
        })),
      },
    };
  },

  /**
   * Inscrire le reglement propose. Rend l'identifiant de l'ecriture.
   *
   * Aucune ligne ne transite par le client : le serveur compose depuis ce
   * qu'il a lui-meme lu, et refuse avec le motif ce que la proposition
   * refuse.
   */
  async proposerLeReglement(
    db: Requete,
    paiementId: string,
    qualification?: QualificationDeRetenue,
  ): Promise<string> {
    // Le verrou de la VERSION COURANTE de la pièce, celui que prend
    // `socle_ecriture_propose` : deux inscriptions d'un même règlement, même
    // saisi sur une photo reprise, passent l'une après l'autre.
    await db.query(
      `select public.pieces_verrouiller(array(select app.version_courante(p.piece_id)
                                                from paiements_v p where p.id = $1))`,
      [paiementId],
    );
    const qualifiee = qualificationLue(qualification);
    const r = await propositionDeReglement(db, paiementId, qualifiee);
    if (!r.ok) throw refusMetier(r.raison);
    // Une écriture inscrite est immuable. Une proposition se recompose depuis
    // les faits courants, sans réutiliser une ancienne inférence fiscale.
    const { rows: deja } = await db.query<{ id: string }>(
      `select id from ecritures_v
        where paiement_id = $1 and nature = 'reglement'
          and app.ecriture_vivante(id)
        order by status = 'booked' desc
        limit 1`,
      [paiementId],
    );
    if (deja[0]) return deja[0].id;
    if (r.ttc === null)
      throw Object.assign(
        new Error("Le montant de la facture doit être confirmé avant inscription du règlement."),
        { code: "22023" },
      );
    if (r.retenue.cas === "a_confirmer")
      throw Object.assign(new Error("Confirmez le traitement de la retenue avant inscription."), {
        code: "22023",
      });
    // Redemander rend la même proposition (ANO-006) : une proposition encore
    // ouverte dont les lignes sont exactement celles d'aujourd'hui est reprise,
    // au lieu d'en empiler une seconde dans la file.
    const { rows: ouvertes } = await db.query<{ id: string }>(
      `select id from ecritures_v
        where paiement_id = $1 and nature = 'reglement' and reverses_id is null
          and status = 'proposee'
        order by created_at desc`,
      [paiementId],
    );
    let reprise: string | undefined;
    if (ouvertes.length > 0) {
      const lignes = await lignesDe(
        db,
        ouvertes.map((o) => o.id),
      );
      reprise = ouvertes.find((o) =>
        memesLignes(
          (lignes.get(o.id) ?? []).map((l) => ({
            account_code: l.accountCode,
            debit: l.debit,
            credit: l.credit,
          })),
          r.ecriture.lignes,
        ),
      )?.id;
    }
    const id =
      reprise ??
      (await office.propose(db, {
        pieceId: r.pieceId,
        journal: r.ecriture.journal,
        date: r.ecriture.dateEcriture,
        libelle: r.ecriture.libelle,
        packVersionId: r.packVersionId,
        devise: r.ecriture.devise,
        lignes: r.ecriture.lignes,
        paiementId,
      }));
    // La qualification du jour est celle que l'inscription relira.
    if (qualifiee)
      await db.query(`select public.fait_consigner('reglement.qualifie', $1, $2::jsonb)`, [
        id,
        JSON.stringify({ paiementId, qualification: qualifiee, retenue: r.retenue }),
      ]);
    return id;
  },

  /**
   * Inscrire le règlement : proposer PUIS comptabiliser, en une transaction
   * (ANO-006, 21 octobre 2026). L'écran n'appelait que la proposition :
   * l'écriture restait « proposée », n'atteignait jamais le FEC, et chaque
   * clic en ajoutait une. Redemander rend l'écriture déjà inscrite.
   */
  async inscrireLeReglement(
    db: Requete,
    paiementId: string,
    qualification?: QualificationDeRetenue,
  ): Promise<string> {
    const id = await office.proposerLeReglement(db, paiementId, qualification);
    const { rows } = await db.query<{ status: string }>(
      `select status from ecritures_v where id = $1`,
      [id],
    );
    if (rows[0]?.status === "proposee") await office.book(db, id);
    return id;
  },

  async propose(
    db: Requete,
    input: {
      pieceId: string;
      journal: string;
      date: string;
      libelle: string;
      packVersionId: string;
      lignes: unknown;
      devise: string;
      /** Le paiement qu'un règlement inscrit ; absent pour la facture. */
      paiementId?: string | null;
    },
  ): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `select public.socle_ecriture_propose($1, $2, $3, $4, $5, $6::jsonb, $7, $8) as id`,
      [
        input.pieceId,
        input.journal,
        input.date,
        input.libelle,
        input.packVersionId,
        JSON.stringify(input.lignes),
        input.devise,
        input.paiementId ?? null,
      ],
    );
    return rows[0]!.id;
  },

  /**
   * Comptabiliser une écriture proposée.
   *
   * Un règlement proposé est recomposé depuis les faits COURANTS avant d'être
   * inscrit (revue du 24 octobre 2026) : une proposition d'hier — l'ancienne
   * retenue devinée, un cumul dépassé depuis par un autre paiement — ne passe
   * plus par le simple bouton « valider ». Les lignes doivent être exactement
   * celles que le moteur rend aujourd'hui avec la qualification conservée.
   * Une contre-passation n'est pas recomposée : elle recopie l'original.
   */
  async book(db: Requete, ecritureId: string): Promise<void> {
    // Le verrou de `socle_ecriture_book` — la pièce de l'écriture et sa
    // version courante, dans l'ordre des identifiants —, pris AVANT que la
    // proposition soit relue : une reprise ou une suppression de la courante
    // attend l'inscription entière, puis la voit.
    //
    // Les deux identifiants sont lus D'ABORD, puis cherchés par la clé : la
    // jointure `pi.id in (e.piece_id, app.version_courante(e.piece_id))`
    // appelait la fonction pour chaque pièce visible sous la RLS — douze
    // secondes par inscription à 1 337 pièces (épreuve de charge, revue de #145).
    await db.query(
      `select public.pieces_verrouiller(
                (select array[e.piece_id, app.version_courante(e.piece_id)]
                   from ecritures_v e where e.id = $1))`,
      [ecritureId],
    );
    const { rows } = await db.query<{
      nature: string;
      reverses_id: string | null;
      paiement_id: string | null;
      status: string;
      qualification: unknown;
    }>(
      `select e.nature, e.reverses_id, e.paiement_id, e.status,
              (select a.payload -> 'qualification' from audit.event_log a
                where a.object_id = e.id and a.action = 'reglement.qualifie'
                order by a.at desc limit 1) as qualification
         from ecritures_v e where e.id = $1`,
      [ecritureId],
    );
    const e = rows[0];
    if (e && e.nature === "reglement" && e.reverses_id === null && e.status === "proposee") {
      if (!e.paiement_id) throw refusMetier("Un règlement sans paiement ne s'inscrit pas.");
      const r = await propositionDeReglement(db, e.paiement_id, qualificationLue(e.qualification));
      if (!r.ok) throw refusMetier(r.raison);
      if (r.retenue.cas === "a_confirmer")
        throw refusMetier("Confirmez le traitement de la retenue avant inscription.");
      const proposees = (await lignesDe(db, [ecritureId])).get(ecritureId) ?? [];
      const attendues = r.ecriture.lignes;
      if (
        !memesLignes(
          proposees.map((l) => ({ account_code: l.accountCode, debit: l.debit, credit: l.credit })),
          attendues,
        )
      )
        throw refusMetier(
          "Cette proposition de règlement ne correspond plus aux faits : proposez-la à nouveau.",
        );
    }
    await db.query(`select public.socle_ecriture_book($1)`, [ecritureId]);
  },

  async ecrituresByIds(db: Requete, ids: string[]) {
    if (ids.length === 0) return [];
    const { rows } = await db.query(
      `select ${COLONNES_ECRITURE}
         from ecritures_v e where id = any($1::uuid[]) order by date_ecriture desc`,
      [ids],
    );
    const lignes = await lignesDe(db, ids);
    return (rows as Record<string, unknown>[]).map((r) => versEcriture(r, lignes));
  },

  async ecrituresForPiece(db: Requete, pieceId: string) {
    const { rows } = await db.query(
      `select ${COLONNES_ECRITURE}
         from ecritures_v e
        -- La pièce, c'est toutes ses versions : un règlement saisi sur une
        -- photo reprise garde son écriture sur l'ancienne.
        where piece_id in (select app.versions_de_la_piece($1))
        order by created_at desc`,
      [pieceId],
    );
    const ids = (rows as Record<string, unknown>[]).map((r) => r["id"] as string);
    if (ids.length === 0) return [];
    const lignes = await lignesDe(db, ids);
    return (rows as Record<string, unknown>[]).map((r) => versEcriture(r, lignes));
  },

  /**
   * Les retenues à la source d'un dossier pour un mois, lues dans ses
   * écritures : opérées (à reverser à l'État) et subies (créances sur l'État).
   */
  async retenuesDuMois(db: Requete, tenantId: string, periode: string) {
    const { rows } = await db.query(
      `select ecriture_id, date_ecriture::text as date_ecriture, ecriture, ligne, compte, sens,
              montant::text as montant, statut
         from public.retenues_du_mois($1, $2::date)`,
      [tenantId, periode],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      ecritureId: r["ecriture_id"] as string,
      dateEcriture: r["date_ecriture"] as string,
      ecriture: r["ecriture"] as string,
      ligne: r["ligne"] as string,
      compte: r["compte"] as string,
      sens: r["sens"] as "operee" | "subie",
      montant: dec(r["montant"]),
      statut: r["statut"] as string,
    }));
  },

  /**
   * Les lignes comptabilisées d'une période, par la fonction du Socle.
   *
   * On n'écrit pas la requête équivalente ici : `socle_periode_lignes` porte
   * la définition de « comptabilisé », et deux définitions concurrentes
   * finiraient par diverger — l'écran dirait un résultat, la balance un autre.
   */
  async periodeLignes(db: Requete, tenantId: string, from: string, to: string) {
    const { rows } = await db.query(
      `select date_ecriture, journal, account_code, debit, credit
         from public.socle_periode_lignes($1, $2, $3)`,
      [tenantId, from, to],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      dateEcriture: r["date_ecriture"] as string,
      journal: r["journal"] as string,
      accountCode: r["account_code"] as string,
      debit: dec(r["debit"]),
      credit: dec(r["credit"]),
    }));
  },

  async bookedExtracts(db: Requete, tenantId: string, from: string, to: string) {
    // Une seule requête là où l'adaptateur en faisait deux puis dédoublonnait
    // en JavaScript : `distinct on` rend la dernière extraction de chaque pièce,
    // ce que la boucle précédente reconstituait à la main.
    //
    // 20 octobre 2026, recette : une facture CONTRE-PASSÉE restait comptée
    // dans la TVA du mois — son écriture d'origine est toujours « booked ».
    // On ne retient que les écritures vivantes : ni contre-passation, ni
    // écriture qu'une contre-passation comptabilisée annule.
    // Le mois de TVA suit l'exigibilité (11 novembre 2026) : l'option du
    // dossier et ses natures, lues une fois pour la fenêtre.
    const mois = await leMoisDeTvaDuDossier(db, tenantId, to);
    const { rows } = await db.query(
      // 3 novembre 2026 : la pièce pèse de ce qui compte dans la TVA
      // (app.extraits_de_la_tva), la même porte que la PME — forcée, les
      // montants du cabinet ; sinon la lecture ; chaque ligne avec sa nature.
      // Elle lisait la LECTURE d'une pièce forcée : la TVA du dossier ne
      // recoupait pas le journal du cabinet. Les pièces se CHOISISSENT
      // d'abord, puis la porte les lit toutes en un appel.
      `${AVEC_LEURS_EXTRAITS}
       select d.piece_id, d.payload, i.hypotheses
         from (
           select distinct on (x.piece_id) x.piece_id, x.payload, e.tenant_id,
                  e.date_ecriture, e.booked_at::date as inscrite_le
             from extractions_v x
             join ecritures_v e on e.piece_id = x.piece_id
            where e.tenant_id = $1
              -- L'écriture de la FACTURE : un règlement inscrit ne fait pas compter
              -- une facture contre-passée (ANO-006, 21 octobre 2026).
              and e.nature = 'piece'
              and e.status = 'booked'
              and e.reverses_id is null
              and not exists (
                select 1 from ecritures_v r
                 where r.reverses_id = e.id and r.status = 'booked'
              )
              and x.contract = 'extract.v1'
            order by x.piece_id, x.created_at desc
         ) d
         -- Le jour d'imputation, la même règle que côté PME
         -- (app.jour_d_imputation_tva) : la date de l'écriture, ou celle où la
         -- TVA devient exigible ; un mois déjà déclaré passe au jour de
         -- l'inscription. Une hypothèse par exigibilité : la nature se
         -- reconnaît ensuite, dans les articles.
         cross join lateral (${HYPOTHESES_DU_MOIS("d.tenant_id, d.piece_id, d.date_ecriture, d.inscrite_le")}) i
        where i.dans_la_fenetre
       ${lusParLaPorte("c.piece_id, c.hypotheses")}`,
      [tenantId, from, to, mois.regle],
    );
    // Une pièce en devise, au cours de son jugement (`en-devise-du-dossier.ts`).
    return extraitsEnDeviseDuDossier(
      db,
      (rows as Record<string, unknown>[])
        .filter((r) => dansLaFenetre(jourDuMois(r, mois).jour, from, to))
        .map((r) => ({
          pieceId: r["piece_id"] as string,
          extract: r["payload"],
        })),
    );
  },

  /**
   * Les lectures des pièces TRANSMISES imputées à la fenêtre, avec leur date d'envoi.
   *
   * 25 OCTOBRE 2026 — la règle change (décision de Wissem sur l'audit) : une
   * pièce transmise pèse dans le mois de son ÉCRITURE, comme chez le cabinet,
   * et non plus dans celui de sa transmission ; seule une pièce arrivée après
   * la déclaration de son mois passe au mois de sa transmission (report, art. 9
   * du Code de la TVA). Les deux écrans ne peuvent plus diverger. L'historique
   * ci-dessous reste pour comprendre d'où l'on vient.
   *
   * ================================================================= POURQUOI
   *
   * Décision du commanditaire, 10 octobre 2026 : « le calcul de TVA dans le
   * dashboard serait imputé à la date de transmission au comptable, car le
   * comptable est censé la déclarer dans le mois courant ».
   *
   * C'est la réponse à une contradiction qu'il voyait depuis le 5 octobre :
   * « Vos charges » affichait 514,700 et « Votre TVA » zéro, pour le même
   * mois. Les deux avaient raison — l'un lisait les pièces LUES, l'autre les
   * pièces COMPTABILISÉES — et aucun ne disait lequel.
   *
   * Sa règle tranche, et elle est juste pour une raison simple : une TVA se
   * récupère sur une déclaration, une déclaration est déposée par le cabinet,
   * et le cabinet ne peut déclarer que ce qu'il a reçu. Une pièce gardée au
   * coffre n'entre dans aucune déclaration, et doit donc peser zéro.
   *
   * ================================= POURQUOI CETTE MÉTHODE, ET PAS `bookedExtracts`
   *
   * `bookedExtracts` sélectionne sur la date d'ÉCRITURE et sert au cabinet —
   * c'est son journal, et il a raison de le voir ainsi. Les deux lectures
   * coexistent, chacune nommée, et chaque écran dit laquelle il emploie :
   * c'est cette mention, et non la règle, qui empêche deux chiffres de se
   * contredire en silence.
   *
   * Noter ce que `bookedExtracts` faisait, et qui était incohérent : il
   * sélectionnait par date d'écriture puis l'appelant regroupait par date de
   * DOCUMENT. Une facture de février comptabilisée en octobre était donc
   * retenue, puis rangée en février — dans un mois que la fenêtre n'avait pas
   * demandé.
   *
   * ============================================ CE QU'UNE DATE NULLE VEUT DIRE
   *
   * Les pièces transmises avant le 11 octobre n'ont pas de date d'envoi : la
   * transmission n'était qu'un drapeau. Elles ne sont dans aucune fenêtre, et
   * c'est voulu — leur donner la date du jour les ferait toutes entrer dans la
   * déclaration du mois courant, ce qui serait faux et invisible. L'écran les
   * nomme à part.
   */
  async extraitsTransmis(db: Requete, tenantId: string, from: string, to: string) {
    // Le mois de TVA suit l'exigibilité (11 novembre 2026), comme au cabinet.
    const mois = await leMoisDeTvaDuDossier(db, tenantId, to);
    const { rows } = await db.query(
      // Forcée, la pièce pèse de ce que le CABINET a inscrit (1er novembre
      // 2026) : ses lignes, ses droits, ses totaux, la date et le sens de son
      // écriture. Validée, ou avant, de sa lecture. Chaque ligne porte sa
      // nature (3 novembre 2026). Une seule porte, la même que le cabinet
      // (bookedExtracts), appelée une fois pour toutes les pièces choisies.
      `${AVEC_LEURS_EXTRAITS}
       select d.piece_id, d.payload, d.transmise_le, i.hypotheses
         from (
           select distinct on (x.piece_id)
                  x.piece_id, x.payload, p.tenant_id, p.transmise_le,
                  -- Son écriture vivante, si le cabinet l'a déjà inscrite : sa
                  -- date est la date de la facture. Pas encore inscrite
                  -- (confirmée, chez le cabinet), c'est la date du document.
                  coalesce(e.date_ecriture,
                           case when x.payload ->> 'document_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                                then (x.payload ->> 'document_date')::date end,
                           p.transmise_le::date) as jour
             from extractions_v x
             -- La pièce qui compte (ANO-005) : confirmée, dans la société, sans
             -- doublon, d'un type qui porte écriture. Retournée par le cabinet,
             -- elle n'y est pas tant qu'elle n'est pas reprise ; transmise sans
             -- avoir été confirmée, non plus.
             join pieces_qui_comptent_v p on p.id = x.piece_id
             left join lateral (
               select e.date_ecriture
                 from ecritures_v e
                where e.piece_id = p.id
                  and e.nature = 'piece' and e.status = 'booked'
                  and e.reverses_id is null
                  and not exists (select 1 from ecritures_v r
                                   where r.reverses_id = e.id and r.status = 'booked')
                order by e.created_at desc
                limit 1
             ) e on true
            where p.tenant_id = $1
              and p.transmise_le is not null
              and x.contract = 'extract.v1'
            order by x.piece_id, x.created_at desc
         ) d
         -- 25 octobre 2026 : le mois de l'ÉCRITURE (la date de la facture),
         -- et non plus celui de la transmission — sauf mois déjà déclaré, où
         -- la pièce passe au jour de sa transmission. 11 novembre 2026 : ou
         -- le mois où la TVA devient exigible. Une seule règle pour les deux
         -- côtés (app.jour_d_imputation_tva).
         cross join lateral (${HYPOTHESES_DU_MOIS("d.tenant_id, d.piece_id, d.jour, d.transmise_le::date")}) i
        where i.dans_la_fenetre
       ${lusParLaPorte("c.piece_id, c.transmise_le, c.hypotheses")}`,
      [tenantId, from, to, mois.regle],
    );
    // Une pièce en devise, au cours de son jugement (`en-devise-du-dossier.ts`).
    return extraitsEnDeviseDuDossier(
      db,
      (rows as Record<string, unknown>[]).flatMap((r) => {
        /** Le jour où la pièce pèse dans la TVA (app.jour_d_imputation_tva). */
        const { jour } = jourDuMois(r, mois);
        return dansLaFenetre(jour, from, to)
          ? [
              {
                pieceId: r["piece_id"] as string,
                extract: r["payload"],
                transmiseLe: (r["transmise_le"] as Date).toISOString().slice(0, 10),
                imputeeLe: jour,
              },
            ]
          : [];
      }),
    );
  },

  /**
   * Combien de pièces sont parties au cabinet sans qu'on sache quand.
   *
   * Elles ne pèsent dans aucune déclaration, et il faut pouvoir le dire :
   * une pièce qui disparaît des totaux sans que rien ne la nomme est pire
   * qu'une pièce mal rangée.
   */
  async transmisesSansDate(db: Requete, tenantId: string): Promise<number> {
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from pieces_v
        where tenant_id = $1 and vis = 'partage' and transmise_le is null
          and remplacee_par is null`,
      [tenantId],
    );
    return Number(rows[0]?.n ?? 0);
  },
};
