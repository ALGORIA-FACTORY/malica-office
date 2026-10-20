-- L'expert mandaté inscrit les écritures du dossier (20 octobre 2026).
--
-- BLOQUANT trouvé en recette : le cabinet ne pouvait créer AUCUNE écriture
-- nouvelle. `socle.ecritures` n'admettait à l'insertion que les membres de la
-- PME (`socle_ecritures_ins`) et, côté cabinet, les seules contre-passations
-- (`ecritures_ins_contrepassation`, `reverses_id is not null`). L'écriture du
-- règlement, celle des retenues à la source, et la réimputation après
-- contre-passation étaient donc refusées : « new row violates row-level
-- security policy for table "ecritures" ».
--
-- La politique ajoutée laisse l'EXPERT d'un cabinet engagé (pas l'assistant,
-- pas le collaborateur) inscrire une écriture partagée dans le dossier qu'il
-- tient, et ses lignes (`lignes_ins_cabinet` ne les admettait que sous une
-- contre-passation). Le contenu reste gouverné par `socle_ecriture_propose`
-- puis par `socle_ecriture_book` (équilibre, comptes du plan).
--
-- REJEU (R11) : `drop policy if exists`.

begin;

drop policy if exists ecritures_ins_expert on socle.ecritures;
create policy ecritures_ins_expert on socle.ecritures
  for insert to authenticated
  with check (
    vis = 'partage'::app.vis_t
    and tenant_id in (select app.engaged_orgs_as_expert())
  );

drop policy if exists lignes_ins_expert on socle.ecriture_lignes;
create policy lignes_ins_expert on socle.ecriture_lignes
  for insert to authenticated
  with check (
    tenant_id in (select app.engaged_orgs_as_expert())
    and exists (
      select 1 from socle.ecritures e
       where e.id = ecriture_id and e.vis = 'partage'::app.vis_t
    )
  );

commit;
