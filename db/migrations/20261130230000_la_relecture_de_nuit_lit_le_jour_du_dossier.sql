-- ======================================================================
--  La relecture de nuit lit le jour du dossier (6 novembre 2026).
--
--  Relevé par la CI, à 23 h 30 UTC : le cabinet arrête ses réglages « à
--  partir d'aujourd'hui » dans son fuseau (`cabinet_fuseau_lire`), mais
--  `app.relecture_de_nuit` les lisait à `current_date`, le jour UTC du
--  serveur. Entre minuit et une heure à Tunis, un réglage arrêté le jour même
--  n'était pas encore en vigueur : la relecture de nuit se disait coupée
--  (`refus.relecture.coupee`) alors que le cabinet venait de l'activer.
--
--  Elle lit désormais le jour local du dossier (`app.fuseau_du_cabinet`, qui
--  vaut pour toute organisation : son fuseau, sinon celui de sa juridiction).
--  Sans fuseau, elle refuse (`refus.fuseau.non_defini`) : aucun repli (R4).
--  C'était la seule fonction qui lisait un réglage à `current_date`.
-- ======================================================================

begin;

CREATE OR REPLACE FUNCTION app.relecture_de_nuit(p_dossier uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_pack uuid;
  v_nuit text;
  v_delai text;
  v_heures numeric;
  v_jour date;
begin
  -- Le jour du dossier, dans son fuseau : celui où le cabinet arrête ses réglages.
  v_jour := (now() at time zone app.fuseau_du_cabinet(p_dossier))::date;
  select j.id into v_pack
    from identity.organizations o
    join ref.jurisdiction_packs j on j.jurisdiction = o.jurisdiction
   where o.id = p_dossier
     and j.effective_from <= v_jour
     and (j.effective_to is null or j.effective_to >= v_jour)
   order by j.effective_from desc
   limit 1;
  if v_pack is null then
    raise exception 'refus.referentiel.pack_absent' using errcode = 'no_data_found';
  end if;

  select max(r.valeur) filter (where r.code = 'lecture.relecture_nuit'),
         max(r.valeur) filter (where r.code = 'lecture.relecture_delai_heures')
    into v_nuit, v_delai
    from app.reglage_comptable(p_dossier, v_pack, v_jour) r
   where r.code in ('lecture.relecture_nuit', 'lecture.relecture_delai_heures');

  if v_nuit is null or v_nuit = 'coupee' then
    return null;
  end if;
  if v_nuit <> 'active' or v_delai is null or v_delai !~ '^[0-9]+([.][0-9]+)?$' then
    raise exception 'refus.relecture.reglage_illisible' using errcode = '22023';
  end if;
  v_heures := v_delai::numeric;
  return v_heures;
end
$function$;

commit;
