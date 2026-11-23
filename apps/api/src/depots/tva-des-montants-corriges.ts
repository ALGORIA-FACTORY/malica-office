/**
 * La TVA du mois lit les montants que la personne a corrigés au crayon.
 *
 * ================================================================= POURQUOI
 *
 * Pilote, 23 novembre 2026 (le dirigeant : « tout doit être cohérent, juste ») : une TVA
 * corrigée au crayon (lue 2 350, dite 2 850) tenait sur la fiche et dans le jugement, mais
 * la carte de TVA et la déclaration additionnaient encore la TVA LUE : `app.extraits_de_la_tva`
 * reçoit le payload de la lecture, que les précisions ne touchent pas (R7).
 *
 * Ici, une seule règle, celle du jugement (`appliquerLesPrecisions`) : le pied, les droits
 * et les articles corrigés remplacent ce qui avait été lu. Une facture à un seul taux porte
 * sa base ET sa TVA corrigées sur sa ligne — ce que le moteur de TVA additionne. Une pièce
 * prise en charge par le cabinet pèse déjà de ses montants (`montants_pris_en_charge`) : elle
 * n'est pas touchée. Une facture à plusieurs taux garde ses lignes lues : une TVA totale
 * corrigée ne dit pas à quel taux elle se répartit.
 */
import type { Requete } from "../db.ts";
import { appliquerLesPrecisions, type PrecisionDeLecture } from "../scan/precisions-de-lecture.ts";

interface LignePrecisable {
  base_ht?: string | null;
  vat_amount?: string | null;
}

type Payload = Parameters<typeof appliquerLesPrecisions>[0] & { lines?: LignePrecisable[] };

/** Les extraits, chacun avec les précisions de la personne quand la lecture fait foi. */
export async function avecLesMontantsCorriges<T extends { pieceId: string; extract: unknown }>(
  db: Requete,
  lignes: readonly T[],
): Promise<T[]> {
  if (lignes.length === 0) return [...lignes];
  const { rows } = await db.query<{ piece_id: string; champ: string; valeur: string }>(
    `with dites as (
       select distinct on (d.piece_id, d.champ) d.piece_id, d.champ, d.valeur
         from precisions_v d
        where d.piece_id = any($1::uuid[]) and app.est_un_champ_de_lecture(d.champ)
        order by d.piece_id, d.champ, d.decided_at desc
     ),
     -- Prise en charge lisible : les montants du cabinet font foi, pas la lecture.
     forcees as (
       select p.piece_id
         from (select distinct piece_id from dites) p
        where coalesce((app.montants_pris_en_charge(p.piece_id) ->> 'lisible')::boolean, false)
     )
     select d.piece_id, d.champ, d.valeur from dites d
      where d.piece_id not in (select piece_id from forcees)`,
    [lignes.map((l) => l.pieceId)],
  );
  if (rows.length === 0) return [...lignes];
  const parPiece = new Map<string, PrecisionDeLecture[]>();
  for (const r of rows) {
    const cle = r.piece_id.toLowerCase();
    parPiece.set(cle, [...(parPiece.get(cle) ?? []), { champ: r.champ, valeur: r.valeur }]);
  }
  return lignes.map((l) => {
    const dites = parPiece.get(l.pieceId.toLowerCase());
    const lu = l.extract as Payload | null;
    if (!dites || !lu) return l;
    // Le texte imprimé n'est pas lu ici : la forme de la devise ne sert pas.
    const { payload } = appliquerLesPrecisions(lu, () => null, dites, {
      decimales: 0,
      separateur: ".",
    });
    const tva = dites.find((d) => d.champ === "totals.vat")?.valeur;
    const corrige: Payload =
      tva !== undefined && payload.lines?.length === 1
        ? { ...payload, lines: [{ ...payload.lines[0], vat_amount: tva }] }
        : payload;
    return { ...l, extract: corrige };
  });
}
