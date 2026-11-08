-- La part exonérée d'une exonération partielle est une instance de la ventilation par taux.
--
-- ================================================================== POURQUOI
--
-- Banc sans IA du 4 novembre 2026, algoria-102 (fictive) : deux formations agréées
-- exonérées et sept lignes à 19 %. La pièce imprime « 0 % 4 032,000 0,000 » et
-- « 19 % 33 545,000 6 373,550 » ; l'exonération partielle était prouvée par les lignes,
-- mais la ventilation rendue ne portait que le 19 % : une ventilation incomplète, AFFIRMÉE
-- (deux faux : base et montant de TVA par taux).
--
-- ================================================================== CE QUI CHANGE
--
-- `groupe_taux` gagne une clé facultative, `taux_exonere` : le code du taux nul du barème
-- (`ref.tva_rates`, taux 0) qui nomme la part exonérée. Elle n'a de sens qu'avec
-- `exoneration_partielle`, et le moteur refuse un code absent des taux nuls du pack. La
-- part exonérée est alors une instance : base = total HT − Σ bases imprimées, montant nul ;
-- les lignes la confirment toujours (sinon la preuve est retirée). Sans `taux_exonere`, la
-- ventilation d'une exonération partielle n'est plus affirmée (signalée).
--
-- EXO (« Exonéré de TVA », Code TVA, tableau A) et non EXPORT : la clé suit la MENTION
-- d'exonération que la grille lit (`exoneration`). Une opération en suspension ou à
-- l'export sous cette même mention serait nommée EXO : INCERTAIN fiscalement, à valider
-- (R10 : défaut livré, `defaut_a_valider`, comme la preuve qu'il complète).
-- REJEU (R11) : aucune horloge n'écrit dans `ref`.

begin;

update ref.grille_preuves p
   set expression = p.expression || '{"taux_exonere": "EXO"}'::jsonb
  from ref.grilles g
 where g.id = p.grille_id and g.code = 'facture' and p.code = 'P03'
   and (p.expression -> 'exoneration_partielle') = 'true'::jsonb;

do $$
declare n integer;
begin
  select count(*) into n from ref.grille_preuves p join ref.grilles g on g.id = p.grille_id
   where g.code = 'facture' and p.code = 'P03' and p.expression ->> 'taux_exonere' = 'EXO';
  if n <> (select count(*) from ref.grilles where code = 'facture') then
    raise exception 'grille facture : % preuve(s) P03 nommant la part exonérée, 1 par grille attendue', n;
  end if;
  if not exists (select 1 from ref_tva_rates_v where code = 'EXO' and rate = 0) then
    raise exception 'taux EXO (nul) absent du barème';
  end if;
end $$;

commit;
