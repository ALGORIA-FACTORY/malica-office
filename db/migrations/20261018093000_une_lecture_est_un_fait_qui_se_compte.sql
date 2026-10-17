-- Une lecture est un fait qui se compte, une relecture n'en est pas une.
--
-- ================================================================== POURQUOI
--
-- `20261018090000` a posé ce à quoi une licence donne DROIT. Rien ne compte
-- encore ce qui est CONSOMMÉ, et donc rien ne s'arrête. Le produit annonce
-- « 65 lectures » sur l'écran d'accueil, et la 66e passe.
--
-- Le plafond est le modèle économique tout entier : c'est lui qui fait qu'un
-- client monte d'offre. Un plafond qui ne mord pas n'est pas un plafond,
-- c'est une phrase.
--
-- ============================================== POURQUOI PAS `agents.budgets`
--
-- `agents.budgets` existe et porte un `monthly_cost_cap`. Ce n'est pas le
-- même objet, et les confondre coûterait cher : ce plafond-là est EN DOLLARS
-- et borde ce que l'exploitant dépense chez Alibaba. Il protège ALGORIA d'une
-- facture, pas le client d'un dépassement. Deux plafonds, deux unités, deux
-- raisons.
--
-- ===================================== POURQUOI UNE PIÈCE NE SE COMPTE QU'UNE FOIS
--
-- L'unique sur `piece_id` est la décision commerciale la plus lourde de cette
-- migration, et elle découle de la règle du retour posée le 17 octobre :
-- « tant que personne ne l'a reçue, vous corrigez ce que vous voulez ».
--
-- Si une relecture consommait une lecture, corriger coûterait. Le client
-- apprendrait à ne pas corriger, les données se dégraderaient, et Malica
-- cesserait d'apprendre des corrections — qui sont précisément ce dont elle
-- apprend. On facture donc la PIÈCE, pas l'APPEL au modèle.
--
-- Le coût réel des relectures est borné ailleurs : par `agents.budgets`, qui
-- compte en dollars ce que l'exploitant dépense. Si la relecture devenait un
-- abus mesurable, c'est là qu'on le verrait, et une colonne `relectures` sur
-- cette table dirait combien. Elle n'existe pas encore parce qu'aucun chiffre
-- ne la réclame.
--
-- ================================================= POURQUOI LA PÉRIODE EST UNE DATE
--
-- Le premier jour du mois, pas un couple (année, mois) : une date se compare,
-- s'indexe et se décale d'un mois sans arithmétique maison. Et la période est
-- celle de la LECTURE, non celle de la pièce — une facture de septembre lue
-- en octobre consomme le quota d'octobre. C'est déjà la règle de la TVA dans
-- ce produit (« une pièce entre dans la TVA du mois où elle est transmise ») ;
-- on ne lui en oppose pas une seconde.

begin;

-- --- 1. Le registre des lectures --------------------------------------------

create table if not exists facturation.lectures (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references identity.organizations(id) on delete cascade,
  licence_id    uuid not null references facturation.licences(id) on delete restrict,

  -- La pièce qui a déclenché la lecture. ON DELETE RESTRICT, délibérément :
  -- une pièce consommée ne s'efface pas du registre en s'effaçant elle-même,
  -- sinon le quota du mois se rouvrirait à chaque suppression — et la
  -- suppression est libre avant transmission. Supprimer une pièce ne rend
  -- pas la lecture.
  piece_id      uuid not null unique references capture.pieces(id) on delete restrict,

  periode       date not null,
  consommee_le  timestamptz not null default now(),
  consommee_par uuid not null default auth.uid(),

  constraint lectures_periode_premier_du_mois
    check (extract(day from periode) = 1)
);

create index lectures_licence_periode_idx
  on facturation.lectures (licence_id, periode);
create index lectures_tenant_periode_idx
  on facturation.lectures (tenant_id, periode);

comment on table facturation.lectures is
  'Une ligne par pièce lue, jamais deux. Append-only : une lecture est un '
  'fait, et R7 interdit de réécrire un fait.';

-- R7 : append-only. On n'annule pas une lecture, on ne la déplace pas de
-- mois. La seule écriture est l'insertion.
select app.enable_tenant_rls('facturation', 'lectures', false, true);

-- --- 2. La consommation d'une licence ---------------------------------------

create or replace view facturation.consommation_v as
select
  d.licence_id,
  d.offre_code,
  d.statut,
  d.lectures_droit,
  coalesce(c.consommees, 0)::int                        as lectures_consommees,
  greatest(0, d.lectures_droit - coalesce(c.consommees, 0))::int as lectures_restantes,
  d.organisations,
  d.sieges_occupes,
  d.sieges_inclus,
  d.sieges_max,
  d.prix_mensuel_ht
from facturation.droits_v d
left join lateral (
  select count(*) as consommees
  from facturation.lectures l
  where l.licence_id = d.licence_id
    and l.periode = date_trunc('month', current_date)::date
) c on true;

comment on view facturation.consommation_v is
  'Le droit, le consommé et le reste, pour le mois en cours. C''est la ligne '
  '« Lectures restantes 9 » de l''écran d''accueil.';

-- --- 3. La porte ------------------------------------------------------------
--
-- Une seule fonction décide, et elle décide AVANT que le modèle soit appelé.
-- Le même choix que `capture_piece_set_vis` : une porte, pas un contrôle
-- recopié à trois endroits. `read-flow.ts` l'appelle en premier ; s'il ne
-- l'appelle pas, rien ne compte, et c'est une épreuve qui doit le dire.

create or replace function public.lecture_autorisee(p_piece uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant   uuid;
  v_vis      app.vis_t;
  v_licence  uuid;
  v_conso    record;
  v_deja     boolean;
begin
  select tenant_id, vis into v_tenant, v_vis
    from capture.pieces where id = p_piece;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  -- B6 : une pièce personnelle n'est jamais lue. La question se pose AVANT la
  -- lecture, et la réponse « chez moi » coûte zéro. Débiter le quota de la
  -- société pour un papier qui ne la regarde pas serait la facturer deux fois :
  -- une fois en argent, une fois en confiance.
  if v_vis = 'personnel'::app.vis_t then
    return jsonb_build_object(
      'autorisee', false, 'motif', 'piece_personnelle',
      'restantes', null, 'droit', null);
  end if;

  select licence_id into v_licence
    from facturation.licence_organisations where tenant_id = v_tenant;
  if v_licence is null then
    return jsonb_build_object(
      'autorisee', false, 'motif', 'organisation_sans_licence',
      'restantes', null, 'droit', null);
  end if;

  -- Une pièce déjà comptée se relit sans rien coûter. C'est la correction
  -- gratuite, et c'est volontaire (voir l'en-tête).
  select exists (select 1 from facturation.lectures where piece_id = p_piece)
    into v_deja;
  if v_deja then
    select * into v_conso from facturation.consommation_v where licence_id = v_licence;
    return jsonb_build_object(
      'autorisee', true, 'motif', 'relecture_gratuite',
      'restantes', v_conso.lectures_restantes, 'droit', v_conso.lectures_droit,
      'licence_id', v_licence);
  end if;

  select * into v_conso from facturation.consommation_v where licence_id = v_licence;

  -- Une licence suspendue n'arrête pas la caméra, elle arrête l'œil. La
  -- capture reste ouverte : les pièces s'empilent, non lues, et rien n'est
  -- perdu quand le client régularise.
  if v_conso.statut <> 'active' then
    return jsonb_build_object(
      'autorisee', false, 'motif', 'licence_' || v_conso.statut,
      'restantes', v_conso.lectures_restantes, 'droit', v_conso.lectures_droit,
      'licence_id', v_licence);
  end if;

  if v_conso.lectures_restantes <= 0 then
    return jsonb_build_object(
      'autorisee', false, 'motif', 'plafond_atteint',
      'restantes', 0, 'droit', v_conso.lectures_droit,
      'licence_id', v_licence);
  end if;

  return jsonb_build_object(
    'autorisee', true, 'motif', 'dans_le_forfait',
    'restantes', v_conso.lectures_restantes, 'droit', v_conso.lectures_droit,
    'licence_id', v_licence);
end
$$;

revoke all on function public.lecture_autorisee(uuid) from public, anon;
grant execute on function public.lecture_autorisee(uuid) to authenticated;

-- --- 4. L'inscription -------------------------------------------------------
--
-- Séparée de l'autorisation, et appelée APRÈS que la lecture a produit
-- quelque chose. Une lecture qui échoue — modèle indisponible, citation
-- orpheline levée par R2 — ne se facture pas : le client n'a rien reçu.

create or replace function public.lecture_consommer(p_piece uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant  uuid;
  v_licence uuid;
  v_verdict jsonb;
begin
  v_verdict := public.lecture_autorisee(p_piece);
  if not (v_verdict ->> 'autorisee')::boolean then
    raise exception 'lecture refusee : %', v_verdict ->> 'motif'
      using errcode = 'check_violation';
  end if;

  if (v_verdict ->> 'motif') = 'relecture_gratuite' then
    return v_verdict;
  end if;

  select tenant_id into v_tenant from capture.pieces where id = p_piece;
  v_licence := (v_verdict ->> 'licence_id')::uuid;

  insert into facturation.lectures (tenant_id, licence_id, piece_id, periode)
  values (v_tenant, v_licence, p_piece, date_trunc('month', current_date)::date)
  on conflict (piece_id) do nothing;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'lecture.consommee', 'capture', 'pieces', p_piece,
          jsonb_build_object('licence_id', v_licence));

  return public.lecture_autorisee(p_piece);
end
$$;

revoke all on function public.lecture_consommer(uuid) from public, anon;
grant execute on function public.lecture_consommer(uuid) to authenticated;

comment on function public.lecture_consommer(uuid) is
  'À appeler APRÈS une lecture réussie. Une lecture qui échoue ne se facture '
  'pas : le client n''a rien reçu.';

commit;
