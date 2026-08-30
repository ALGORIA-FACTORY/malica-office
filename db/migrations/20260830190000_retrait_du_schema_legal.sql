-- Le schéma `legal` est retiré, et avec lui la dernière dérive du dépôt.
--
-- ========================================================== POURQUOI
--
-- `legal.chunks.embedding` était déclaré `extensions.vector(768)` avec un index
-- HNSW cosinus. pgvector n'est pas installable sur ce poste — pas de chaîne de
-- compilation C++, pas de droits d'administration sur le répertoire de
-- PostgreSQL — et le chargeur local contournait le problème en RÉÉCRIVANT le
-- texte des migrations au vol : `vector(768)` devenait `real[]`, l'index HNSW
-- disparaissait, la création d'extension était retirée.
--
-- Conséquence : la base locale et une base de production n'avaient pas le même
-- schéma. Une dérive organisée, silencieuse, dans le seul endroit du produit
-- censé faire autorité.
--
-- Entre garder la substitution et retirer la fonctionnalité, on retire. Un
-- tableau de `real[]` ne fait pas de recherche sémantique : la fonctionnalité
-- n'existait pas non plus AVEC la substitution, elle en avait seulement l'air.
-- Une table qui ment sur son contenu est pire qu'une table absente.
--
-- ========================================================== CE QUI EST PERDU
--
-- Rien. Vérifié avant, pas supposé :
--
--   legal.documents  0 ligne
--   legal.versions   0 ligne
--   legal.chunks     0 ligne
--   capture.conformite 0 ligne — seule table à référencer `legal`
--
-- Aucun code applicatif ne mentionne le schéma `legal` : vérifié sur apps/.
--
-- ========================================================== CE QUI REVIENDRA
--
-- Le jour où pgvector sera installé par quelqu'un ayant les droits, ce schéma
-- se recrée par une migration nouvelle, avec le vrai type et le vrai index —
-- pas par un chargeur qui adapte.

-- La colonne qui portait le lien. `capture.conformite` est vide : aucun verdict
-- de conformité n'a jamais désigné une version de texte légal.
--
-- La vue publique la reprend, il faut donc la reposer sans elle. Elle est
-- recréée à l'identique pour tout le reste — mêmes colonnes, même ordre,
-- `security_invoker` compris, sans quoi elle contournerait la RLS.
drop view if exists public.conformite_v;

alter table capture.conformite drop column if exists legal_version_id;

create view public.conformite_v with (security_invoker = true) as
select id, tenant_id, piece_id, verdict, motif_id, note,
       pack_version_id, decided_by, decided_at
  from capture.conformite;

revoke all on public.conformite_v from public, anon, service_role;
grant select on public.conformite_v to authenticated;

drop schema if exists legal cascade;
