-- Le numéro de série imprimé sous un article est un champ de la ligne, pas la suite de sa
-- désignation.
--
-- ================================================================== POURQUOI
--
-- 4 novembre 2026, banc sans IA, algoria-018 (scan) : la cellule de la désignation porte
-- l'article sur sa première ligne, puis « SN : 981368512458374 » sur la suivante. Lue du
-- milieu, la ligne d'article rendait « Multiprise parafoudre 5 prises SN:981368512458374 » :
-- une désignation fausse. La vérité du jeu ne met pas le numéro de série dans la
-- désignation, et un comptable ne l'y met pas non plus.
--
-- ================================================================== CE QUI CHANGE
--
-- Le champ `numero_serie_ligne` de la parcelle des lignes de la grille facture (concept
-- `numero_serie`, déjà au pack), ses repères (« SN », « S/N », « N° série »…), répété et
-- facultatif. Le moteur (`packages/sudoku/src/lignes.rs`, `Contexte::designation`) ne
-- prolonge plus une désignation par une ligne de sa cellule qui commence par le repère d'un
-- AUTRE champ de la parcelle suivi d'une valeur chiffrée, ou de rien (une valeur perdue).
-- Aucun repère n'est écrit dans le moteur.
--
-- R10 : défaut livré (`defaut_a_valider`), que l'expertise corrige. REJEU (R11) : aucune
-- horloge n'écrit dans `ref`.

begin;

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut, concept_id, role, repetee)
select d.grille_id, d.parcelle, 'numero_serie_ligne', 'Numéro de série de l''article',
       'identifiant', 'non', null,
       array['SN', 'S/N', 'N° série', 'N° de série', 'Numéro de série', 'IMEI']::text[],
       array['الرقم التسلسلي']::text[], null, d.groupe, 'pratique', 'pratique',
       'defaut_a_valider', k.id, null, true
  from ref.grille_champs d
  join ref.grilles g on g.id = d.grille_id and g.code = 'facture'
  join ref.concepts k on k.pack_version_id = g.pack_version_id and k.code = 'numero_serie'
 where d.code = 'designation'
   and not exists (select 1 from ref.grille_champs x
                    where x.grille_id = d.grille_id and x.code = 'numero_serie_ligne');

do $$
declare n integer;
begin
  select count(*) into n
    from ref.grilles g
    join ref.grille_champs c on c.grille_id = g.id and c.code = 'numero_serie_ligne'
                            and c.repetee
    join ref.grille_champs d on d.grille_id = g.id and d.code = 'designation'
                            and d.parcelle = c.parcelle
   where g.code = 'facture';
  if n <> (select count(*) from ref.grilles where code = 'facture') then
    raise exception 'grille facture : % numéro(s) de série de ligne, 1 par grille attendu', n;
  end if;
end $$;

commit;
