-- La lisibilité d'une pièce ne se replanifie plus à chaque ligne.
--
-- Constat (24-25 novembre 2026, `la-tva-du-mois-tient-la-charge.test.ts`) : la TVA du mois
-- coûtait 5,2 à 7,1 fois la sélection nue, contre 3,9 à 5,3 le 1er novembre ; la borne
-- de l'épreuve est d'environ 7,5. Rien n'avait changé dans la requête : le temps partait
-- dans la sécurité par ligne. `app.piece_lisible` est appelée pour chaque pièce et chaque
-- article lus (61 000 appels dans l'épreuve), et elle appelle `app.orgs_avec_droit`, qui
-- appelle `app.orgs_avec_droit_de`, qui appelle `app.adhesions_de` (récrite pour l'accès
-- total), qui appelle `app.a_l_acces_total`…
--
-- Cause : sous PostgreSQL 17, une fonction SQL que le planificateur ne peut pas intégrer
-- (c'est le cas de toute fonction `security definer` ou munie d'un `set search_path`)
-- est analysée et planifiée À CHAQUE APPEL, et chacune de celles qu'elle appelle aussi.
-- Une pièce lue coûtait cinq planifications. PL/pgSQL garde ses plans pour la session.
--
-- Correction : ces fonctions passent en PL/pgSQL, corps INCHANGÉS, repris de leur
-- définition en vigueur. Rien d'autre ne bouge : mêmes arguments, même résultat, même
-- `stable`, même `security definer`, même `search_path`, mêmes `rows`, mêmes droits.
-- Deux précautions gardent la sémantique d'une fonction SQL, ligne pour ligne :
--   * une fonction qui rend UNE valeur rend la première ligne de son corps (`limit 1`),
--     comme une fonction SQL — PL/pgSQL échouerait sur une seconde ligne ;
--   * `#variable_conflict use_column` : un nom de colonne l'emporte sur un argument ou
--     une colonne de sortie du même nom, comme dans une fonction SQL.
--
-- Mesuré en local, même base : `piece_lisible` sur 200 pièces, 125 → 27 ms ; la vue des
-- articles d'une PME (400 lignes), 420 → 107 ms.
--
-- _Gardé par_ apps/api/src/la-lisibilite-ne-se-replanifie-plus.test.ts : une reprise de
-- l'une de ces fonctions en `language sql` y échoue.

begin;

CREATE OR REPLACE FUNCTION app.a_l_acces_total()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
begin
  return (select r.* from (

  select coalesce((select a.actif from plateforme.acces_total a
                    where a.user_id = auth.uid()
                    order by a.rang desc
                    limit 1), false)
     and app.is_platform()
  ) r limit 1);
end
$function$;

CREATE OR REPLACE FUNCTION app.adhesions_de(p_personne uuid)
 RETURNS TABLE(tenant_id uuid, role text, par_acces_total boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
begin
  return query

  with total as materialized (
    select coalesce(p_personne = auth.uid(), false) and app.a_l_acces_total() as oui
  ),
  virtuelles as materialized (
    select o.id, t.role_d_acces_total as role
      from identity.organizations o
      join ref.types_d_organisation t on t.code = o.kind
     where (select oui from total)
       and o.archived_at is null
       and t.role_d_acces_total is not null
  )
  select m.tenant_id, m.role, false
    from identity.memberships m
   where m.user_id = p_personne
     and not exists (select 1 from virtuelles v where v.id = m.tenant_id)
  union all
  select v.id, v.role,
         not exists (select 1 from identity.memberships m
                      where m.tenant_id = v.id and m.user_id = p_personne)
    from virtuelles v
  ;
end
$function$;

CREATE OR REPLACE FUNCTION app.archive_orgs()
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
begin
  return query

  select a.pme from app.mes_archives() a
  ;
end
$function$;

CREATE OR REPLACE FUNCTION app.dossier_du_service()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
begin
  return (select r.* from (

  select case
    when nullif(current_setting('request.jwt.claim.service_tenant', true), '') is null then null
    when app.service() = 'relecteur_de_nuit'
      then nullif(current_setting('request.jwt.claim.service_tenant', true), '')::uuid
  end
  ) r limit 1);
end
$function$;

CREATE OR REPLACE FUNCTION app.dossiers_du_comptable_interne()
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
begin
  return query

  select x from app.orgs_avec_droit_de(auth.uid(), 'livres.tenir') x
   where app.api_tenant() is null
     and (select app.service()) is null
     and not app.mandat_externe_en_vigueur(x)
  ;
end
$function$;

CREATE OR REPLACE FUNCTION app.engaged_orgs()
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
begin
  return query

  select e.pme_org_id
    from identity.engagements e
   where e.cabinet_org_id in (select app.member_orgs())
     and (select app.service()) is null
     and app.engagement_en_vigueur(e.status, e.starts_on, e.ends_on)
     and (
       app.has_org_role(e.cabinet_org_id, array['expert'])
       or exists (select 1 from collab.assignments a
                   where a.cabinet_tenant_id = e.cabinet_org_id
                     and a.client_tenant_id = e.pme_org_id
                     and a.collaborator_id = auth.uid()
                     and a.active)
     )
  union
  select x from app.dossiers_du_comptable_interne() x
  ;
end
$function$;

CREATE OR REPLACE FUNCTION app.has_org_role(p_org uuid, p_roles text[])
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
begin
  return (select r.* from (

  select exists (
    select 1 from identity.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = p_org
      and m.role = any(p_roles)
  ) or (exists (select 1 from plateforme.acces_total g where g.user_id = auth.uid())
        and coalesce(app.role_d_acces_total(p_org) = any(p_roles), false))
  ) r limit 1);
end
$function$;

CREATE OR REPLACE FUNCTION app.is_platform()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
begin
  return (select r.* from (

  select app.api_tenant() is null
     and (select app.service()) is null
     and exists (select 1 from app.platform_operators po where po.user_id = auth.uid())
  ) r limit 1);
end
$function$;

CREATE OR REPLACE FUNCTION app.member_orgs()
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
begin
  return query

  select a.tenant_id
    from app.adhesions_de(auth.uid()) a
   where app.api_tenant() is null
  union all
  select app.api_tenant()
   where app.api_tenant() is not null
  union all
  -- Le relecteur de nuit : son dossier, tant qu'il y a une relecture à faire.
  select s.dossier
    from (select app.dossier_du_service() as dossier) s
   where s.dossier is not null
     and app.relecture_due(s.dossier, null)
  ;
end
$function$;

CREATE OR REPLACE FUNCTION app.mes_archives()
 RETURNS TABLE(cabinet uuid, pme uuid, clos_le timestamp with time zone, fin date)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
begin
  return query

  select c.tenant_id, c.pme_org_id, max(c.clos_le), max(c.fin)
    from identity.mandats_clos c
   where c.tenant_id in (select app.member_orgs())
     and (select app.service()) is null
     and (app.has_org_role(c.tenant_id, array['expert'])
          or exists (select 1 from collab.assignments a
                      where a.cabinet_tenant_id = c.tenant_id
                        and a.client_tenant_id = c.pme_org_id
                        and a.collaborator_id = auth.uid()
                        and a.active))
     and exists (select 1 from socle.prises_en_charge pc
                  where pc.tenant_id = c.tenant_id
                    and pc.client_tenant_id = c.pme_org_id
                    and pc.prise_le <= c.clos_le)
   group by c.tenant_id, c.pme_org_id
  ;
end
$function$;

CREATE OR REPLACE FUNCTION app.orgs_avec_droit(p_droit text)
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
begin
  return query

  select x from app.orgs_avec_droit_de(auth.uid(), p_droit) x
   where app.api_tenant() is null
  union all
  select app.api_tenant()
   where app.api_tenant() is not null
  ;
end
$function$;

CREATE OR REPLACE FUNCTION app.orgs_avec_droit_de(p_personne uuid, p_droit text)
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
begin
  return query

  select m.tenant_id
    from app.adhesions_de(p_personne) m
    join identity.organizations o on o.id = m.tenant_id
    join ref.droits_des_roles d
      on d.org_kind = o.kind and d.role = m.role and d.droit = p_droit
     and d.valid_from <= current_date
     and (d.valid_to is null or d.valid_to > current_date)
  ;
end
$function$;

CREATE OR REPLACE FUNCTION app.piece_connue_du_cabinet(p_piece uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
begin
  return (select r.* from (

  select exists (
    select 1 from capture.pieces p
     where p.id = p_piece
       and (p.vis = 'partage'::app.vis_t
            or p.transmise_le is not null
            or exists (select 1 from socle.ecritures e
                        where e.piece_id in (select app.versions_de_la_piece(p.id))
                          and e.status = 'booked')))
  ) r limit 1);
end
$function$;

CREATE OR REPLACE FUNCTION app.piece_lisible(p_piece uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
begin
  return (select r.* from (

  select exists (
    select 1 from capture.pieces p
    -- La version courante juge : une version précédente n'a pas de
    -- visibilité propre.
    where p.id = app.version_courante(p_piece)
      and (
        (p.archivee_le is null and (
             (p.vis = 'personnel'::app.vis_t and p.created_by = auth.uid())
          or (p.vis in ('entite'::app.vis_t, 'partage'::app.vis_t) and (
                p.tenant_id in (select app.orgs_avec_droit('societe.tout_voir'))
                or (p.tenant_id in (select app.member_orgs()) and p.created_by = auth.uid())))
          or (p.vis = 'partage'::app.vis_t and p.tenant_id in (select app.engaged_orgs()))))
        or (p.archivee_le is not null
            and p.tenant_id in (select app.engaged_orgs())
            and app.piece_connue_du_cabinet(p.id))
        -- L'exception, et elle est nommée.
        or app.plateforme_requise(p.tenant_id)
        -- Le relecteur de nuit : les pièces de son dossier, en LECTURE, tant
        -- qu'une relecture y est due ou en cours, jamais plus que l'auteur de la
        -- pièce relue n'en verrait (`app.piece_lisible_au_relecteur`). Voir
        -- l'en-tête : l'analyse juge la pièce contre son dossier (doublon
        -- probable). Il n'ÉCRIT que sur la pièce qu'il relit.
        or case when app.dossier_du_service() is null then false
                else app.piece_lisible_au_relecteur(p.tenant_id, p.id, p.vis, p.created_by,
                                                    p.archivee_le) end
      )
  )
  ) r limit 1);
end
$function$;

CREATE OR REPLACE FUNCTION app.piece_remplacee(p_piece uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
begin
  return (select r.* from (

  select exists (select 1 from capture.remplacements r where r.piece_id = p_piece)
  ) r limit 1);
end
$function$;

CREATE OR REPLACE FUNCTION app.plateforme_requise(p_tenant uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
begin
  return (select r.* from (

  select exists (
    select 1
    from plateforme.requisitions r
    join app.platform_operators po on po.user_id = auth.uid()
    where r.tenant_id = p_tenant
      and r.portee = 'pieces'
      and r.approuve_par is not null
      and now() between r.ouverte_le and r.close_le
  )
  ) r limit 1);
end
$function$;

CREATE OR REPLACE FUNCTION app.relecture_due(p_tenant uuid, p_piece uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
begin
  return (select r.* from (

  select app.dossier_du_service() is not distinct from p_tenant
     and p_tenant is not null
     and exists (
       select 1 from fabrique.etat_des_travaux_v e
        where e.tenant_id = p_tenant
          and (p_piece is null or e.piece_id = p_piece)
          and e.nature = 'relecture_piece'
          and (e.prenable or e.etat = 'en_cours'))
  ) r limit 1);
end
$function$;

CREATE OR REPLACE FUNCTION app.service()
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
begin
  return (select r.* from (

  select case
    when nullif(current_setting('request.jwt.claim.service', true), '') is null then null
    else (select v.code
            from identity.comptes_de_service_v v
           where v.code = nullif(current_setting('request.jwt.claim.service', true), '')
             and v.id = auth.uid()
             and v.actif
             and coalesce(current_setting('malica.origine', true), '') = 'serveur')
  end
  ) r limit 1);
end
$function$;

CREATE OR REPLACE FUNCTION app.version_courante(p_piece uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
begin
  return (select r.* from (

  with recursive suite(id, rang) as (
    select p_piece, 0
    union all
    select r.remplacee_par, s.rang + 1
      from capture.remplacements r join suite s on r.piece_id = s.id
  )
  select case
    when (select app.chaine_ouverte(r.tenant_id, r.auteur)
            from capture.remplacements r
           where r.piece_id = p_piece or r.remplacee_par = p_piece
           limit 1)
      then (select id from suite order by rang desc limit 1)
    else p_piece
  end
  ) r limit 1);
end
$function$;


commit;
