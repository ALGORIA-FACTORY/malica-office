-- La lecture d'une pièce se suit, étape par étape, jusqu'à la valeur persistée.
--
-- ================================================================== POURQUOI
--
-- La facture MyTek (novembre 2026) : un TTC de 510,000 relevé 810,000, et
-- personne ne pouvait dire si la faute était à l'OCR, au filtre du plan, au
-- sudoku, au rattrapage ou à la persistance. Le socle du journal
-- (20261118130000) a déclaré ces étapes sans aucune clé : leur `detail`
-- restait vide. Cette migration dit, pour chacune, ce qu'elle peut porter.
--
-- ================================================================== CE QUI EST POSÉ
--
-- 1. Les clés de `upload`, `ocr`, `extraction`, `sudoku`, `rattrapage` et
--    `persistance` ; une étape nouvelle, `jugement` (le verdict du Socle).
--    Aucune ne porte la photo, le texte OCR ni un jeton : des valeurs citées
--    (un montant relu dans le plan), des codes, des compteurs, et les
--    identifiants des lignes déjà stockées (`capture.extractions`,
--    `capture.analyses`) — référencées, jamais recopiées.
-- 2. `observabilite.trace_d_origine(piece)` : la première opération qui a
--    nommé la pièce (sa capture, son dépôt). Une relecture de nuit s'y
--    rattache comme trace enfant. L'API l'exécute sur la connexion du journal ;
--    elle ne lit rien d'autre du schéma, et aucun client ne l'exécute.
--
-- REJEU (R11) : aucune horloge, aucun tirage.

begin;

update observabilite.etapes set cles_autorisees = array[
  'octets', 'statut', 'type_contenu', 'doublon_de']
 where code = 'upload';

update observabilite.etapes set cles_autorisees = array[
  'passe', 'lecteur', 'modele', 'modele_designation', 'jetons', 'latence_ms', 'paddle_tente',
  'motif', 'erreur']
 where code = 'ocr';

update observabilite.etapes set cles_autorisees = array[
  'passe', 'contrat', 'qualite', 'devise', 'base_ht', 'tva', 'ttc', 'droits', 'codes_droits',
  'ttc_par_lettres', 'citations', 'drapeaux', 'incoherences', 'incoherence']
 where code = 'extraction';

update observabilite.etapes set cles_autorisees = array[
  'passe', 'mode', 'issue', 'designee', 'regle', 'raison', 'solutions', 'base_ht', 'tva', 'ttc',
  'droits', 'lettres', 'preuve_lettres', 'ecart_ttc', 'erreur']
 where code = 'sudoku';

update observabilite.etapes set cles_autorisees = array[
  'declenche', 'raison', 'differe', 'qualite_avant', 'qualite_apres', 'retenue', 'lecteur',
  'erreur']
 where code = 'rattrapage';

update observabilite.etapes set cles_autorisees = array[
  'passe', 'extraction_id', 'contrat', 'devise', 'base_ht', 'tva', 'ttc', 'droits', 'erreur',
  'code_refus']
 where code = 'persistance';

insert into observabilite.etapes (code, cles_autorisees, description) values
  ('jugement',
   array['chemin', 'analyse_id', 'extraction_id', 'verdict', 'etat', 'devise', 'base_ht', 'tva',
         'ttc', 'change', 'essai'],
   'Le verdict du Socle sur la pièce lue (capture.analyses), à la lecture ou au rejeu.');

do $$
declare
  manquantes text[];
begin
  select array_agg(code order by code) into manquantes
    from observabilite.etapes
   where code in ('upload', 'ocr', 'extraction', 'sudoku', 'rattrapage', 'persistance', 'jugement')
     and cardinality(cles_autorisees) = 0;
  if manquantes is not null then
    raise exception 'étapes de lecture sans clé : %', manquantes;
  end if;
end
$$;

/*
 * La trace d'origine d'une pièce : la première opération, hors travaux
 * différés, qui l'a nommée. Rend un identifiant, rien de ce que la trace porte.
 */
create function observabilite.trace_d_origine(p_piece uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select t.id
    from observabilite.traces t
   where t.piece_id = p_piece and t.origine <> 'tache'
   order by t.debut, t.id
   limit 1
$$;

alter function observabilite.trace_d_origine(uuid) owner to greffier;
revoke all on function observabilite.trace_d_origine(uuid) from public, anon, authenticated;
grant execute on function observabilite.trace_d_origine(uuid) to malica_api, malica_exploitation;

comment on function observabilite.trace_d_origine(uuid) is
  'La première opération (hors travaux différés) qui a nommé la pièce : la trace parente d''une '
  'relecture de nuit. Voir docs/journalisation.md.';

commit;
