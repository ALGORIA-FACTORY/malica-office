-- Le relevé bancaire ne se prouve qu'une fois : la preuve vit dans P01a.
--
-- ================================================================== POURQUOI
--
-- #346 (11 novembre 2026) a traduit `releve_bancaire P01` en « solde final =
-- solde initial + total des crédits − total des débits ». Cette équation existait
-- déjà sous `releve_bancaire P01a` (`20261208090000`), traduction de la seule
-- partie de P01 que le moteur sait exécuter (soldes créditeurs). Le relevé portait
-- donc deux preuves identiques : un doublon dans le référentiel, relevé par la
-- session de lecture du même jour et fusionné par erreur.
--
-- P01 reprend son état d'avant #346 : la règle complète en clair (soldes signés),
-- `a_traduire`, sans expression. P01a reste la seule preuve exécutable. La preuve
-- de l'avis d'échéance d'assurance posée par #346 n'est pas un doublon : elle reste.
--
-- R7 : aucune pièce ne change d'issue (P01 et P01a disaient la même chose).
-- R11 : aucune horloge n'écrit dans `ref`.

begin;

update ref.grille_preuves p
   set expression = null,
       statut = 'a_traduire'
  from ref.grilles g
 where g.id = p.grille_id and g.code = 'releve_bancaire' and p.code = 'P01'
   and p.expression = '{"op": "somme", "total": "solde_final", "parties": ["solde_initial", "total_credits", "-total_debits"]}'::jsonb;

do $$
declare n integer;
begin
  select count(*) into n
    from ref.grille_preuves p join ref.grilles g on g.id = p.grille_id
   where g.code = 'releve_bancaire' and p.code = 'P01' and p.expression is not null;
  if n <> 0 then
    raise exception 'releve_bancaire P01 garde une expression : % ligne(s)', n;
  end if;
  select count(*) into n
    from ref.grille_preuves p join ref.grilles g on g.id = p.grille_id
   where g.code = 'releve_bancaire' and p.code = 'P01a' and p.expression ->> 'op' = 'somme';
  if n = 0 then
    raise exception 'releve_bancaire P01a a disparu : la preuve du relevé ne vit plus nulle part';
  end if;
end $$;

commit;
