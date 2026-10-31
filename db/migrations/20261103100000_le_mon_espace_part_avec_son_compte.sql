-- Son Mon espace part avec son compte (« Malica sans blocage », lot 4).
--
-- Un siège qui quitte la société y laisse ses pièces de la société ; son Mon
-- espace reste lisible de lui seul (`20261103090000`). Il manquait le reste :
-- le voir hors de la société, le supprimer (la porte exigeait l'adhésion :
-- « piece introuvable »), et la garantie qu'il n'entre jamais dans une
-- société dont il n'est plus membre (la RLS d'écriture filtrait la ligne en
-- silence, et l'écran croyait la pièce déplacée).
--
-- Ce que ce fichier pose : `public.mon_espace_hors_societe()`, ses pièces
-- privées des sociétés qu'il a quittées, avec le nom de la société. Les
-- supprimer est à `capture_piece_supprimer` (`20261103090000`), qui le permet
-- à l'auteur d'une pièce privée, même hors de la société.

begin;

create or replace function public.mon_espace_hors_societe()
returns table (
  id           uuid,
  tenant_id    uuid,
  societe      text,
  created_at   timestamptz,
  content_type text,
  document_kind text
)
language sql
stable
security definer
set search_path = ''
as $$
  -- Ses pièces privées, et seulement celles des sociétés dont il n'est plus
  -- membre : celles d'une société où il est encore se lisent dans la société.
  select p.id, p.tenant_id, o.name, p.created_at, p.content_type, p.document_kind
    from capture.pieces p
    join identity.organizations o on o.id = p.tenant_id
   where auth.uid() is not null
     and p.created_by = auth.uid()
     and p.vis = 'personnel'::app.vis_t
     and p.archivee_le is null
     and not exists (select 1 from capture.remplacements r where r.piece_id = p.id)
     and p.tenant_id not in (select app.member_orgs())
   order by p.created_at desc
$$;

revoke all on function public.mon_espace_hors_societe() from public, anon;
grant execute on function public.mon_espace_hors_societe() to authenticated;

commit;
