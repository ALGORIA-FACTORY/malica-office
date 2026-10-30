-- Un jugement dit sous quelles règles il a été rendu.
--
-- 30 octobre 2026 (PR 142) : le Socle déduit ce que la facture prouve et
-- propose bien plus souvent. Mais `capture.analyses` est en ajout seul et le
-- dernier passage fait foi : une pièce jugée avant gardait son ancien verdict,
-- et le cabinet lisait « le Socle ne propose rien » sur une pièce que les
-- règles du jour proposent. Rien ne distinguait un jugement périmé d'un
-- jugement à jour.
--
-- La version vit dans le code, en un seul endroit
-- (`apps/api/src/scan/analyse.ts`, `REGLES_DU_JUGEMENT`), parce que les règles
-- y vivent. La base la porte sur chaque analyse posée. Les analyses déjà
-- inscrites la gardent NULLE : on ne réécrit pas l'histoire (R7), et nul veut
-- dire « jugée avant le marqueur », donc périmée.

begin;

alter table capture.analyses add column if not exists regles text;

comment on column capture.analyses.regles is
  'La version des règles du jugement qui a rendu cette analyse '
  '(`REGLES_DU_JUGEMENT`, apps/api/src/scan/analyse.ts). NULLE : rendue avant '
  'le marqueur, donc périmée. Une analyse périmée se rejuge '
  '(`office.rejugerLesPieces`, ou à l''ouverture de la pièce par le cabinet) ; '
  'une analyse nouvelle ne s''ajoute que si le jugement change.';

commit;
