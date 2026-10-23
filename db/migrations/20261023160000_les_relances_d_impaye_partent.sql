-- Les relances d'impayé partent (23 octobre 2026).
--
-- Depuis le 19 octobre, tout était prêt SAUF ce qui fait partir : les gabarits
-- (`notif.gabarits`), les quatre verrous (`notif.poster`), le registre
-- (`notif.envois`, `notif.remises`), les paliers (`facturation.a_relancer_v`).
-- Aucun code ne posait une relance, aucun ne la remettait. Cette migration
-- pose l'ORDONNANCEUR (qui décide, une fois par facture et par palier) et ce
-- que le TRAVAILLEUR de l'API lit et inscrit (`apps/api/src/relances/`).
--
-- Rien ne part sans la TOUR : le réglage est fermé par défaut, et l'ouvrir est
-- un geste daté et motivé d'un opérateur (R7, comme le réglage du paiement).
-- La suspension automatique au palier « suspension » est un second
-- interrupteur, fermé lui aussi : tant qu'il l'est, la suspension reste le
-- geste de la tour.
--
-- Le travailleur n'est pas une personne : il se connecte avec le rôle de
-- l'API (`malica_api`), sans endosser `authenticated`. Ces fonctions sont
-- donc ouvertes à ce rôle-là SEUL — aucun compte ne les appelle.

-- --- 1. Le réglage de la tour -------------------------------------------------

create table plateforme.reglages_relances (
  id                     uuid primary key default gen_random_uuid(),
  actives                boolean not null,
  suspension_automatique boolean not null,
  -- Combien de fois un courriel qui a échoué est retenté.
  tentatives_max         smallint not null default 3 check (tentatives_max between 1 and 10),
  motif                  text not null check (length(btrim(motif)) > 0),
  decide_par             uuid not null,
  decide_le              timestamptz not null default now(),
  constraint relances_suspension_si_actives check (actives or not suspension_automatique)
);

comment on table plateforme.reglages_relances is
  'Les relances d''impayé partent-elles, et la suspension est-elle automatique ? '
  'La dernière décision de la tour vaut.';

alter table plateforme.reglages_relances enable row level security;
revoke all on table plateforme.reglages_relances from public, anon;
grant select on table plateforme.reglages_relances to authenticated;
create policy reglages_relances_lire on plateforme.reglages_relances
  for select to authenticated using ((select app.is_platform()));
create trigger reglages_relances_ne_se_reecrivent_pas
  before update or delete on plateforme.reglages_relances
  for each row execute function app.deny_mutation();

create or replace function plateforme.relances_regler(
  p_actives boolean, p_suspension_automatique boolean, p_motif text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not app.is_platform() then
    raise exception 'reserve aux operateurs de la plateforme' using errcode = '42501';
  end if;
  insert into plateforme.reglages_relances (actives, suspension_automatique, motif, decide_par)
  values (p_actives, p_suspension_automatique, p_motif, auth.uid())
  returning id into v_id;
  return (select to_jsonb(r) - 'decide_par' from plateforme.reglages_relances r where r.id = v_id);
end
$$;

revoke all on function plateforme.relances_regler(boolean, boolean, text) from public, anon;
grant execute on function plateforme.relances_regler(boolean, boolean, text) to authenticated;

-- Le réglage en vigueur ; fermé quand la tour n'a rien décidé.
create or replace function plateforme.relances_reglage()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('actives', r.actives,
                               'suspension_automatique', r.suspension_automatique,
                               'tentatives_max', r.tentatives_max, 'decide_le', r.decide_le)
       from plateforme.reglages_relances r
      order by r.decide_le desc, r.id desc limit 1),
    jsonb_build_object('actives', false, 'suspension_automatique', false,
                       'tentatives_max', null, 'decide_le', null))
$$;

-- Lue par l'ordonnanceur seulement ; la tour lit la table, que la RLS lui réserve.
revoke all on function plateforme.relances_reglage() from public, anon, authenticated;

-- Une suspension décidée par la machine n'a pas d'opérateur : la colonne le
-- dit (null), et le motif dit pourquoi.
alter table plateforme.interventions alter column operateur drop not null;

-- --- 2. L'ordonnanceur : une relance par facture et par palier ----------------

create or replace function notif.relancer_les_impayes()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r          record;
  v_reglage  jsonb := plateforme.relances_reglage();
  v_susp     numeric;
  v_tenant   uuid;
  v_canal    text;
  v_res      jsonb;
  v_postes   integer := 0;
  v_retenues integer := 0;
  v_suspendues integer := 0;
begin
  if not (v_reglage ->> 'actives')::boolean then
    return jsonb_build_object('actives', false);
  end if;
  -- Un seul ordonnanceur à la fois, même si deux API tournent.
  if not pg_try_advisory_xact_lock(hashtext('notif.relancer_les_impayes')) then
    return jsonb_build_object('actives', true, 'deja_en_cours', true);
  end if;

  select sp.value_num into v_susp from ref.socle_params sp
   where sp.code = 'recouvrement.suspension_jours'
     and sp.valid_from <= current_date and (sp.valid_to is null or sp.valid_to >= current_date)
   order by sp.valid_from desc limit 1;

  for r in
    select a.*, f.devise
      from facturation.a_relancer_v a
      join facturation.factures f on f.id = a.facture_id
     where a.palier is not null
  loop
    select lo.tenant_id into v_tenant
      from facturation.licence_organisations lo
      join identity.memberships m on m.tenant_id = lo.tenant_id and m.user_id = r.titulaire
     where lo.licence_id = r.licence_id
     order by lo.tenant_id limit 1;

    -- Par courriel si la personne le veut ; sinon, dans l'application seule.
    v_canal := case when coalesce((select p.email_actif from notif.preferences p
                                    where p.user_id = r.titulaire), true)
                    then 'email' else 'app' end;

    v_res := notif.poster(
      r.titulaire,
      'impaye.' || r.palier,
      r.facture_id::text || ':' || r.palier,
      jsonb_build_object(
        'numero', r.numero,
        'echeance', to_char(r.echeance_le, 'DD/MM/YYYY'),
        'reste', to_char(r.reste_du, 'FM999G999G990D000'),
        'devise', r.devise,
        'jours', r.jours_de_retard,
        'date_suspension', to_char(r.echeance_le + coalesce(v_susp, 0)::int, 'DD/MM/YYYY'),
        'en_attente', (select count(*) from capture.pieces p
                         join facturation.licence_organisations lo on lo.tenant_id = p.tenant_id
                        where lo.licence_id = r.licence_id and p.status = 'capturee'
                          and p.vis <> 'personnel'::app.vis_t)),
      v_tenant,
      v_canal,
      -- Chaque palier ne se dit qu'une fois pour cette facture.
      interval '400 days');
    if (v_res ->> 'poste')::boolean then
      v_postes := v_postes + 1;
    else
      v_retenues := v_retenues + 1;
    end if;

    if r.palier = 'suspension' and (v_reglage ->> 'suspension_automatique')::boolean
       and r.statut_licence = 'active' then
      update facturation.licences
         set statut = 'suspendue', suspendue_le = now(), motif_suspension = 'impaye',
             updated_at = now()
       where id = r.licence_id and statut = 'active';
      insert into plateforme.interventions (licence_id, acte, motif, avant, operateur)
      values (r.licence_id, 'suspension',
              'Suspension automatique : facture ' || r.numero || ' due depuis '
                || r.jours_de_retard || ' jours',
              'active', null);
      v_suspendues := v_suspendues + 1;
    end if;
  end loop;

  return jsonb_build_object('actives', true, 'postes', v_postes, 'retenues', v_retenues,
                            'suspendues', v_suspendues);
end
$$;

revoke all on function notif.relancer_les_impayes() from public, anon, authenticated;
grant execute on function notif.relancer_les_impayes() to malica_api;

-- --- 3. Ce que le travailleur remet par courriel -------------------------------

create or replace function notif.courriels_a_remettre(p_limite integer)
returns table (envoi_id uuid, email text, locale text, titre text, corps text,
               action_libelle text, action_route text)
language sql
stable
security definer
set search_path = ''
as $$
  -- Le sujet du courriel sera le titre rendu par `notif.poster` (ses jetons
  -- remplacés) : `notif.envois` ne garde pas les jetons qui rendraient
  -- `gabarits.sujet`.
  select e.id, u.email::text, g.locale, e.titre_rendu, e.corps_rendu,
         g.action_libelle, g.action_route
    from notif.envois_v e
    join notif.gabarits g on g.id = e.gabarit_id
    join auth.users u on u.id = e.destinataire
   where e.canal = 'email'
     and e.etat in ('a_remettre', 'a_reessayer')
     and e.tentatives < coalesce((plateforme.relances_reglage() ->> 'tentatives_max')::int, 0)
   order by e.cree_le
   limit p_limite
$$;

revoke all on function notif.courriels_a_remettre(integer) from public, anon, authenticated;
grant execute on function notif.courriels_a_remettre(integer) to malica_api;
grant usage on schema notif to malica_api;
revoke all on function notif.remettre(uuid, text, text) from public, anon;
grant execute on function notif.remettre(uuid, text, text) to malica_api;
