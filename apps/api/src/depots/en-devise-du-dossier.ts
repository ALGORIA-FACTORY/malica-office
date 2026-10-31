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
  convertirLExtrait,
  convertirUnMontant,
  type ConversionDemandee,
} from "@malica/socle/engines/fx/convertir-l-extrait";

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
 * La conversion de chaque pièce en devise dont le DERNIER jugement a lu un
 * cours : pièce → conversion prête pour le Socle. Une pièce sans cours n'y
 * est pas.
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
         cross join lateral (select a.controles from capture.analyses a
                              where a.piece_id = x.piece_id
                              order by a.created_at desc limit 1) a
         cross join lateral jsonb_array_elements(
                case when jsonb_typeof(a.controles) = 'array' then a.controles
                     else '[]'::jsonb end) c
        where c ->> 'code' = 'cours_de_change' and c ->> 'statut' = 'reserve'`,
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
 */
export async function extraitsEnDeviseDuDossier<T extends { pieceId: string; extract: unknown }>(
  db: Requete,
  lignes: readonly T[],
): Promise<T[]> {
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
    return { ...l, extract: convertirLExtrait(lu.data, c).extrait };
  });
}

/** Un montant d'article, converti ; nul reste nul. */
export function montantConverti(montant: string | null, c: ConversionDemandee): string | null {
  return montant === null ? null : convertirUnMontant(montant, c);
}
