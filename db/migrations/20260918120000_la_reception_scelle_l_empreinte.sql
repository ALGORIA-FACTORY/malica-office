-- 3B-1 — La réception scelle l'empreinte, et voit le doublon à ce moment-là.
--
-- `capture.pieces.sha256` et son index d'unicité par tenant existaient depuis
-- le 11 septembre (20260911160000), mais rien ne les remplissait : l'API
-- passait `p_sha256 => null` à l'enregistrement, et la route de dépôt écrivait
-- les octets sans les hacher. Désormais la route hache le flux qu'elle écrit, et
-- cette fonction pose l'empreinte.
--
-- Trois cas :
--   • la pièce n'a pas d'empreinte, aucune autre pièce du tenant n'a la même :
--     l'empreinte est posée — la pièce est SCELLÉE ;
--   • la pièce est déjà scellée : les mêmes octets passent (un renvoi réseau),
--     d'autres octets sont refusés — le contenu d'une pièce comptable ne change
--     pas sous son identifiant ;
--   • une autre pièce du tenant porte déjà cette empreinte : c'est un DOUBLON
--     STRICT. Le dépôt n'est pas refusé — les versions installées de
--     l'application réessaieraient sans fin — ; la pièce est marquée
--     `doublon_de`, et c'est le contrôle « doublon » qui en tirera le verdict.
--
-- La fonction s'exécute sous l'identité de l'appelant (security invoker) : elle
-- ne voit que ce que la RLS lui montre. Un doublon d'une pièce PERSONNELLE d'un
-- collègue, invisible à l'appelant, heurte l'index d'unicité sans qu'on puisse
-- nommer l'original : la pièce reste alors sans empreinte, et rien n'en révèle
-- l'existence.
--
-- Ajouts seulement : une colonne facultative, une fonction.

alter table capture.pieces
  add column if not exists doublon_de uuid references capture.pieces(id) on delete set null;

comment on column capture.pieces.doublon_de is
  'Doublon strict : la pièce du même tenant dont les octets ont la même empreinte SHA-256, détectée à la réception.';

create or replace function public.capture_sceller_empreinte(p_piece uuid, p_sha256 text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v record;
  v_original uuid;
begin
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'empreinte invalide' using errcode = '22023';
  end if;
  select id, tenant_id, sha256, doublon_de into v
    from capture.pieces where id = p_piece for update;
  if v.id is null then
    raise exception 'pièce introuvable' using errcode = 'P0002';
  end if;

  -- Déjà scellée : même contenu, rien à faire ; autre contenu, refus.
  if v.sha256 is not null then
    if v.sha256 <> p_sha256 then
      raise exception 'Le contenu de cette pièce est scellé : il ne se remplace pas.'
        using errcode = '23514';
    end if;
    return jsonb_build_object('sha256', v.sha256, 'doublonDe', null, 'etat', 'deja_scellee');
  end if;
  if v.doublon_de is not null then
    return jsonb_build_object('sha256', p_sha256, 'doublonDe', v.doublon_de, 'etat', 'doublon');
  end if;

  select id into v_original
    from capture.pieces
   where tenant_id = v.tenant_id and sha256 = p_sha256 and id <> p_piece
   limit 1;

  if v_original is not null then
    update capture.pieces set doublon_de = v_original where id = p_piece;
  else
    begin
      update capture.pieces set sha256 = p_sha256 where id = p_piece;
    exception when unique_violation then
      -- L'original existe mais n'est pas visible à l'appelant : on ne le nomme
      -- pas, on ne le révèle pas.
      return jsonb_build_object('sha256', p_sha256, 'doublonDe', null, 'etat', 'non_scellee');
    end;
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v.tenant_id, auth.uid(), 'piece.recue', 'capture', 'pieces', p_piece,
          jsonb_build_object('sha256', p_sha256, 'doublonDe', v_original));

  return jsonb_build_object('sha256', p_sha256, 'doublonDe', v_original,
                            'etat', case when v_original is null then 'scellee' else 'doublon' end);
end $$;

revoke all on function public.capture_sceller_empreinte(uuid, text) from public, anon;
grant execute on function public.capture_sceller_empreinte(uuid, text) to authenticated;
