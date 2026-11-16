/**
 * Une organisation d'essai, créée comme un client la crée.
 *
 * Décision du dirigeant (15 et 16 novembre 2026, 20261228110000) : une offre
 * à une société (Basic, Solo, Team) n'en accueille pas une seconde ; la porte
 * `create_organization` refuse (`refus.organisation.offre_multisociete_requise`).
 * Au-delà de ce que l'offre comprend, la société se paie en plus, sur accord.
 *
 * Les épreuves qui donnent plusieurs sociétés à une même personne font ce que
 * ferait ce client : avant une société de plus, elles montent d'offre par la
 * vraie porte (`forfait_changer`) vers la moins chère qui en accueille
 * plusieurs — la grille le dit (`mes_offres`, R4), rien n'est écrit ici — puis
 * cochent l'accord. Une première société, ou un cabinet, se crée comme avant.
 *
 * `db` est déjà placé sous l'identité de la personne qui crée ; `args` sont les
 * arguments de `create_organization` tels que l'épreuve les écrivait, l'accord
 * est ajouté ici.
 */
import type { Requete } from "./db.ts";

export async function organisationDEssai(db: Requete, args: string, params: unknown[]) {
  const premier = args.trim();
  const genre = premier.startsWith("'cabinet'")
    ? "cabinet"
    : premier.startsWith("'pme'")
      ? "pme"
      : String(params[0]);
  if (genre === "pme") await accueillirUneSocieteDePlus(db);
  return db.query<{ id: string }>(`select public.create_organization(${args}, true) as id`, params);
}

/**
 * Avant une société de plus : si l'offre de la personne n'en accueille qu'une, elle monte,
 * par la vraie porte, à la moins chère qui en accueille plusieurs. Sans effet sinon.
 */
export async function accueillirUneSocieteDePlus(db: Requete) {
  const devis = await db.query<{ r: { offre_multisociete_requise?: boolean } | null }>(
    "select public.societe_en_plus_devis() as r",
  );
  if (!devis.rows[0]?.r?.offre_multisociete_requise) return;
  const offre = await db.query<{ code: string }>(
    `select code from public.mes_offres()
      where empechement is null and not courant
        and (organisations_max is null or organisations_max > 1)
      order by rang limit 1`,
  );
  const code = offre.rows[0]?.code;
  if (!code) throw new Error("aucune offre n'accueille une société de plus");
  await db.query("select public.forfait_changer($1)", [code]);
}
