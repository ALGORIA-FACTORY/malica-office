-- La vue des pièces montre la date de transmission.
--
-- ================================================================= POURQUOI
--
-- `20261011100000` a ajouté `capture.pieces.transmise_le` — la date sans
-- laquelle la règle de TVA du commanditaire était impossible — et a oublié
-- `public.pieces_v`, qui est la SEULE porte par laquelle l'application lit
-- les pièces. La colonne existait et restait invisible.
--
-- Relevé par `depots.test.ts`, qui exécute chaque lecture contre le schéma
-- réel : « office.extraitsTransmis : la colonne p.transmise_le n'existe pas ».
-- L'épreuve a fait son travail, et c'est elle qui a évité de livrer un écran
-- de TVA vide pour une raison introuvable.
--
-- La migration précédente est déjà déployée : on ne la réécrit pas, on en
-- joue une nouvelle. C'est la même règle que pour une donnée de référentiel.
--
-- Corps repris de `20260908120000`. Une colonne ajoutée, et rien d'autre.

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
       content_type,
       document_kind,
       document_kind_statut,
       -- Quand la pièce est partie au cabinet. C'est elle qui range la TVA :
       -- le cabinet déclare dans le mois où il reçoit.
       transmise_le
  from capture.pieces;

revoke all on table public.pieces_v from public, anon, service_role;
grant select on table public.pieces_v to authenticated;
