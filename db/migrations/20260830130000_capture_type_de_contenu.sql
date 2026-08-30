-- Le type de contenu d'une pièce appartient à la base.
--
-- Le stockage Supabase le portait pour nous : `download()` rendait un Blob dont
-- le `type` venait de l'objet déposé. En servant les pièces nous-mêmes, ce type
-- doit venir d'ailleurs — et « ailleurs » ne peut pas être une déduction sur
-- l'extension du nom de fichier. Deviner « image/jpeg » sur un PDF enverrait la
-- pièce dans la mauvaise passe de lecture.
--
-- Une colonne, écrite à l'enregistrement, lue à la restitution.

alter table capture.pieces add column if not exists content_type text;

create or replace view public.pieces_v with (security_invoker = true) as
select id,
       tenant_id,
       entity_id,
       vis,
       source,
       storage_path,
       sha256,
       page_count,
       status,
       idempotency_key,
       created_by,
       created_at,
       updated_at,
       content_type
  from capture.pieces;
