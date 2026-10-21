-- Un mandat terminé garde le nom du client (ANO-013, recette du 21 octobre 2026).
--
-- Après une révocation, la liste des clients du cabinet montrait « — ·
-- Terminé » : le dossier du client devient invisible au cabinet à l'instant
-- où le mandat se termine, son nom avec lui. Le cabinet a tenu ce dossier ;
-- il doit savoir LEQUEL s'est terminé.
--
-- La fonction ne rend que le NOM, et seulement d'une organisation avec
-- laquelle une organisation de l'appelant a eu un mandat, quel qu'en soit
-- l'état. Rien d'autre du dossier ne redevient lisible.
create or replace function app.nom_d_un_client_du_cabinet(p_pme uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select o.name
    from identity.organizations o
   where o.id = p_pme
     and exists (
       select 1
         from identity.engagements e
        where e.pme_org_id = p_pme
          and e.cabinet_org_id in (select app.member_orgs())
     )
$$;

revoke all on function app.nom_d_un_client_du_cabinet(uuid) from public, anon, service_role;
grant execute on function app.nom_d_un_client_du_cabinet(uuid) to authenticated;

comment on function app.nom_d_un_client_du_cabinet(uuid) is
  'Le nom d''un client (actuel ou ancien) d''un cabinet de l''appelant ; null sinon. '
  'Rien d''autre du dossier ne se lit par elle.';
