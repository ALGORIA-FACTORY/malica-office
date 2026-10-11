-- Ce que c'est se demande AVANT de lire, et la liste vit au référentiel.
--
-- ================================================================= POURQUOI
--
-- Le commanditaire, quatre fois depuis le 10 octobre : « normalement après le
-- scan un écran apparaît pour que l'utilisateur choisisse autre document,
-- achat ou vente, extrait bancaire, gouvernance. Et après le choix Malica lit
-- le document sur cette base. »
--
-- Aujourd'hui la lecture part en aveugle sur une invite de facture. Un extrait
-- bancaire est donc lu comme une facture ratée plutôt que reconnu comme un
-- relevé, et un procès-verbal appelle un modèle de vision pour rien.
--
-- ===================================== POURQUOI AVANT, ET NON APRÈS LA LECTURE
--
-- Le type décide de l'invite, et l'invite décide de la qualité. Demander
-- après, c'est corriger une lecture faite sur la mauvaise hypothèse ; demander
-- avant, c'est ne pas la faire.
--
-- Et cela COÛTE MOINS : un document de gouvernance n'appelle aucun modèle.
--
-- ============================================ CE QUE CETTE MIGRATION APPORTE
--
--   1. le type « autre document », qui manquait à la liste demandée ;
--   2. les libellés traduits des types offerts à la capture — `ref.labels`
--      portait déjà six namespaces et un seul était joint par du code ;
--   3. une colonne qui dit lesquels se proposent À LA CAPTURE. Les dix-sept
--      types du référentiel ne tiennent pas sur un écran de téléphone, et
--      choisir dans une liste de dix-sept est un autre genre d'abandon.
--
-- ====================================== POURQUOI « AUTRE » NE PART PAS AU CABINET
--
-- `famille = 'non_comptable'` impose `porte_ecriture = false` ET
-- `transmissible = false`, par une contrainte écrite le 2 septembre. Ce n'est
-- pas une limitation subie : un document que Malica ne sait pas nommer reste
-- chez son propriétaire. Il pourra le retyper — tout état a son retour — et
-- il partira alors sous son vrai nom.
--
-- ===================================================================== R11
--
-- `ref.document_types` n'a pas de date d'effet : c'est une table de types.
-- Aucune date du jour n'est écrite.

insert into ref.document_types
  (code, famille, libelle, fondement, porte_ecriture, transmissible, rang)
values
  ('autre_document', 'non_comptable', 'Autre document',
   'Un document que Malica ne sait pas nommer. Il est archivé et consultable, ne porte '
   'aucune écriture et ne part pas au cabinet tant que son type n''est pas précisé.',
   false, false, 95)
on conflict (code) do nothing;

-- --- Ce qui se propose au moment de la photo --------------------------------------------------

alter table ref.document_types
  add column if not exists propose_a_la_capture boolean not null default false;

comment on column ref.document_types.propose_a_la_capture is
  'Ce type est-il proposé au moment de la photo ? Les dix-sept types du '
  'référentiel ne tiennent pas sur un écran de téléphone, et choisir dans une '
  'liste de dix-sept est un autre genre d''abandon. Les autres restent '
  'atteignables ensuite, sur la pièce.';

update ref.document_types
   set propose_a_la_capture = true
 where code in ('facture_achat', 'facture_vente', 'ticket_caisse',
                'releve_bancaire', 'pv_ago', 'autre_document');

-- --- Les libellés traduits --------------------------------------------------------------------
--
-- `ref.labels` portait six namespaces et UN SEUL était joint par du code. Les
-- types de document n'y figuraient pas du tout : la colonne `libelle` est
-- française, et un écran en arabe aurait affiché « Facture d'achat ».
--
-- Les libellés de capture ne sont pas ceux du référentiel : « Facture
-- d'achat » devient « J'ai acheté » — c'est une question posée à quelqu'un
-- qui tient son téléphone, pas une nomenclature.

insert into ref.labels (ns, key, locale, value) values
  ('document_type','facture_achat','fr','Une facture que j''ai reçue'),
  ('document_type','facture_achat','en','An invoice I received'),
  ('document_type','facture_achat','ar','فاتورة تلقّيتُها'),
  ('document_type','facture_vente','fr','Une facture que j''ai émise'),
  ('document_type','facture_vente','en','An invoice I issued'),
  ('document_type','facture_vente','ar','فاتورة أصدرتُها'),
  ('document_type','ticket_caisse','fr','Un reçu ou un ticket'),
  ('document_type','ticket_caisse','en','A receipt or till slip'),
  ('document_type','ticket_caisse','ar','وصل أو تذكرة'),
  ('document_type','releve_bancaire','fr','Un relevé bancaire'),
  ('document_type','releve_bancaire','en','A bank statement'),
  ('document_type','releve_bancaire','ar','كشف حساب بنكي'),
  ('document_type','pv_ago','fr','Un document de gouvernance'),
  ('document_type','pv_ago','en','A governance document'),
  ('document_type','pv_ago','ar','وثيقة حوكمة'),
  ('document_type','autre_document','fr','Autre chose'),
  ('document_type','autre_document','en','Something else'),
  ('document_type','autre_document','ar','شيء آخر')
on conflict do nothing;

-- --- Le type se pose à l'enregistrement ---------------------------------------------------------
--
-- Corps repris de `20260824133728`. Un paramètre de plus, et le statut qui va
-- avec : « a_confirmer », parce que la personne l'a DÉCLARÉ sans que rien ne
-- le vérifie — la lecture pourra le contredire, et c'est elle qui tranchera.

create or replace function public.capture_piece_register(
  p_tenant uuid,
  p_source text,
  p_storage_path text,
  p_idempotency_key text,
  p_entity uuid default null,
  p_vis app.vis_t default 'partage',
  p_sha256 text default null,
  p_page_count smallint default null,
  p_document_kind text default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare v_id uuid;
begin
  if p_document_kind is not null
     and not exists (select 1 from ref.document_types d where d.code = p_document_kind) then
    raise exception 'type de document inconnu au referentiel : %', p_document_kind
      using errcode = 'foreign_key_violation';
  end if;

  insert into capture.pieces (tenant_id, entity_id, vis, source, storage_path,
                              sha256, page_count, idempotency_key,
                              document_kind, document_kind_statut)
  values (p_tenant, p_entity, p_vis, p_source, p_storage_path,
          p_sha256, p_page_count, p_idempotency_key,
          p_document_kind,
          case when p_document_kind is null then 'a_determiner' else 'a_confirmer' end)
  on conflict (tenant_id, idempotency_key) do update
     set updated_at = now()
  returning id into v_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (p_tenant, auth.uid(), 'piece.captured', 'capture', 'pieces', v_id,
          jsonb_build_object('source', p_source, 'document_kind', p_document_kind));

  return v_id;
end
$$;

revoke all on function public.capture_piece_register(uuid, text, text, text, uuid, app.vis_t, text, smallint, text)
  from public, anon;
grant execute on function public.capture_piece_register(uuid, text, text, text, uuid, app.vis_t, text, smallint, text)
  to authenticated;
