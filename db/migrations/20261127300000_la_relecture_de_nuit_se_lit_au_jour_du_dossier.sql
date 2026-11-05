-- Le réglage de la relecture de nuit se lit au jour DU DOSSIER, pas au jour UTC du serveur.
--
-- ================================================================== POURQUOI
--
-- 5 novembre 2026, 23 h 13 UTC (00 h 13 à Tunis) : les épreuves de la passe de nuit
-- échouaient toutes, « aucune relecture inscrite ». Le réglage `lecture.relecture_nuit`
-- d'un dossier, arrêté « depuis » le jour du cabinet (le 6 novembre à Tunis), était lu par
-- `app.relecture_de_nuit` au `current_date` du serveur — le 5 novembre en UTC : pas encore
-- en vigueur. Entre minuit à Tunis et minuit UTC, chaque jour, un réglage arrêté le jour
-- même ne s'appliquait pas. Ce n'était pas l'épreuve : c'était la fonction.
--
-- ================================================================== CE QUI CHANGE
--
-- `app.relecture_de_nuit` lit le pack et les réglages au jour du dossier dans son fuseau
-- (`app.fuseau_du_cabinet` : le fuseau de l'organisation, sinon celui de sa juridiction ;
-- sans l'un ni l'autre, elle refuse comme elles le font toutes). Le reste est inchangé.
--
-- REJEU (R11) : aucune horloge n'écrit dans `ref`.

create or replace function app.relecture_de_nuit(p_dossier uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_pack uuid;
  v_nuit text;
  v_delai text;
  v_heures numeric;
  -- Le jour DU DOSSIER, dans son fuseau : pas celui du serveur (UTC).
  v_jour date := (now() at time zone app.fuseau_du_cabinet(p_dossier))::date;
begin
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
$$;
