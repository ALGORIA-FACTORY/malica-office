-- ======================================================================
--  La tour compte les bibliothèques — des nombres, jamais un papier.
--
--  L'espace commun de la tour (`/tour`, 2 novembre 2026) montre, pour chaque
--  cabinet et chaque PME, ce que contient sa bibliothèque. La frontière du
--  19 octobre tient (`20261019100000`) : la tour COMPTE, elle ne lit pas. La
--  politique de `capture.pieces` lui cache chaque pièce hors réquisition
--  (`app.plateforme_requise`), et c'est voulu ; une vue `security_invoker`
--  ne lui rendrait donc rien. D'où une fonction `definer` qui ne rend que
--  des agrégats par société — aucun identifiant de pièce, aucun tiers, aucun
--  montant, aucun nom de fichier.
--
--  Ce que chaque nombre compte :
--    * `documents` : les pièces de la société (`entite` et `partage`), à leur
--      version courante, non archivées. L'espace privé d'une personne
--      (`personnel`) n'entre jamais dans le compte, pas même comme nombre ;
--    * `transmis_mois_courant` : celles transmises au cabinet depuis le
--      premier du mois ;
--    * `dernier_depot_le` : le dernier dépôt de la société.
--
--  Même nom et même forme que le plan des tables (partie A, § 2.5) : la
--  migration du moteur commercial peut la reprendre telle quelle.
--
--  Refus : `refus.reserve.plateforme` (42501), déjà traduit. Un service (le
--  relecteur de nuit) n'est pas la plateforme : `app.is_platform()` le dit.
--
--  REJEU (R11) : `create or replace` ; aucune donnée de référence écrite.
-- ======================================================================

begin;

create or replace function plateforme.bibliotheques_compter()
returns table (
  tenant_id             uuid,
  documents             bigint,
  transmis_mois_courant bigint,
  dernier_depot_le      timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;

  return query
    select p.tenant_id,
           count(*)::bigint,
           count(*) filter (
             where p.vis = 'partage'::app.vis_t
               and p.transmise_le >= date_trunc('month', current_date))::bigint,
           max(p.created_at)
      from capture.pieces p
     where p.vis in ('entite'::app.vis_t, 'partage'::app.vis_t)
       and p.archivee_le is null
       -- La version courante : une photo remplacée se compte dans celle qui
       -- la remplace (`capture.remplacements`, R7).
       and not exists (select 1 from capture.remplacements r where r.piece_id = p.id)
     group by p.tenant_id;
end
$function$;

comment on function plateforme.bibliotheques_compter() is
  'La bibliothèque de chaque société, en nombres : documents, transmis ce mois, '
  'dernier dépôt. Réservée à la plateforme ; aucun contenu de pièce ne sort.';

revoke all on function plateforme.bibliotheques_compter() from public, anon;
grant execute on function plateforme.bibliotheques_compter() to authenticated;

commit;
