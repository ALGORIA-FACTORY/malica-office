-- Une pièce n'est jamais une page : son type de contenu se choisit dans une liste fermée.
--
-- ================================================================== POURQUOI
--
-- Audit de sécurité du 6 novembre 2026, constat S1 (`docs/audit-2026-11-06/securite.md`) :
-- `capture.enregistrer` acceptait n'importe quel `contentType`, et `GET /pieces/:id/contenu`
-- le rendait tel quel. Un collaborateur enregistrait une « pièce » `text/html` (ou
-- `image/svg+xml`), y déposait une page qui porte un script, et quiconque l'ouvrait — le
-- dirigeant, l'expert du cabinet une fois la pièce transmise — l'exécutait sur l'origine de
-- l'application, avec sa session.
--
-- ================================================================== CE QUI CHANGE
--
-- La porte qui pose le type (`public.capture_piece_poser_chemin`, seule à écrire
-- `content_type`) n'admet plus que ce que produisent le scanner, l'import d'images et le
-- dépôt de PDF : `application/pdf`, `image/jpeg`, `image/png`, `image/webp`, `image/heic`.
-- Tout autre type est refusé par une clé (`refus.piece.type_de_contenu`, en fr, en et ar).
-- Le type se garde en minuscules : `Image/JPEG` est `image/jpeg`.
--
-- Les deux autres verrous sont dans l'API (`stockage.ts`) : le dépôt lit les premiers octets
-- et refuse ceux qui démentent le type ; le service rend toute pièce en pièce jointe, sous
-- `nosniff` et une CSP `sandbox`, et une ligne ancienne de type hors liste en
-- `application/octet-stream`.
--
-- Pas de contrainte sur la colonne : une contrainte, même `not valid`, se vérifie à chaque
-- mise à jour de la ligne, et une pièce ancienne de type hors liste ne pourrait plus changer
-- d'état. La porte est le seul écrivain de la colonne (« seules les portes écrivent »).
--
-- REJEU (R11) : aucune donnée de référence n'est écrite.

create or replace function public.capture_piece_poser_chemin(p_piece uuid, p_content_type text)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_chemin text;
  v_type text := lower(btrim(p_content_type));
begin
  if not app.piece_modifiable(p_piece)
     or not exists (select 1 from capture.pieces p
                     where p.id = p_piece and p.created_by is not distinct from auth.uid()) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  if v_type is not null
     and v_type <> all (array['application/pdf', 'image/jpeg', 'image/png',
                              'image/webp', 'image/heic']) then
    raise exception 'refus.piece.type_de_contenu' using errcode = '22023';
  end if;
  update capture.pieces
     set storage_path = tenant_id::text || '/' || id::text,
         content_type = coalesce(v_type, content_type)
   where id = p_piece
  returning storage_path into v_chemin;
  return v_chemin;
end
$function$;
