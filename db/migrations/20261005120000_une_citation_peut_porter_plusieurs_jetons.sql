-- Une citation peut porter plusieurs jetons.
--
-- ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
--
-- 4 octobre 2026. Une facture de loyer imprimée « 2 800,000 » est lue 2,000.
-- « 3 020,000 » est lu 3,000. « 220,000 » et « 573,800 », eux, sont justes.
--
-- La loi est sans exception : tout montant portant une espace de milliers est
-- tronqué à l'espace, et le PREMIER jeton reste. Le plan de jetons découpe sur
-- `/\S+/g` — « 2 800,000 » EST deux jetons — et l'invite de désignation
-- interdisait au modèle d'en citer plus d'un pour un montant.
--
-- Cette migration ferme le dernier des trois maillons. Les deux autres sont du
-- code : l'invite (`vision.ts`) ne l'interdit plus, et `citer()`
-- (`token-plan.ts`) propage désormais la fin de plage. Restait la base, qui ne
-- pouvait pas la stocker : `capture.citations` porte un `token_id` unique et
-- aucune borne de fin.
--
-- ================================================ LA PROMESSE QUI N'ÉTAIT PAS TENUE
--
-- `apps/api/src/scan/analyse.ts` annonce en commentaire, depuis le 24 août :
--
--     « C'est ce qui règle le piège des montants coupés en deux jetons
--       (« 1 » et « 234,560 ») : ils se réunissent ici, par leurs citations. »
--
-- La requête qui devait le faire joint `capture.citations` à
-- `capture.token_plan` par `token_id` et concatène les textes par champ. Avec
-- une seule citation par champ, le `join(" ")` ne joignait jamais rien. Le
-- commentaire décrivait une intention, pas un mécanisme — et il a sans doute
-- détourné l'enquête pendant six semaines.
--
-- ===================================================================== LA RÈGLE
--
-- `ordinal_end` est FACULTATIF, et c'est le point. Une valeur qui tient dans un
-- jeton n'en porte pas : une plage d'un jeton n'est pas une plage, et la
-- citation ne doit pas prétendre le contraire. Les citations déjà en base
-- restent donc valides, sans reprise.
--
-- Deux garanties ajoutées, sur le modèle du refus existant :
--
--   — le jeton de FIN doit exister lui aussi, sinon « R2 : plage orpheline ».
--     Sans ce contrôle, une fin de plage inventée élargirait silencieusement
--     le cadre cité et R2 ne vaudrait plus rien ;
--   — le cadre stocké devient l'UNION des jetons de la plage. Il était celui
--     du premier jeton seul : l'écran surlignait « 2 » sous un montant annoncé
--     2 800,000, c'est-à-dire montrait à la personne un chiffre qui n'était pas
--     celui dont on lui parlait.
--
-- Ce que cette migration N'AUTORISE PAS : assembler des jetons non contigus.
-- La plage est un intervalle sur une page, et le texte est relu dans l'ordre
-- des ordinaux — jamais composé.

-- --- 1. La borne de fin ---------------------------------------------------------------------

alter table capture.citations add column if not exists ordinal_end smallint;

comment on column capture.citations.ordinal_end is
  'Dernier ordinal de la plage citée, quand la valeur occupe plusieurs jetons '
  '(un montant coupé par l''espace des milliers, une date en toutes lettres, un '
  'libellé en plusieurs mots). NULL quand la valeur tient dans le seul jeton '
  'désigné par token_id.';

-- Une plage va de l'avant : une fin antérieure au début n'a aucun sens, et
-- `ordinal_end` égal au début serait une plage d'un jeton, qu'on écrit NULL.
-- La contrainte porte sur la colonne seule — l'ordinal de début vit dans
-- `token_plan`, donc la cohérence avec lui est tenue par la fonction, qui est
-- le seul chemin d'écriture.
alter table capture.citations
  add constraint citations_ordinal_end_positif
  check (ordinal_end is null or ordinal_end >= 0);

-- --- 2. La vue, qui rend la borne lisible ---------------------------------------------------
-- La colonne est AJOUTÉE EN FIN : `create or replace view` l'accepte, là où
-- toute insertion au milieu exigerait un `drop`, donc de recréer les droits.

create or replace view public.citations_v
with (security_invoker = true) as
select id, tenant_id, piece_id, field, token_id, page, bbox, zone,
       ui_field, ui_role, created_at, ordinal_end
from capture.citations;

grant select on public.citations_v to authenticated;

-- --- 3. La lecture persistée, qui sait écrire une plage -------------------------------------
-- Corps repris de `20260918130000`, à l'identique sauf la boucle des citations.
-- La signature ne change pas : aucun appel n'est à reprendre.

create or replace function public.capture_read_persist(
  p_piece uuid,
  p_tokens jsonb,
  p_contract text,
  p_extract jsonb,
  p_citations jsonb,
  p_flags jsonb default '[]'::jsonb,
  p_mode text default null,
  p_confiance jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  v_tenant uuid;
  v_tok jsonb;
  v_cit jsonb;
  v_token_id uuid;
  v_count int := 0;
  v_kind text;
  v_extraction uuid;
  v_page smallint;
  v_ordinal int;
  v_fin int;
begin
  select tenant_id into v_tenant from capture.pieces where id = p_piece;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  -- R7 : une lecture est un fait. On ne la remplace pas.
  if exists (select 1 from capture.extractions where piece_id = p_piece) then
    raise exception 'R7 : cette piece a deja ete lue — rephotographiez-la pour en creer une nouvelle'
      using errcode = 'restrict_violation';
  end if;
  for v_tok in select * from jsonb_array_elements(p_tokens)
  loop
    insert into capture.token_plan (tenant_id, piece_id, page, ordinal, text,
                                    x0, y0, x1, y1, confidence)
    values (v_tenant, p_piece,
            (v_tok->>'page')::smallint, (v_tok->>'ordinal')::int, v_tok->>'text',
            (v_tok->>'x0')::numeric, (v_tok->>'y0')::numeric,
            (v_tok->>'x1')::numeric, (v_tok->>'y1')::numeric,
            nullif(v_tok->>'confidence','')::numeric);
  end loop;
  for v_cit in select * from jsonb_array_elements(p_citations)
  loop
    v_page := (v_cit->>'page')::smallint;
    v_ordinal := (v_cit->>'ordinal')::int;
    -- La clé arrive en camelCase : c'est le nom du champ TypeScript
    -- (`TokenRef.ordinalEnd`), sérialisé tel quel, comme l'est déjà `bbox`.
    v_fin := nullif(v_cit->>'ordinalEnd', '')::int;
    if v_fin is not null and v_fin <= v_ordinal then
      v_fin := null;
    end if;

    select t.id into v_token_id
      from capture.token_plan t
     where t.piece_id = p_piece
       and t.page = v_page
       and t.ordinal = v_ordinal;
    if v_token_id is null then
      raise exception 'R2 : citation orpheline pour le champ % — aucun token lu a cet emplacement',
        v_cit->>'field' using errcode = 'check_violation';
    end if;

    -- Une fin de plage qui ne désigne aucun jeton élargirait le cadre cité
    -- sans rien derrière : c'est le même défaut que la citation orpheline.
    if v_fin is not null and not exists (
      select 1 from capture.token_plan t
       where t.piece_id = p_piece and t.page = v_page and t.ordinal = v_fin
    ) then
      raise exception 'R2 : plage de citation orpheline pour le champ % — aucun token lu a l''ordinal de fin %',
        v_cit->>'field', v_fin using errcode = 'check_violation';
    end if;

    -- Le cadre est l'union des jetons cités. Pour un jeton seul, c'est le sien.
    insert into capture.citations (tenant_id, piece_id, field, token_id, page, ordinal_end,
                                   bbox, zone, ui_field, ui_role, bbox_page_px)
    select v_tenant, p_piece, v_cit->>'field', v_token_id, v_page, v_fin,
           jsonb_build_object('x0', min(t.x0), 'y0', min(t.y0),
                              'x1', max(t.x1), 'y1', max(t.y1)),
           nullif(v_cit->>'zone',''),
           nullif(v_cit->>'ui_field',''),
           nullif(v_cit->>'ui_role',''),
           case when v_cit ? 'bbox' then v_cit->'bbox' else null end
      from capture.token_plan t
     where t.piece_id = p_piece
       and t.page = v_page
       and t.ordinal between v_ordinal and coalesce(v_fin, v_ordinal);
    v_count := v_count + 1;
  end loop;
  insert into capture.extractions (tenant_id, piece_id, contract, payload, flags,
                                   mode_lecture, confiance_par_champ)
  values (v_tenant, p_piece, p_contract, p_extract, p_flags,
          nullif(trim(coalesce(p_mode, '')), ''), coalesce(p_confiance, '{}'::jsonb))
  returning id into v_extraction;

  -- Le type lu, s'il fait partie du vocabulaire, monte sur la pièce : lu,
  -- pas encore confirmé. Un type déjà confirmé par la personne n'est jamais
  -- écrasé par une lecture.
  select t.code into v_kind
    from ref.document_types t
   where t.code = p_extract->>'document_kind';

  update capture.pieces
     set status = case when status in ('capturee','retournee') then 'lue' else status end,
         document_kind = case when document_kind_statut = 'confirme' then document_kind
                              else coalesce(v_kind, document_kind) end,
         document_kind_statut = case when document_kind_statut = 'confirme' then 'confirme'
                                     when v_kind is not null then 'a_confirmer'
                                     else document_kind_statut end,
         updated_at = now()
   where id = p_piece;

  -- Qui a lu quoi, comment : l'audit de la lecture.
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.read', 'capture', 'extractions', v_extraction,
          jsonb_build_object('piece', p_piece, 'contract', p_contract,
                             'mode', nullif(trim(coalesce(p_mode, '')), ''),
                             'citations', v_count,
                             'flags', jsonb_array_length(coalesce(p_flags, '[]'::jsonb))));

  return jsonb_build_object('piece_id', p_piece, 'citations', v_count,
                            'document_kind', v_kind, 'extraction_id', v_extraction);
end
$function$;

revoke all on function public.capture_read_persist(uuid, jsonb, text, jsonb, jsonb, jsonb, text, jsonb)
  from public, anon;
grant execute on function public.capture_read_persist(uuid, jsonb, text, jsonb, jsonb, jsonb, text, jsonb)
  to authenticated;
