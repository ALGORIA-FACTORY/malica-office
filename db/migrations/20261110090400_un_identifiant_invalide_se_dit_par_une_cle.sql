-- Un identifiant invalide se dit par une clé (audit d'intégrité, 1er novembre 2026).
--
-- `public.identifiant_verifier` RENDAIT son refus en français —
-- « Matricule fiscal invalide : « 123 ». La forme attendue est « … ». » —, et
-- `create_organization` le levait par `raise exception '%', v_refus`. L'audit
-- ne voyait pas ce message (il n'est pas un littéral du `raise`), et un
-- utilisateur arabophone le lisait en français. Il rend désormais la clé
-- `refus.identifiant.invalide`, avec la valeur saisie et l'exemple du
-- référentiel, que l'écran dit dans la langue de la personne.
--
-- Le libellé du format (« Matricule fiscal ») n'est plus cité : c'est une
-- donnée française du référentiel, sans traduction ; la phrase de la clé dit
-- « cet identifiant », dans chaque langue. Il n'est donc plus lu.
--
-- Recréée depuis sa définition en vigueur : même `set search_path`, même
-- volatilité ; `create or replace` garde propriétaire et droits.

begin;

CREATE OR REPLACE FUNCTION public.identifiant_verifier(p_jurisdiction text, p_kind text, p_valeur text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_pattern text;
  v_exemple text;
  v_propre text := nullif(btrim(coalesce(p_valeur, '')), '');
begin
  -- Un identifiant absent n'est pas un identifiant faux. Une entreprise en
  -- cours d'immatriculation s'inscrit sans, et le renseigne ensuite : exiger la
  -- valeur ici bloquerait l'inscription (R10 — un défaut n'est pas un blocage).
  if v_propre is null then
    return null;
  end if;

  select f.pattern, f.exemple into v_pattern, v_exemple
    from ref.identifiant_formats f
   where f.jurisdiction = p_jurisdiction
     and f.kind = p_kind
     and f.valid_from <= current_date
     and (f.valid_to is null or f.valid_to > current_date)
   order by f.valid_from desc
   limit 1;

  -- Aucune règle déclarée pour cette juridiction : on ne valide pas, et on ne
  -- devine pas de format. L'absence se lit dans `ref.identifiant_formats`.
  if v_pattern is null then
    return null;
  end if;

  if v_propre ~ ('^' || v_pattern || '$') then
    return null;
  end if;

  -- Le refus porte l'exemple : « format invalide » laisse la personne deviner
  -- ce qui manque — ici, la lettre après les sept chiffres.
  return app.refus_avec_valeurs('refus.identifiant.invalide',
                                'valeur', v_propre, 'exemple', v_exemple);
end
$function$;

commit;
