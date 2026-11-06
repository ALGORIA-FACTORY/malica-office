-- ======================================================================
--  L'accès total ne ralentit pas la file (staging, 5 novembre 2026).
--
--  Constat, reproduit en local : sous l'accès total, `supervision.listClients`
--  et `supervision.queue` dépassaient le délai de 30 s et rendaient une
--  « erreur interne » — l'accueil du cabinet, les Clients, les Honoraires,
--  l'Export, les Réglages, le Rapprochement s'arrêtaient. Sans l'accès total,
--  les mêmes lectures rendent en 2 à 3 s sur 300 pièces.
--
--  Cause : `app.adhesions_de` (20261129090000) appelait
--  `app.role_d_acces_total(org)` pour CHAQUE organisation, deux fois, et chaque
--  appel relisait `app.a_l_acces_total()` puis `app.is_platform()`. Or
--  `app.piece_lisible` la relit pour chaque pièce (par `app.orgs_avec_droit`,
--  depuis `app.suivi_de_la_piece`) : pièces × organisations × deux sondes.
--
--  Correction : la décision se lit UNE fois par appel, et les organisations
--  se joignent au référentiel en une seule lecture. Le résultat est le même,
--  ligne pour ligne : mêmes adhésions réelles, même adhésion virtuelle par
--  organisation non archivée dont le type donne un rôle, même
--  `par_acces_total`.
-- ======================================================================

begin;

create or replace function app.adhesions_de(p_personne uuid)
returns table (tenant_id uuid, role text, par_acces_total boolean)
language sql
stable
security definer
set search_path = ''
as $$
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
$$;

revoke all on function app.adhesions_de(uuid) from public, anon, authenticated;

commit;
