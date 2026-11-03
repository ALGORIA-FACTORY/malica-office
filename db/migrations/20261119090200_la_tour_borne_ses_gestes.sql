-- ======================================================================
--  La tour borne ses gestes (moteur commercial, 3/9 — plan du 2 novembre
--  2026, annexe S1 à S3 ; décisions du dirigeant n° 5, 9, 11, 12).
--
--    plateforme.reglages_commerciaux   les plafonds des gestes commerciaux,
--                                      niveau PRUDENT (décision 5) ;
--    plateforme.reglages_facturation   l'envoi par courriel (ALLUMÉ, décision
--                                      12), l'échéance, les tentatives ;
--    plateforme.reglages_abonnement    + `report_regle` : les lectures non
--                                      consommées sont gardées À VIE.
--
--  Chaque réglage est une ligne datée, motivée, nominative ; la dernière
--  décision vaut ; rien ne se réécrit (R7, R10). Le défaut livré est une
--  ligne semée, motivée « défaut livré », que la tour remplace par une
--  décision sans migration.
--
--  REJEU (R11) : les lignes semées portent des dates littérales.
-- ======================================================================

-- ------------------------------------------------------------ 1. Les plafonds des gestes

create table plateforme.reglages_commerciaux (
  id                          uuid primary key default gen_random_uuid(),
  remise_pct_max              numeric(5,2) not null check (remise_pct_max between 0 and 100),
  remise_montant_max_mois     numeric(5,2) not null check (remise_montant_max_mois between 0 and 12),
  remise_duree_max_mois       smallint not null check (remise_duree_max_mois between 1 and 36),
  mois_offerts_max            smallint not null check (mois_offerts_max between 0 and 12),
  lectures_offertes_max       integer not null check (lectures_offertes_max between 0 and 100000),
  prolongation_essai_max_jours smallint not null check (prolongation_essai_max_jours between 0 and 90),
  fenetre_cumul_mois          smallint not null check (fenetre_cumul_mois between 1 and 36),
  motif                       text not null check (length(btrim(motif)) > 0),
  decide_par                  uuid references auth.users (id),
  decide_le                   timestamptz not null default now()
);
comment on table plateforme.reglages_commerciaux is
  'Les plafonds des gestes commerciaux de la tour (décision du dirigeant n° 5). Une remise en '
  'montant se borne en MOIS de l''abonnement HT (`remise_montant_max_mois` × prix mensuel HT de '
  'la licence) : aucune devise n''est écrite ici. Chaque plafond borne le geste ET le CUMUL des '
  'gestes de même nature, non annulés, accordés à la licence sur `fenetre_cumul_mois` mois '
  'glissants (revue indépendante de #202). Dernière décision = en vigueur ; ajout seul.';
create index reglages_commerciaux_decide_idx on plateforme.reglages_commerciaux (decide_le desc, id desc);
create index reglages_commerciaux_decide_par_idx on plateforme.reglages_commerciaux (decide_par);

insert into plateforme.reglages_commerciaux
  (remise_pct_max, remise_montant_max_mois, remise_duree_max_mois, mois_offerts_max,
   lectures_offertes_max, prolongation_essai_max_jours, fenetre_cumul_mois, motif, decide_par,
   decide_le)
values
  (20, 1, 12, 2, 300, 15, 12,
   'Défaut livré : niveau prudent arrêté par le dirigeant le 2 novembre 2026 (décision n° 5), '
   'plafond du geste et plafond du cumul par licence sur 12 mois glissants.',
   null, timestamptz '2026-11-02 00:00:00+00');

-- ------------------------------------------------------------ 2. La facturation

create table plateforme.reglages_facturation (
  id              uuid primary key default gen_random_uuid(),
  envoi_courriel  boolean not null,
  jours_echeance  smallint not null check (jours_echeance between 0 and 90),
  tentatives_max  smallint not null check (tentatives_max between 1 and 10),
  motif           text not null check (length(btrim(motif)) > 0),
  decide_par      uuid references auth.users (id),
  decide_le       timestamptz not null default now()
);
comment on table plateforme.reglages_facturation is
  'L''envoi des factures par courriel (lien vers l''espace client et PDF joint), l''échéance en '
  'jours après l''émission, et le nombre de tentatives de remise d''un courriel de facture. '
  'Dernière décision = en vigueur ; ajout seul.';
create index reglages_facturation_decide_idx on plateforme.reglages_facturation (decide_le desc, id desc);
create index reglages_facturation_decide_par_idx on plateforme.reglages_facturation (decide_par);

-- 15 jours : la valeur que portait la signature `emettre(…, p_jours_echeance default 15)`.
insert into plateforme.reglages_facturation
  (envoi_courriel, jours_echeance, tentatives_max, motif, decide_par, decide_le)
values
  (true, 15, 3,
   'Défaut livré : envoi par courriel allumé dès le départ (décision du dirigeant n° 12, '
   '2 novembre 2026) ; échéance de 15 jours, celle des émissions antérieures.',
   null, timestamptz '2026-11-02 00:00:00+00');

do $$
declare t text;
begin
  foreach t in array array['reglages_commerciaux', 'reglages_facturation'] loop
    execute format('alter table plateforme.%I enable row level security', t);
    execute format('alter table plateforme.%I force row level security', t);
    execute format('revoke all on table plateforme.%I from public, anon, service_role', t);
    execute format('grant select on table plateforme.%I to authenticated', t);
    execute format('create policy %s_lire on plateforme.%I for select to authenticated '
                   'using ((select app.is_platform()))', t, t);
    execute format('create policy service_hors_perimetre on plateforme.%I as restrictive '
                   'for select to authenticated using ((select app.service()) is null)', t);
    execute format('create trigger service_hors_perimetre before insert or update or delete '
                   'on plateforme.%I for each statement execute function app.service_hors_perimetre()', t);
    execute format('create trigger %s_ajout_seul before update or delete on plateforme.%I '
                   'for each row execute function app.deny_mutation()', t, t);
  end loop;
end
$$;

/** La décision en vigueur, en jsonb, sans l'auteur. Lue par les portes ; jamais par un client. */
create function plateforme.reglage_commercial() returns plateforme.reglages_commerciaux
language plpgsql stable security definer set search_path = '' as $$
declare r plateforme.reglages_commerciaux;
begin
  select * into r from plateforme.reglages_commerciaux
   order by decide_le desc, id desc limit 1;
  if r.id is null then
    raise exception 'refus.referentiel.manquant' using errcode = 'no_data_found';
  end if;
  return r;
end
$$;
revoke all on function plateforme.reglage_commercial() from public, anon, authenticated;

create function plateforme.reglage_facturation() returns plateforme.reglages_facturation
language plpgsql stable security definer set search_path = '' as $$
declare r plateforme.reglages_facturation;
begin
  select * into r from plateforme.reglages_facturation
   order by decide_le desc, id desc limit 1;
  if r.id is null then
    raise exception 'refus.referentiel.manquant' using errcode = 'no_data_found';
  end if;
  return r;
end
$$;
revoke all on function plateforme.reglage_facturation() from public, anon, authenticated;

create function plateforme.commerce_regler(
  p_remise_pct_max numeric, p_remise_montant_max_mois numeric, p_remise_duree_max_mois smallint,
  p_mois_offerts_max smallint, p_lectures_offertes_max integer,
  p_prolongation_essai_max_jours smallint, p_fenetre_cumul_mois smallint, p_motif text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  if p_motif is null or length(btrim(p_motif)) = 0 then
    raise exception 'refus.commerce.motif_requis' using errcode = 'check_violation';
  end if;
  insert into plateforme.reglages_commerciaux
    (remise_pct_max, remise_montant_max_mois, remise_duree_max_mois, mois_offerts_max,
     lectures_offertes_max, prolongation_essai_max_jours, fenetre_cumul_mois, motif, decide_par)
  values (p_remise_pct_max, p_remise_montant_max_mois, p_remise_duree_max_mois,
          p_mois_offerts_max, p_lectures_offertes_max, p_prolongation_essai_max_jours,
          p_fenetre_cumul_mois, p_motif, auth.uid())
  returning id into v_id;
  return (select to_jsonb(r) - 'decide_par' from plateforme.reglages_commerciaux r where r.id = v_id);
end
$$;
revoke all on function plateforme.commerce_regler(numeric, numeric, smallint, smallint, integer, smallint, smallint, text)
  from public, anon;
grant execute on function plateforme.commerce_regler(numeric, numeric, smallint, smallint, integer, smallint, smallint, text)
  to authenticated;

create function plateforme.facturation_regler(
  p_envoi_courriel boolean, p_jours_echeance smallint, p_tentatives_max smallint, p_motif text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  if p_motif is null or length(btrim(p_motif)) = 0 then
    raise exception 'refus.commerce.motif_requis' using errcode = 'check_violation';
  end if;
  insert into plateforme.reglages_facturation
    (envoi_courriel, jours_echeance, tentatives_max, motif, decide_par)
  values (p_envoi_courriel, p_jours_echeance, p_tentatives_max, p_motif, auth.uid())
  returning id into v_id;
  return (select to_jsonb(r) - 'decide_par' from plateforme.reglages_facturation r where r.id = v_id);
end
$$;
revoke all on function plateforme.facturation_regler(boolean, smallint, smallint, text) from public, anon;
grant execute on function plateforme.facturation_regler(boolean, smallint, smallint, text) to authenticated;

-- ------------------------------------------------------------ 3. Le report : à vie

alter table plateforme.reglages_abonnement
  add column report_regle text references ref.regles_report (code);
create index reglages_abonnement_report_regle_fk_idx on plateforme.reglages_abonnement (report_regle);
comment on column plateforme.reglages_abonnement.report_regle is
  'La règle du report des lectures non consommées. Nulle sur les lignes antérieures, qui se lisent '
  'par `report_mois` (1 = un mois, 0 = aucun). `report_mois` reste pour l''histoire.';

insert into plateforme.reglages_abonnement
  (report_mois, annuel_ouvert, annuel_mois_offerts, report_regle, motif, decide_par, decide_le)
select 1, r.annuel_ouvert, r.annuel_mois_offerts, 'a_vie',
       'Défaut livré : les lectures non consommées sont gardées à vie (décisions du dirigeant du '
       '2 novembre 2026). Les lectures de l''essai n''y entrent pas ; à la résiliation, elles sont '
       'gelées, jamais remboursées.',
       null, timestamptz '2026-11-02 00:00:00+00'
  from (select coalesce((select x.annuel_ouvert from plateforme.reglages_abonnement x
                          order by x.decide_le desc, x.id desc limit 1), false) as annuel_ouvert,
               coalesce((select x.annuel_mois_offerts from plateforme.reglages_abonnement x
                          order by x.decide_le desc, x.id desc limit 1), 0::smallint)
                 as annuel_mois_offerts) r;

/** La règle de report d'une ligne : la sienne, ou celle que dit `report_mois` sur une ligne ancienne. */
create or replace function public.abonnement_reglage()
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select jsonb_build_object('report_mois', r.report_mois,
                               'report_regle', coalesce(r.report_regle,
                                                        case when r.report_mois = 1 then 'un_mois'
                                                             else 'aucun' end),
                               'annuel_ouvert', r.annuel_ouvert,
                               'annuel_mois_offerts', r.annuel_mois_offerts,
                               'motif', r.motif, 'decide_le', r.decide_le)
       from plateforme.reglages_abonnement r
      order by r.decide_le desc, r.id desc limit 1),
    jsonb_build_object('report_mois', 0, 'report_regle', 'aucun', 'annuel_ouvert', false,
                       'annuel_mois_offerts', 0, 'motif', null, 'decide_le', null))
$$;

/**
 * La tour règle le report des lectures : aucun, un mois, à vie. Daté, motivé ;
 * les réglages de l'année ouverte sont recopiés de la décision en vigueur.
 */
create function plateforme.report_regler(p_regle text, p_motif text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_r  jsonb := public.abonnement_reglage();
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  if p_motif is null or length(btrim(p_motif)) = 0 then
    raise exception 'refus.commerce.motif_requis' using errcode = 'check_violation';
  end if;
  insert into plateforme.reglages_abonnement
    (report_mois, annuel_ouvert, annuel_mois_offerts, report_regle, motif, decide_par)
  values (case when p_regle = 'aucun' then 0 else 1 end,
          (v_r ->> 'annuel_ouvert')::boolean, (v_r ->> 'annuel_mois_offerts')::smallint,
          p_regle, p_motif, auth.uid())
  returning id into v_id;
  return public.abonnement_reglage();
end
$$;
revoke all on function plateforme.report_regler(text, text) from public, anon;
grant execute on function plateforme.report_regler(text, text) to authenticated;

/** L'ancienne porte reste celle de l'écran actuel : 0 → aucun report, 1 → la règle « à vie » si elle vaut, sinon un mois. */
create or replace function plateforme.abonnement_regler(
  p_report_mois smallint, p_annuel_ouvert boolean, p_annuel_mois_offerts smallint, p_motif text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id     uuid;
  v_actuel text := public.abonnement_reglage() ->> 'report_regle';
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  insert into plateforme.reglages_abonnement
    (report_mois, annuel_ouvert, annuel_mois_offerts, report_regle, motif, decide_par)
  values (p_report_mois, p_annuel_ouvert, p_annuel_mois_offerts,
          case when p_report_mois = 0 then 'aucun'
               when v_actuel = 'a_vie' then 'a_vie'
               else 'un_mois' end,
          p_motif, auth.uid())
  returning id into v_id;
  return (select to_jsonb(r) - 'decide_par' from plateforme.reglages_abonnement r where r.id = v_id);
end
$$;
