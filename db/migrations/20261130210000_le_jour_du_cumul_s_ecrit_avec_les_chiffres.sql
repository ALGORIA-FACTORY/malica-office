-- ======================================================================
--  Le jour du cumul d'un PV s'écrit avec ses chiffres (5 novembre 2026).
--
--  20261130145000 datait le cumul par un déclencheur, quand les chiffres
--  CHANGEAIENT. Relevé sur staging le soir même : un PV rédigé de nouveau
--  avec les mêmes montants gardait « cumul au 30 novembre » — les chiffres,
--  identiques, ne changeaient pas, et le jour ne s'écrivait pas. Or des
--  chiffres écrits aujourd'hui sont arrêtés au jour de la réunion, qu'ils
--  diffèrent ou non de ceux d'hier.
--
--  La porte `pv_modifier` pose donc le jour quand elle écrit des chiffres ;
--  le déclencheur, qui ne voit que la différence, est retiré.
-- ======================================================================

begin;

drop trigger pv_reunions_date_du_cumul on collab.pv_reunions;
drop function collab.pv_dater_le_cumul();

CREATE OR REPLACE FUNCTION public.pv_modifier(p_id uuid, p_titre text, p_avec_participants boolean, p_participants text, p_avec_decisions boolean, p_decisions text, p_sections jsonb, p_chiffres jsonb, p_avec_ton boolean, p_ton text, p_redige_par_malica boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if (p_sections is not null and jsonb_typeof(p_sections) <> 'array')
     or (p_chiffres is not null and jsonb_typeof(p_chiffres) <> 'array')
     or (p_titre is not null and btrim(p_titre) = '') then
    raise exception 'refus.saisie.incomplete' using errcode = '22023';
  end if;
  update collab.pv_reunions
     set titre             = coalesce(p_titre, titre),
         participants      = case when p_avec_participants then p_participants else participants end,
         decisions         = case when p_avec_decisions then p_decisions else decisions end,
         sections          = coalesce(p_sections, sections),
         chiffres          = coalesce(p_chiffres, chiffres),
         -- Des chiffres écrits maintenant sont arrêtés au jour de la réunion
         -- (`arreteDuCumul`, 5 novembre 2026), qu'ils aient changé ou non.
         arrete            = case when p_chiffres is not null then at else arrete end,
         ton               = case when p_avec_ton then p_ton else ton end,
         redige_par_malica = coalesce(p_redige_par_malica, redige_par_malica)
   where id = p_id;
  if not found then
    raise exception 'refus.introuvable.proces_verbal' using errcode = '42501';
  end if;
end
$function$;

commit;
