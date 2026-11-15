-- ======================================================================
--  Sous mandat externe actif, le comptable interne ne tient plus les livres
--  (décision du dirigeant, 12 novembre 2026, point C-1 remplacé).
--
--  (A) Sans comptabilité externe engagée : le comptable interne tient les
--      livres (inscrit, valide, force, retourne). Inchangé.
--  (B) Avec une comptabilité externe au mandat actif : la comptabilité externe
--      fait TOUT. Le comptable interne ne prépare plus, ne propose plus, ne
--      valide plus, ne force plus.
--
--  Ce qui change ici : `app.dossiers_du_comptable_interne()` — le socle de tous
--  les droits « tient les livres » (`app.supervise_le_dossier`,
--  `app.prepare_le_dossier`, `app.engaged_orgs`, `app.export_mandats`, la file
--  et l'espace de comptabilité) — ne retient plus une société qui a un mandat
--  externe en vigueur. Aucun droit nouveau n'est accordé. Le rôle de
--  propriétaire non principal, qui devait servir à transmettre les pièces en
--  (B), n'est PAS donné ici : il occupe une place payée (modèle du 19 octobre,
--  `20261022110000`), ce qui contredit « gratuit, rien ne change ». Décision
--  ouverte, voir docs/espace-comptable-interne.md.
-- ======================================================================

create or replace function app.dossiers_du_comptable_interne()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select x from app.orgs_avec_droit_de(auth.uid(), 'livres.tenir') x
   where app.api_tenant() is null
     and (select app.service()) is null
     and not app.mandat_externe_en_vigueur(x)
$$;
