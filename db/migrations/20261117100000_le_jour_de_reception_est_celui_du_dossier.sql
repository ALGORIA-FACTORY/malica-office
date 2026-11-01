-- Le jour de réception est celui du dossier (1er novembre 2026).
--
-- Main rouge à 23:02 UTC : une pièce datée du jour reçut « datée après sa
-- réception ». La date de la pièce est un jour LOCAL ; le jour de réception se
-- lisait en UTC (`to_char(created_at, 'YYYY-MM-DD')`, `created_at::date`),
-- donc la veille entre minuit et une heure à Tunis. En production, une
-- facture du jour photographiée à 00:30 recevait une fausse réserve, et le
-- mois de réception pouvait basculer.
--
-- UNE règle, en UN endroit : `pieces_v.recue_le`, le jour civil du
-- `created_at` de la pièce dans le fuseau de son DOSSIER — son réglage
-- (`identity.organizations.fuseau`), sinon celui de sa juridiction
-- (`ref.calendrier_juridiction.fuseau`, R10), comme `app.fuseau_du_cabinet`
-- (20261029210000). Aucun des deux : refus nommé, jamais un repli sur UTC (R4).
--
-- Pourquoi une colonne de la vue, et pas `app.fuseau_du_cabinet` ni une
-- fonction appelée par pièce :
--   * `app.fuseau_du_cabinet` est `security definer` sans garde — elle lisait
--     le fuseau de n'importe quelle organisation — et son exécution a été
--     retirée à tous (20261029230000). La vue est `security_invoker` : elle lit
--     l'organisation sous la RLS de l'appelant (`organizations_sel` : ses
--     organisations, ses mandats, ses cabinets) et n'apprend rien qu'il ne
--     puisse déjà lire.
--   * Une fonction qui relit l'organisation à chaque appel relance, à chaque
--     pièce, une requête et les politiques RLS de l'organisation. Dans la
--     vue, l'organisation se lit dans la requête de l'appelant, ses politiques
--     préparées une fois ; et une lecture qui ne demande pas `recue_le` ne la
--     calcule pas.
--   * Une sous-requête, pas une jointure : la vue reste celle d'UNE table, et
--     une écriture directe y bute toujours sur le droit refusé, comme avant
--     (`les-clients-n-ecrivent-que-par-les-portes.test.ts`).
--
-- REJEU (R11) : `create or replace` ; la vue est reprise de sa définition EN
-- VIGUEUR (20261104090000), la colonne ajoutée à la fin.

begin;

-- Un fuseau qui manque se dit : jamais une date lue en UTC à sa place.
create or replace function app.fuseau_defini(p_fuseau text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_fuseau is null then
    raise exception 'refus.fuseau.dossier_non_defini' using errcode = '22023';
  end if;
  return p_fuseau;
end $$;
revoke all on function app.fuseau_defini(text) from public, anon;
grant execute on function app.fuseau_defini(text) to authenticated;

create or replace view public.pieces_v with (security_invoker = true) as
select p.id, p.tenant_id, p.entity_id, p.vis, p.source, p.storage_path, p.sha256,
       p.page_count, p.status, p.idempotency_key, p.created_by, p.created_at,
       p.updated_at, p.content_type, p.document_kind, p.document_kind_statut,
       p.transmise_le,
       case when p.gardee_le is null then null
            else app.garde_en_vigueur(p.id, p.gardee_le) end as gardee_le,
       p.source_piece_id, p.archivee_le,
       (select r.remplacee_par from capture.remplacements r where r.piece_id = p.id) as remplacee_par,
       (select r.piece_id from capture.remplacements r where r.remplacee_par = p.id) as remplace,
       -- La photo qui fait foi : elle-même, ou la dernière de sa chaîne. Un lien
       -- vers une version précédente mène là en un geste, même au bout de A → B → C.
       case when exists (select 1 from capture.remplacements r where r.piece_id = p.id)
            then app.version_courante(p.id) else p.id end as version_courante,
       -- Le jour de réception, au fuseau du dossier.
       (p.created_at at time zone app.fuseau_defini(
          (select coalesce(o.fuseau, c.fuseau)
             from identity.organizations o
             left join ref.calendrier_juridiction c on c.jurisdiction = o.jurisdiction
            where o.id = p.tenant_id)))::date as recue_le
  from capture.pieces p;

commit;
