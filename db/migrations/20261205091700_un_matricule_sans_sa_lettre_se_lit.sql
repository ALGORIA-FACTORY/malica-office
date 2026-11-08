-- Un matricule imprimé sans sa lettre de contrôle se LIT, et se compare par la lettre que
-- la règle du pack calcule. Il ne s'ENREGISTRE toujours pas sans elle.
--
-- ================================================================== POURQUOI
--
-- 5 novembre 2026, banc sans IA : les pièces du jeu du dirigeant (100/A à 100/E) impriment
-- « 1856324/A/M/000 » — sept chiffres, puis le code de TVA, la catégorie et l'établissement,
-- sans la lettre de contrôle. Le motif du matricule exigeait la lettre : 192 matricules
-- imprimés se taisaient. DÉCISION du dirigeant (5 novembre 2026) : « tu peux le calculer ».
--
-- ================================================================== CE QUI CHANGE
--
-- `ref.identifiant_formats` gagne `pattern_lu`, le motif de LECTURE d'une pièce, quand il
-- diffère du motif de SAISIE (`pattern`, qui valide une fiche : un dossier ou un tiers ne
-- s'enregistre pas sans sa lettre — `matricule-fiscal.test.ts`). Pour le matricule fiscal,
-- la lettre y est facultative ; les trois groupes restent exigés (sept chiffres seuls ne
-- sont pas un matricule). Le lecteur (`apps/api/src/malica/lecture/sudoku.ts`) passe au
-- moteur `coalesce(pattern_lu, pattern)`.
--
-- Le moteur (`packages/sudoku/src/entete.rs`) compare une écriture sans lettre par la lettre
-- que calcule `ref.identifiant_controles` (somme pondérée 7..1, modulo 23 —
-- `defaut_a_valider`, source `incertain` : la DGI ne la publie pas). La valeur RENDUE reste
-- celle qui est imprimée : aucune lettre n'est inventée. Une écriture sans lettre dont la
-- lettre calculée diffère de celle de la fiche, sur les mêmes chiffres, ne place rien : les
-- deux lectures se contredisent.
--
-- REJEU (R11) : aucune horloge n'écrit dans `ref`.

begin;

alter table ref.identifiant_formats add column if not exists pattern_lu text
  check (pattern_lu is null or length(btrim(pattern_lu)) > 0);

comment on column ref.identifiant_formats.pattern_lu is
  'Le motif de LECTURE d''une pièce, quand il diffère du motif de saisie (`pattern`) : un '
  'matricule imprimé sans sa lettre de contrôle se lit, et se compare par la lettre calculée '
  '(`ref.identifiant_controles`). Décision du dirigeant du 5 novembre 2026.';

update ref.identifiant_formats
   set pattern_lu = '[0-9]{7}[A-Za-z]?/[ABPDNabpdn]/[MCPNEmcpne]/[0-9]{3}'
 where kind = 'matricule_fiscal'
   and pattern = '[0-9]{7}[A-Za-z]/[ABPDNabpdn]/[MCPNEmcpne]/[0-9]{3}'
   and pattern_lu is null;

do $$
begin
  if exists (select 1 from ref.identifiant_formats f
              where f.kind = 'matricule_fiscal'
                and (f.pattern_lu is null
                     or not exists (select 1 from ref.identifiant_controles c
                                     where c.pack_version_id = f.pack_version_id
                                       and c.kind = f.kind))) then
    raise exception 'matricule fiscal : une lecture sans lettre exige la règle de la lettre';
  end if;
end $$;

commit;
