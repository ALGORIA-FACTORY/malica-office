/**
 * Les chiffres d'une pièce en devise, dans la devise du dossier (31 octobre 2026).
 *
 * ================================================================= POURQUOI
 *
 * La TVA du mois, la synthèse du cabinet, « Vos charges » additionnaient les
 * montants LUS de chaque pièce sans regarder leur devise : 190,00 € de TVA
 * comptaient 190,000 DT. Une pièce en devise y entre désormais convertie, au
 * cours que son JUGEMENT a lu (le contrôle `cours_de_change`, `scan/
 * controles.ts`) — celui-là même qui convertit son écriture, par le même
 * moteur du Socle (`convertirLExtrait`, `convertirUnMontant`). Rien n'est
 * converti ailleurs.
 *
 * Sans cours, rien n'est converti, et rien n'est tu : l'extrait reste dans sa
 * devise et le calcul de la TVA le refuse en le nommant
 * (`EXTRAIT_EN_DEVISE`) ; un article de charge sort du total et se compte à
 * part (`charges.enAttenteDeCours`).
 */
import { ExtractV1 } from "@malica/socle/contracts/extract.v1";
import {
  aSaDette,
  ConversionRefusee,
  convertirLExtrait,
  convertirUnMontant,
  type ConversionDemandee,
} from "@malica/socle/engines/fx/convertir-l-extrait";
import { CONVERSION_REFUSEE } from "@malica/socle/engines/tva/des-extraits";

import type { Requete } from "../db.ts";
import { lireLesDevises } from "../scan/analyse.ts";

/** Ce que le contrôle `cours_de_change` d'un jugement garde d'un cours appliqué. */
interface CoursDuJugement {
  devise: string;
  versDevise: string;
  ecart: string;
  cours: { id: string; date: string; source: string; taux: string; unite: number };
}

/**
 * La conversion de chaque pièce en devise, au cours qui fait foi pour elle :
 *
 *   — INSCRITE (son écriture de facture vivante porte un cours) : le cours de
 *     son écriture, par le jugement qui l'a lu. Le journal a parlé ; un cours
 *     importé ou une règle changée après coup ne la fait pas sortir de la TVA
 *     (revue de #148 : une pièce inscrite au cours saisi, puis l'import du
 *     jour arrivé, restait « en attente de cours » pour toujours — une pièce
 *     inscrite ne se rejuge pas) ;
 *   — pas encore inscrite : le cours de son DERNIER jugement, s'il est À JOUR ;
 *     un jugement périmé attend d'être rejugé, la pièce attend son cours.
 *
 * Une pièce sans cours n'y est pas.
 */
export async function conversionsDesPieces(
  db: Requete,
  pieceIds: readonly string[],
): Promise<Map<string, ConversionDemandee>> {
  if (pieceIds.length === 0) return new Map();
  const [{ rows }, devises] = await Promise.all([
    db.query<{ piece_id: string; preuves: CoursDuJugement }>(
      `select x.piece_id, c -> 'preuves' as preuves
         from unnest($1::uuid[]) as x(piece_id)
         left join lateral (
           select l.cours_id
             from ecritures_v e
             join ecriture_lignes_v l on l.ecriture_id = e.id
            where e.piece_id = x.piece_id
              and e.nature = 'piece' and e.status = 'booked' and e.reverses_id is null
              and not exists (select 1 from ecritures_v r
                               where r.reverses_id = e.id and r.status = 'booked')
              and l.cours_id is not null
            limit 1
         ) inscrite on true
         cross join lateral (
           select a.controles, a.tenant_id
             from capture.analyses a
            where a.piece_id = x.piece_id
              and (inscrite.cours_id is null
                   or exists (select 1 from jsonb_array_elements(
                                case when jsonb_typeof(a.controles) = 'array' then a.controles
                                     else '[]'::jsonb end) k
                               where k ->> 'code' = 'cours_de_change'
                                 and k -> 'preuves' -> 'cours' ->> 'id' = inscrite.cours_id::text))
            order by a.created_at desc
            limit 1
         ) a
         cross join lateral jsonb_array_elements(
                case when jsonb_typeof(a.controles) = 'array' then a.controles
                     else '[]'::jsonb end) c
        where c ->> 'code' = 'cours_de_change' and c ->> 'statut' = 'reserve'
          and (inscrite.cours_id is not null
               or app.cours_du_jugement_a_jour(a.tenant_id, a.controles))`,
      [[...new Set(pieceIds)]],
    ),
    lireLesDevises(db),
  ]);
  const exposant = (code: string) => {
    const d = devises.find((x) => x.code === code);
    if (!d) throw new Error(`devise inconnue du référentiel : ${code}`);
    return d.decimales;
  };
  return new Map(
    rows.map((r) => [
      r.piece_id,
      {
        de: { code: r.preuves.devise, decimals: exposant(r.preuves.devise) },
        vers: { code: r.preuves.versDevise, decimals: exposant(r.preuves.versDevise) },
        cours: {
          id: r.preuves.cours.id,
          date: r.preuves.cours.date,
          source: r.preuves.cours.source,
          taux: r.preuves.cours.taux,
          unite: r.preuves.cours.unite,
        },
        ecart: r.preuves.ecart,
      },
    ]),
  );
}

/**
 * Les extraits d'une sélection de pièces, chacun dans la devise du dossier
 * quand son jugement a lu un cours. Un extrait déjà dans la devise du
 * dossier, illisible, ou sans cours, est rendu tel quel : le calcul de la TVA
 * le compte ou le refuse en le nommant (`tvaDesExtraits`).
 *
 * Une conversion que le Socle refuse (une facture qui ne tient pas dans sa
 * devise, un écart hors de sa borne) ne fait pas tomber la lecture du mois :
 * la pièce y reste, avec `refus` (`CONVERSION_REFUSEE:<raison>`), et le
 * calcul l'écarte en la nommant. Toute autre erreur remonte.
 */
export async function extraitsEnDeviseDuDossier<T extends { pieceId: string; extract: unknown }>(
  db: Requete,
  lignes: readonly T[],
): Promise<Array<T & { refus?: string }>> {
  const enDevise = lignes.filter((l) => {
    const devise = (l.extract as { currency?: unknown } | null)?.currency;
    return typeof devise === "string";
  });
  const conversions = await conversionsDesPieces(
    db,
    enDevise.map((l) => l.pieceId),
  );
  return lignes.map((l) => {
    const c = conversions.get(l.pieceId);
    const lu = c ? ExtractV1.safeParse(l.extract) : null;
    if (!c || !lu?.success || lu.data.currency !== c.de.code) return l;
    try {
      return { ...l, extract: convertirLExtrait(aSaDette(lu.data, c.de.decimals), c).extrait };
    } catch (e) {
      if (!(e instanceof ConversionRefusee)) throw e;
      return { ...l, refus: `${CONVERSION_REFUSEE}:${e.raison}` };
    }
  });
}

/** Un montant d'article, converti ; nul reste nul. */
export function montantConverti(montant: string | null, c: ConversionDemandee): string | null {
  return montant === null ? null : convertirUnMontant(montant, c);
}
