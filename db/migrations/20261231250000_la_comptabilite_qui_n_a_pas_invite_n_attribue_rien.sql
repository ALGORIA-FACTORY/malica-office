-- La comptabilité d'une société inscrite seule n'a aucun droit sur son abonnement.
--
-- Décision du dirigeant, 23 novembre 2026, rappelée le 24 : « celui qui déclenche la montée la
-- paie » — le titulaire, ou la comptabilité qui a INVITÉ son client dans Malica (CGV, art. 4 et
-- 8 : « un abonnement attribué par sa comptabilité ») ; « le cabinet d'une PME qui s'est
-- inscrite seule n'a aucun droit sur son abonnement ». Jusqu'ici, toute comptabilité mandatée
-- pouvait proposer un abonnement à son client (`acces_proposer`) ou le faire monter
-- (`acces_changer_offre`), même quand la société était venue seule.
--
-- « Invitée » se lit dans les faits, pas dans une case à cocher : la société a été créée par
-- un membre de la comptabilité (son dossier), ou son dirigeant y est entré par une invitation
-- qu'un membre de la comptabilité a envoyée. `facturation.comptabilite_a_invite` le dit ; la
-- page Clients le lit (`invitee_par_nous`) pour ne pas proposer ce qui serait refusé.
--
-- Ce qui reste permis à toute comptabilité mandatée : descendre ou arrêter un abonnement
-- qu'elle a déjà pris en charge (elle rend ce qu'elle payait), lire, tenir les livres.
--
-- REJEU (R11) : aucune donnée écrite ; fonctions reprises de leur définition EN VIGUEUR.
-- _Gardé par_ apps/api/src/facturation/la-comptabilite-qui-n-a-pas-invite-n-attribue-rien.test.ts.

begin;

create function facturation.comptabilite_a_invite(p_cabinet uuid, p_pme uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
           select 1
             from identity.organizations o
             join identity.memberships m on m.user_id = o.created_by and m.tenant_id = p_cabinet
            where o.id = p_pme)
      or exists (
           select 1
             from identity.invitations i
             join identity.memberships m on m.user_id = i.invited_by and m.tenant_id = p_cabinet
            where i.tenant_id = p_pme and i.role = 'dirigeant' and i.revoked_at is null)
$$;
comment on function facturation.comptabilite_a_invite(uuid, uuid) is
  'Vrai quand la comptabilité a invité la société dans Malica : elle a créé son dossier, ou '
  'invité son dirigeant. Seule cette comptabilité peut lui attribuer un abonnement ou le monter.';
revoke all on function facturation.comptabilite_a_invite(uuid, uuid) from public, anon, authenticated;

drop function public.clients_du_cabinet_etat(uuid);
CREATE OR REPLACE FUNCTION public.clients_du_cabinet_etat(p_cabinet uuid)
 RETURNS TABLE(tenant_id uuid, adresse text, dirigeant_present boolean, invitation_email text, invitation_envoyee timestamp with time zone, invitation_expiree boolean, acces_id uuid, acces_statut text, acces_offre text, descente_offre text, licence_id uuid, titulaire_nom text, forfait_offre text, organisations integer, organisations_incluses integer, sieges_occupes integer, sieges_inclus integer, places_en_attente integer, invitee_par_nous boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- `m` : le mandat est accepté. Sans lui, rien de la société ne sort — ni
  -- son dirigeant, ni ses invitations, ni sa licence. Seul reste ce que la
  -- comptabilité a posé elle-même (son abonnement proposé).
  select o.id,
         case when m then o.adresse end,
         m and exists (select 1 from identity.memberships ms
                        where ms.tenant_id = o.id and ms.role = 'dirigeant'),
         case when m then inv.email end,
         case when m then inv.created_at end,
         case when m then inv.expires_at <= now() end,
         a.id, a.statut, a.offre_code,
         case when m then (select d.offre_code from facturation.acces_descentes d
                            where d.tenant_id = o.id and d.statut = 'propose') end,
         case when m then lo.licence_id end,
         case when m then coalesce(nullif(trim(p.display_name), ''), u.email::text) end,
         case when m then dv.offre_code end,
         case when m then dv.organisations::int end,
         case when m then dv.organisations_incluses::int end,
         case when m then dv.sieges_occupes::int end,
         case when m then dv.sieges_inclus::int end,
         case when m then (select count(*)::int from identity.invitations i
                            where i.tenant_id = o.id and i.role <> 'dirigeant'
                              and i.accepted_at is null and i.revoked_at is null
                              and i.expires_at > now())
              else 0 end,
         facturation.comptabilite_a_invite(p_cabinet, o.id)
    from identity.engagements e
    cross join lateral (select e.status = 'actif' as m) mm(m)
    join identity.organizations o on o.id = e.pme_org_id and o.archived_at is null
    left join lateral (
      select i.email, i.created_at, i.expires_at
        from identity.invitations i
       where i.tenant_id = o.id and i.accepted_at is null and i.revoked_at is null
         and i.role = 'dirigeant'
       order by i.created_at desc limit 1
    ) inv on true
    left join lateral (
      select x.id, x.statut, x.offre_code
        from facturation.acces x
       where x.tenant_id = o.id and x.cabinet_tenant_id = p_cabinet and x.statut <> 'termine'
       limit 1
    ) a on true
    left join facturation.licence_organisations lo on lo.tenant_id = o.id
    left join facturation.licences l on l.id = lo.licence_id
    left join identity.profiles p on p.user_id = l.titulaire
    left join auth.users u on u.id = l.titulaire
    left join facturation.droits_v dv on dv.licence_id = lo.licence_id
   where e.cabinet_org_id = p_cabinet
     and e.status in ('propose', 'actif')
     and app.has_org_role(p_cabinet, array['expert', 'collaborateur', 'assistant'])
     and e.pme_org_id in (select app.mandats_visibles(p_cabinet))
$function$;
revoke all on function public.clients_du_cabinet_etat(uuid) from public, anon;
grant execute on function public.clients_du_cabinet_etat(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.acces_proposer(p_cabinet uuid, p_client uuid, p_offre text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id    uuid;
  v_grille ref.offres;
begin
  if not app.has_org_role(p_cabinet, array['expert']) then
    raise exception 'refus.reserve.expert'
      using errcode = '42501';
  end if;
  if not exists (select 1 from identity.engagements e
                  where e.cabinet_org_id = p_cabinet and e.pme_org_id = p_client
                    and e.status = 'actif') then
    raise exception 'refus.mandat.hors_cabinet' using errcode = '42501';
  end if;
  -- La société s'est inscrite seule : son abonnement est le sien. Seule la comptabilité qui
  -- l'a invitée dans Malica peut lui en attribuer un (décision du 23 novembre 2026).
  if not facturation.comptabilite_a_invite(p_cabinet, p_client) then
    raise exception 'refus.abonnement.societe_inscrite_seule' using errcode = '42501';
  end if;
  if exists (select 1 from facturation.acces a
              where a.tenant_id = p_client and a.statut in ('propose', 'actif', 'suspendu')) then
    raise exception 'refus.abonnement.deja_propose'
      using errcode = 'check_violation';
  end if;
  -- Une société rattachée à une licence que la comptabilité paie déjà est
  -- couverte : un second abonnement la ferait payer deux fois.
  if exists (select 1 from facturation.licence_organisations lo
               join facturation.acces a on a.licence_id = lo.licence_id
              where lo.tenant_id = p_client and a.statut = 'actif' and a.canal = 'cabinet') then
    raise exception 'refus.abonnement.couvert_par_la_licence' using errcode = 'check_violation';
  end if;
  v_grille := ref.offre_a(p_offre, current_date);
  if v_grille.code is null then
    raise exception 'refus.offre.hors_grille' using errcode = '22023';
  end if;
  insert into facturation.acces
    (tenant_id, canal, cabinet_tenant_id, offre_code, offre_depuis, statut, propose_le, propose_par)
  values
    (p_client, 'cabinet', p_cabinet, v_grille.code, v_grille.effective_from, 'propose',
     current_date, auth.uid())
  returning id into v_id;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_client, auth.uid(), 'acces.propose', 'facturation', 'acces', v_id,
          jsonb_build_object('cabinet', p_cabinet, 'offre', v_grille.code));
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_cabinet, auth.uid(), 'acces.propose', 'facturation', 'acces', v_id,
          jsonb_build_object('client', p_client, 'offre', v_grille.code,
                             'prix_mensuel_ht', v_grille.prix_mensuel_ht));
  perform notif.emettre(p_client, 'acces.propose', jsonb_build_object('acces_id', v_id, 'offre', v_grille.code,
                             'cabinet', (select name from identity.organizations where id = p_cabinet)));
  return v_id;
end
$function$;

CREATE OR REPLACE FUNCTION public.acces_changer_offre(p_acces uuid, p_offre text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v        facturation.acces;
  v_grille ref.offres;
  v_regle  ref.offres_par_canal;
  v_id     uuid;
  v_rang_a smallint;
  v_rang_o smallint;
  v_forfait text;
  v_nom    text;
begin
  select * into v from facturation.acces where id = p_acces for update;
  if v.id is null or v.canal <> 'cabinet'
     or not app.has_org_role(v.cabinet_tenant_id, array['expert']) then
    raise exception 'refus.reserve.expert' using errcode = '42501';
  end if;
  if v.statut not in ('propose', 'actif') then
    raise exception 'refus.abonnement.plus_en_attente' using errcode = '22023';
  end if;
  v_grille := ref.offre_a(p_offre, current_date);
  if v_grille.code is null then
    raise exception 'refus.offre.hors_grille' using errcode = '22023';
  end if;
  v_regle := ref.canal_offre_a('cabinet', v_grille.code, current_date);
  if v_regle.canal is null or not v_regle.cabinet_peut_ouvrir then
    raise exception '%', app.refus_avec_valeurs('refus.offre.pas_par_un_cabinet', 'offre', v_grille.code)
      using errcode = 'check_violation';
  end if;
  if v_grille.code = v.offre_code then
    return jsonb_build_object('acces_id', v.id, 'effet', 'inchange');
  end if;
  v_nom := (select name from identity.organizations where id = v.cabinet_tenant_id);

  -- Le dirigeant n'a pas encore rejoint (A2) : la proposition change, rien ne se facture.
  if v.statut = 'propose' then
    update facturation.acces
       set statut = 'termine', effet_du = current_date, effet_au = current_date,
           motif_fin = 'changement_offre', licence_id = null
     where id = v.id;
    insert into facturation.acces
      (tenant_id, canal, cabinet_tenant_id, offre_code, offre_depuis, statut,
       propose_le, propose_par)
    values
      (v.tenant_id, 'cabinet', v.cabinet_tenant_id, v_grille.code, v_grille.effective_from,
       'propose', current_date, auth.uid())
    returning id into v_id;
    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
    values (v.cabinet_tenant_id, auth.uid(), 'acces.offre_changee', 'facturation', 'acces', v_id,
            jsonb_build_object('client', v.tenant_id, 'avant', v.offre_code, 'offre', v_grille.code));
    return jsonb_build_object('acces_id', v_id, 'effet', 'proposition');
  end if;

  v_rang_a := (ref.offre_a(v.offre_code, current_date)).rang;
  v_rang_o := v_grille.rang;

  -- Le client est monté à sa charge au-dessus de ce que la comptabilité paie : elle peut
  -- prendre en charge l'offre qu'il a déjà (recette du 13 novembre, B7). Le même chemin que
  -- toute montée : ce que le client a réglé d'avance court jusqu'à son terme (la garde), puis
  -- la comptabilité paie l'offre entière ; aucun jour ne se paie deux fois.
  -- Monter, c'est payer plus pour la société : réservé à la comptabilité qui l'a invitée.
  -- Descendre ou arrêter reste possible (rendre ce qu'elle a pris en charge).
  if v_rang_o > v_rang_a
     and not facturation.comptabilite_a_invite(v.cabinet_tenant_id, v.tenant_id) then
    raise exception 'refus.abonnement.societe_inscrite_seule' using errcode = '42501';
  end if;

  if v_rang_o > v_rang_a then
    -- Montée : sur-le-champ, le dirigeant est prévenu.
    update facturation.acces_descentes
       set statut = 'retiree', repondu_le = current_date, repondu_par = auth.uid()
     where tenant_id = v.tenant_id and statut = 'propose';
    v_id := facturation.acces_relayer(v.id, v_grille.code);
    select f.offre_code into v_forfait
      from facturation.forfait_courant_v f where f.licence_id = v.licence_id;
    if v_rang_o > coalesce((ref.offre_a(v_forfait, current_date)).rang, 0) then
      perform facturation.forfait_poser(v.licence_id, v_grille.code, current_date);
    end if;
    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
    values (v.tenant_id, auth.uid(), 'acces.monte', 'facturation', 'acces', v_id,
            jsonb_build_object('cabinet', v.cabinet_tenant_id, 'avant', v.offre_code,
                               'offre', v_grille.code));
    perform notif.emettre(v.tenant_id, 'acces.monte', jsonb_build_object('acces_id', v_id, 'offre', v_grille.code, 'avant', v.offre_code, 'cabinet', v_nom));
    return jsonb_build_object('acces_id', v_id, 'effet', 'immediat');
  end if;

  -- Descente : elle attend l'accord du dirigeant. Elle doit tenir dans ce
  -- que la société utilise déjà (sociétés, places), si le forfait la suit.
  select f.offre_code into v_forfait
    from facturation.forfait_courant_v f where f.licence_id = v.licence_id;
  if v_forfait = v.offre_code then
    perform facturation.descente_possible(v.licence_id, v_grille.code);
  end if;
  update facturation.acces_descentes
     set statut = 'retiree', repondu_le = current_date, repondu_par = auth.uid()
   where tenant_id = v.tenant_id and statut = 'propose';
  insert into facturation.acces_descentes (acces_id, tenant_id, offre_code, propose_par)
  values (v.id, v.tenant_id, v_grille.code, auth.uid())
  returning id into v_id;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v.tenant_id, auth.uid(), 'acces.descente_demandee', 'facturation', 'acces_descentes', v_id,
          jsonb_build_object('cabinet', v.cabinet_tenant_id, 'avant', v.offre_code,
                             'offre', v_grille.code));
  perform notif.emettre(v.tenant_id, 'acces.descente_demandee', jsonb_build_object('descente_id', v_id, 'offre', v_grille.code, 'cabinet', v_nom));
  return jsonb_build_object('acces_id', v.id, 'descente_id', v_id, 'effet', 'accord_attendu');
end
$function$;

commit;
