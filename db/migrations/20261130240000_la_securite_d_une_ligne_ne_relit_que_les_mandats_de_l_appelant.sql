-- ======================================================================
--  La sécurité d'une ligne ne relit que les mandats de l'appelant
--  (6 novembre 2026).
--
--  Mesuré en local, sous l'identité d'une experte, sur un cabinet de 7
--  dossiers et 280 pièces : la file du cabinet prenait 5,1 s, la liste des
--  clients 3,4 s. Le profil des fonctions disait où :
--
--   1. `app.engaged_orgs()` — les dossiers que l'appelant supervise, relue par
--      `piece_lisible` à chaque pièce — parcourait TOUS les mandats actifs de
--      la base et jugeait `has_org_role` sur chacun avant de garder ceux de
--      ses cabinets : 88 jugements pour 7 mandats, 74 096 pour la file. Le
--      coût croissait avec le nombre de clients de la plateforme, pas avec la
--      taille du cabinet. `= any(array(select app.member_orgs()))` lit les
--      mandats des cabinets de l'appelant par l'index
--      `engagements_cabinet_idx` ; `engaged_orgs_as_expert()` avait le même
--      défaut. Même ensemble rendu, ligne pour ligne.
--   2. `app.service()` lisait les comptes de service à chaque appel, même
--      sans claim `service` — le cas de toute personne. Elle rend désormais
--      `null` d'emblée sans claim : sa clause `v.code = claim` ne pouvait de
--      toute façon rien trouver. `dossier_du_service()` de même, sans claim
--      `service_tenant`.
--   3. `app.suivi_de_la_piece` jugeait la pièce lisible, puis appelait
--      `ecriture_prise_en_charge_de`, qui la rejugeait. Le calcul passe dans
--      `app.ecriture_prise_en_charge_lue`, SANS garde et fermée aux clients
--      (`revoke` de public, anon, authenticated) ; la porte publique garde sa
--      garde et l'appelle.
--
--  Après : file 2,0 s environ, liste des clients 1,5 s (mesures dans la PR).
--  Rien d'autre ne change : propriétaires, `security definer`, chemins.
-- ======================================================================

begin;

CREATE OR REPLACE FUNCTION app.engaged_orgs()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select e.pme_org_id
    from identity.engagements e
   where e.cabinet_org_id = any(array(select app.member_orgs()))
     and (select app.service()) is null
     and e.status = 'actif'
     and e.starts_on <= current_date
     and (e.ends_on is null or e.ends_on >= current_date)
     and (
       app.has_org_role(e.cabinet_org_id, array['expert'])
       or exists (select 1 from collab.assignments a
                   where a.cabinet_tenant_id = e.cabinet_org_id
                     and a.client_tenant_id = e.pme_org_id
                     and a.collaborator_id = auth.uid()
                     and a.active)
     )
$function$;

CREATE OR REPLACE FUNCTION app.engaged_orgs_as_expert()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select distinct e.pme_org_id
    from identity.engagements e
   where e.cabinet_org_id = any(array(select app.member_orgs()))
     and e.status = 'actif'
     and e.starts_on <= current_date
     and (e.ends_on is null or e.ends_on >= current_date)
     and app.has_org_role(e.cabinet_org_id, array['expert'])
$function$;

CREATE OR REPLACE FUNCTION app.service()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
    when nullif(current_setting('request.jwt.claim.service', true), '') is null then null
    else (select v.code
            from identity.comptes_de_service_v v
           where v.code = nullif(current_setting('request.jwt.claim.service', true), '')
             and v.id = auth.uid()
             and v.actif
             and coalesce(current_setting('malica.origine', true), '') = 'serveur')
  end
$function$;

CREATE OR REPLACE FUNCTION app.dossier_du_service()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
    when nullif(current_setting('request.jwt.claim.service_tenant', true), '') is null then null
    when app.service() = 'relecteur_de_nuit'
      then nullif(current_setting('request.jwt.claim.service_tenant', true), '')::uuid
  end
$function$;

CREATE OR REPLACE FUNCTION app.ecriture_prise_en_charge_lue(p_piece uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- Vivante, de nature « pièce », sur toutes les versions, prise en charge par
  -- un cabinet — la plus récente prise d'abord. SANS garde : réservée aux
  -- fonctions qui ont déjà jugé la pièce lisible.
  select e.id
    from socle.ecritures e
    join socle.prises_en_charge pc on pc.ecriture_id = e.id
   where e.piece_id = any(array(select app.versions_de_la_piece(p_piece)))
     and e.nature = 'piece'
     and app.ecriture_vivante(e.id)
   order by pc.prise_le desc
   limit 1
$function$;

CREATE OR REPLACE FUNCTION app.ecriture_prise_en_charge_de(p_piece uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- La même règle de lecture que la pièce (R6).
  select app.ecriture_prise_en_charge_lue(p_piece)
   where app.piece_lisible(p_piece)
$function$;

CREATE OR REPLACE FUNCTION app.suivi_de_la_piece(p_piece uuid)
 RETURNS TABLE(envoyee_le timestamp with time zone, vue_le timestamp with time zone, vue_par text, corrigee_le timestamp with time zone, prise_le timestamp with time zone, prise text, prise_par text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_vis    app.vis_t;
  v_client boolean;
  v_ecriture uuid;
  v_cabinet  uuid;
begin
  if not app.piece_lisible(p_piece) then
    return;
  end if;
  select tenant_id, vis into v_tenant, v_vis
    from capture.pieces where id = app.version_courante(p_piece);
  -- Client SEULEMENT : membre de la société sans superviser son dossier.
  v_client := v_tenant in (select app.member_orgs())
              and not app.supervise_le_dossier(v_tenant);

  if v_vis = 'partage'::app.vis_t then
    envoyee_le := app.dernier_envoi(p_piece);
  end if;

  select v.vue_le, o.name into vue_le, vue_par
    from capture.vues v
    join identity.organizations o on o.id = v.cabinet_org_id
   where v.piece_id = any(array(select app.versions_de_la_piece(p_piece)))
     -- La vue d'un propriétaire (lot 4) n'est pas celle du cabinet.
     and v.cabinet_org_id <> v.tenant_id
   order by v.vue_le desc
   limit 1;

  corrigee_le := app.corrigee_par_le_client(p_piece);

  -- La pièce est jugée lisible plus haut : pas une seconde fois.
  v_ecriture := app.ecriture_prise_en_charge_lue(p_piece);
  if v_ecriture is not null then
    select pc.tenant_id, pc.prise_le, pc.par_nom
      into v_cabinet, prise_le, prise_par
      from socle.prises_en_charge pc
     where pc.ecriture_id = v_ecriture
     order by pc.prise_le desc
     limit 1;
    select x.origine into prise from app.ecriture_prise_en_charge(v_cabinet, v_ecriture) x;
  end if;
  -- Le client lit « Prise en charge » ; le nom du comptable reste au cabinet.
  if v_client then
    prise_par := null;
  end if;

  return next;
end
$function$;

revoke all on function app.ecriture_prise_en_charge_lue(uuid) from public, anon, authenticated;

commit;
