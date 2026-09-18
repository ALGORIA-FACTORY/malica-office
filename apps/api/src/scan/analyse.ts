/**
 * 3B — Juger une pièce lue, côté serveur.
 *
 * Relit ce que la base porte — la dernière lecture, les jetons cités, le
 * paramétrage daté —, normalise les montants depuis le texte IMPRIMÉ, contrôle,
 * rend le verdict, et le pose dans `capture.analyses` (append-only : le dernier
 * passage fait foi).
 *
 * Tout passe par la connexion de l'appelant : ce que la RLS ne lui montre pas
 * n'existe pas ici, et une pièce d'un autre tenant répond comme une pièce qui
 * n'existe nulle part (D29).
 *
 * ============================================================== LE TEXTE IMPRIMÉ
 *
 * Les montants de l'extraction (« 1234.560 ») sont déjà passés par le solveur
 * de la lecture. La normalisation repart de ce que la pièce IMPRIME : les
 * jetons cités pour chaque champ, réassemblés dans leur ordre de lecture. C'est
 * ce qui règle le piège des montants coupés en deux jetons (« 1 » et
 * « 234,560 ») : ils se réunissent ici, par leurs citations.
 *
 * ============================================================== LA DATE QUI FAIT FOI
 *
 * Taux, seuils et pack se lisent à la date de la PIÈCE — à défaut, à sa date
 * de réception —, jamais à la date du jour.
 */

import type { Requete } from "../db.ts";

import {
  controlerPiece,
  rendreVerdict,
  type ContexteControle,
  type PieceAControler,
  type ResultatControle,
} from "./controles.ts";
import { normaliserMontants, type ResultatNormalisation } from "./normaliser-montants.ts";

/** Une règle métier qui refuse : son message va jusqu'à l'appelant. */
const refus = (message: string) => Object.assign(new Error(message), { code: "22023" });

const PARAMETRES = [
  "money.decimals",
  "lecture.confiance_reserve",
  "lecture.confiance_bloquante",
  "lecture.tolerance_arrondi_mineure",
] as const;

/** La bande du haut de la première page, où s'imprime le titre du document. */
const HAUT_DE_PAGE = 0.25;

export interface Analyse {
  id: string;
  verdict: string;
  motifs: Array<Pick<ResultatControle, "code" | "statut" | "motif">>;
  controles: ResultatControle[];
  normalisation: ResultatNormalisation;
}

export async function analyserPiece(db: Requete, pieceId: string): Promise<Analyse> {
  const { rows: pieces } = await db.query<{
    tenant_id: string;
    doublon_de: string | null;
    recue_le: string;
  }>(
    `select tenant_id, doublon_de, to_char(created_at, 'YYYY-MM-DD') as recue_le
       from capture.pieces where id = $1`,
    [pieceId],
  );
  const piece = pieces[0];
  if (!piece) throw new Error("piece.introuvable");

  const { rows: extractions } = await db.query<{
    id: string;
    payload: Record<string, unknown>;
    confiance_par_champ: Record<string, number>;
  }>(
    `select id, payload, confiance_par_champ from capture.extractions
      where piece_id = $1 order by created_at desc limit 1`,
    [pieceId],
  );
  const extraction = extractions[0];
  if (!extraction) throw refus("Cette pièce n'a pas encore été lue : il n'y a rien à juger.");
  const payload = extraction.payload as {
    issuer?: string | null;
    document_date?: string | null;
    document_kind?: string | null;
    lines?: Array<{ tax_code?: string | null }>;
    other_charges?: unknown[];
    references?: Record<string, string>;
  };

  const { rows: orgs } = await db.query<{
    name: string;
    legal_id: string | null;
    jurisdiction: string;
  }>(`select name, legal_id, jurisdiction from identity.organizations where id = $1`, [
    piece.tenant_id,
  ]);
  const org = orgs[0];
  if (!org) throw new Error("piece.introuvable");

  const datePiece =
    payload.document_date && /^\d{4}-\d{2}-\d{2}$/.test(payload.document_date)
      ? payload.document_date
      : null;
  const dateRef = datePiece ?? piece.recue_le;

  const { rows: packs } = await db.query<{ id: string }>(
    `select id from ref.jurisdiction_packs
      where jurisdiction = $1 and effective_from <= $2::date
      order by effective_from desc limit 1`,
    [org.jurisdiction, dateRef],
  );
  const pack = packs[0]?.id;
  if (!pack) throw refus(`Aucun pack en vigueur pour ${org.jurisdiction} au ${dateRef}.`);

  // Le paramétrage daté. Un paramètre absent est une erreur, jamais un défaut.
  const { rows: params } = await db.query<{ code: string; value_num: string }>(
    `select distinct on (code) code, value_num from ref.socle_params
      where pack_version_id = $1 and code = any($2) and valid_from <= $3::date
        and (valid_to is null or valid_to >= $3::date)
      order by code, valid_from desc`,
    [pack, PARAMETRES, dateRef],
  );
  const p = Object.fromEntries(params.map((r) => [r.code, Number(r.value_num)]));
  const manquant = PARAMETRES.find((c) => !(c in p));
  if (manquant) throw refus(`Paramètre « ${manquant} » absent du paramétrage au ${dateRef}.`);

  // Le texte imprimé de chaque champ cité, jetons réassemblés dans l'ordre.
  const { rows: cites } = await db.query<{ field: string; text: string }>(
    `select c.field, t.text
       from capture.citations c join capture.token_plan t on t.id = c.token_id
      where c.piece_id = $1
      order by c.field, t.page, t.ordinal`,
    [pieceId],
  );
  const imprime = new Map<string, string[]>();
  for (const c of cites) imprime.set(c.field, [...(imprime.get(c.field) ?? []), c.text]);
  const brut = (champ: string) => imprime.get(champ)?.join(" ") ?? null;

  const { rows: haut } = await db.query<{ text: string }>(
    `select text from capture.token_plan
      where piece_id = $1 and page = (select min(page) from capture.token_plan where piece_id = $1)
        and y0 <= $2
      order by y0, x0`,
    [pieceId, HAUT_DE_PAGE],
  );
  const titre = haut.length > 0 ? haut.map((t) => t.text).join(" ") : null;

  // Les taux, par code, en vigueur à la date de la pièce.
  const lignes = payload.lines ?? [];
  const codes = [...new Set(lignes.map((l) => l.tax_code).filter((c): c is string => Boolean(c)))];
  const { rows: taux } = await db.query<{ code: string; rate: string }>(
    `select distinct on (code) code, rate from ref.tva_rates
      where pack_version_id = $1 and code = any($2) and valid_from <= $3::date
        and (valid_to is null or valid_to >= $3::date)
      order by code, valid_from desc`,
    [pack, codes, dateRef],
  );
  const tauxDe = new Map(taux.map((t) => [t.code, t.rate]));

  // Les droits fixés par le paramétrage (le droit de timbre…) : leur valeur
  // attendue ancre l'échelle des montants quand l'égalité la laisse ouverte.
  const droits = (payload.other_charges ?? []) as Array<{ code?: string | null }>;
  const codesDroits = [
    ...new Set(droits.map((d) => d.code).filter((c): c is string => Boolean(c))),
  ];
  const { rows: fixes } = await db.query<{ code: string; fixed_amount: string | null }>(
    `select distinct on (code) code, fixed_amount from ref.fiscal_charges
      where pack_version_id = $1 and code = any($2)
        and (document_kind = $3 or document_kind is null)
        and valid_from <= $4::date and (valid_to is null or valid_to >= $4::date)
      order by code, document_kind nulls last, valid_from desc`,
    [pack, codesDroits, payload.document_kind ?? null, dateRef],
  );
  const echelleMineure = 10 ** p["money.decimals"]!;
  const fixeDe = new Map(
    fixes
      .filter((f) => f.fixed_amount !== null)
      .map((f) => [f.code, Math.round(Number(f.fixed_amount) * echelleMineure)]),
  );

  const nbAutres = droits.length;
  const sansTaux = lignes.find((l) => !l.tax_code || !tauxDe.has(l.tax_code));
  const normalisation: ResultatNormalisation =
    lignes.length === 0 || sansTaux
      ? {
          etat: "illisible",
          montants: {
            bases: lignes.map(() => ({ ht: null, taux: "" })),
            tva: null,
            autres: Array.from({ length: nbAutres }, () => null),
            ttc: null,
          },
          confiance: 0,
          conventions: [],
          lecturesValides: 0,
          raison:
            lignes.length === 0
              ? "aucune base par taux n'a été lue"
              : `taux « ${sansTaux?.tax_code ?? "—"} » inconnu du paramétrage au ${dateRef}`,
        }
      : normaliserMontants(
          {
            bases: lignes.map((l, i) => ({
              ht:
                brut(`lines[${i}].base_ht`) ??
                (lignes.length === 1 ? brut("totals.base_ht") : null),
              taux: tauxDe.get(l.tax_code!)!,
            })),
            tva: brut("totals.vat"),
            autres: droits.flatMap((d, i) => {
              const b = brut(`other_charges[${i}].amount`);
              if (b === null) return [];
              const attendu = d.code ? fixeDe.get(d.code) : undefined;
              return [attendu === undefined ? b : { brut: b, attendu }];
            }),
            ttc: brut("totals.ttc"),
          },
          {
            decimales: p["money.decimals"]!,
            toleranceMineure: p["lecture.tolerance_arrondi_mineure"]!,
          },
        );

  const refs = payload.references ?? {};
  const aControler: PieceAControler = {
    documentKind: payload.document_kind ?? null,
    titre,
    emetteur: { nom: payload.issuer || null, identifiantFiscal: refs["matricule_fiscal"] ?? null },
    destinataire: { nom: null, identifiantFiscal: refs["matricule_fiscal_client"] ?? null },
    numero: refs["numero"] ?? null,
    date: datePiece,
    montants: normalisation,
    confianceParChamp: extraction.confiance_par_champ ?? {},
    reception: { doublonDe: piece.doublon_de, recueLe: piece.recue_le },
  };

  const [{ rows: types }, { rows: mentions }, { rows: autres }] = await Promise.all([
    db.query<{ code: string; porte_ecriture: boolean }>(
      `select code, porte_ecriture from ref.document_types`,
    ),
    db.query<{ code: string; label: string }>(
      `select code, label from ref.mentions where pack_version_id = $1 and mandatory`,
      [pack],
    ),
    db.query<{ id: string; mf: string | null; numero: string | null }>(
      `select p.id, e.payload->'references'->>'matricule_fiscal' as mf,
              e.payload->'references'->>'numero' as numero
         from capture.pieces p
         join lateral (select payload from capture.extractions x
                        where x.piece_id = p.id order by created_at desc limit 1) e on true
        where p.tenant_id = $1 and p.id <> $2`,
      [piece.tenant_id, pieceId],
    ),
  ]);

  const contexte: ContexteControle = {
    tenant: { nom: org.name, identifiantFiscal: org.legal_id },
    typesDocument: types.map((t) => ({ code: t.code, porteEcriture: t.porte_ecriture })),
    mentionsObligatoires: mentions.map((m) => ({ code: m.code, libelle: m.label })),
    seuilConfianceReserve: p["lecture.confiance_reserve"]!,
    seuilConfianceBloquant: p["lecture.confiance_bloquante"]!,
    autresPieces: autres.map((a) => ({
      id: a.id,
      emetteurIdentifiantFiscal: a.mf,
      numero: a.numero,
    })),
  };

  const controles = controlerPiece(aControler, contexte);
  const { verdict, motifs } = rendreVerdict(controles);

  const { rows: poses } = await db.query<{ id: string }>(
    `insert into capture.analyses (tenant_id, piece_id, extraction_id, pack_version_id,
                                   normalisation, controles, verdict, motifs)
     values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8::jsonb)
     returning id`,
    [
      piece.tenant_id,
      pieceId,
      extraction.id,
      pack,
      JSON.stringify(normalisation),
      JSON.stringify(controles),
      verdict,
      JSON.stringify(motifs),
    ],
  );

  return { id: poses[0]!.id, verdict, motifs, controles, normalisation };
}
