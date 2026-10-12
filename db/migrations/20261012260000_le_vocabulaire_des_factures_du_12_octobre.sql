-- Le vocabulaire des factures du 12 octobre.
--
-- ================================================================= POURQUOI
--
-- Le référentiel a reçu hier le vocabulaire des six désignations qui
-- retombaient au repli. Le déploiement fait, le commanditaire a photographié
-- d'autres factures — et neuf nouvelles désignations tombent au repli :
--
--   Forfait Business 60 Go - ligne 50 xxx 103        → NON_CLASSE
--   Forfait Business 30 Go - ligne 50 xxx 104        → NON_CLASSE
--   Hors forfait international                       → NON_CLASSE
--   Options roaming Afrique de l'Ouest               → NON_CLASSE
--   Eau minérale 1,5 L — pack de 6                   → NON_CLASSE
--   Café en grains torréfié 1 kg                     → NON_CLASSE
--   Sucre en morceaux 1 kg                           → NON_CLASSE
--
-- La règle des télécoms connaît « forfait mobile » et « abonnement
-- téléphonique » ; un opérateur tunisien facture « Forfait Business 60 Go »,
-- « Hors forfait international », « Options roaming ». Aucune ne matche.
--
-- ============================================ CE QUE CETTE MIGRATION PROUVE
--
-- Deux tournées en deux jours, sur deux factures. C'est la démonstration de ce
-- qui était écrit hier : **avec des règles d'expression, il y aura toujours une
-- désignation non prévue.** Chaque élargissement répare le passé et laisse
-- l'avenir ouvert.
--
-- Elle est donc livrée pour que le commanditaire voie ses factures classées ce
-- soir, et la vraie réponse reste à construire : qu'une ligne non classée se
-- range à la main, et que ce choix serve la fois suivante (R10, couche par
-- organisation). Sans quoi cette migration aura une sœur la semaine prochaine.
--
-- ======================================== POURQUOI L'EAU ET LE CAFÉ EN FOURNITURES
--
-- Ce ne sont ni des marchandises — le dossier ne les revend pas — ni de
-- l'énergie. Dans un bureau, l'eau, le café et le sucre sont des consommables :
-- ils vont avec la ramette et les gobelets, dont la règle des fournitures
-- connaît déjà le vocabulaire. C'est un DÉFAUT au sens de R10, pas une vérité :
-- un cabinet qui préfère les loger en frais de réception le changera, et il
-- aura raison chez lui.
--
-- R11 : les dates sont celles du pack, littérales. Un mot de vocabulaire n'est
-- pas un fait daté — le dater reviendrait à prétendre que « roaming » n'existait
-- pas avant qu'on y pense, et les factures de septembre resteraient au repli.

-- --- 1. Les télécoms, tels qu'un opérateur facture ---------------------------------------

insert into ref.charge_famille_rules
  (pack_version_id, famille_code, match_kind, pattern, priority, valid_from)
select p.id, 'TELECOM', 'designation_pattern',
       '(forfait +(business|pro|entreprise|voix|data|mobile|internet)|hors +forfait|'
       || 'option(s)? +roaming|roaming|ligne +(fixe|mobile|t[eé]l[eé]phonique)|'
       || 'communication(s)? +(t[eé]l[eé]phonique|mobile|voix)|'
       || 'consommation +(voix|data|hors +forfait)|sms +en +nombre|'
       || 'bande +passante|liaison +(sp[eé]cialis[eé]e|louee|lou[eé]e)|vpn +op[eé]rateur)',
       5, p.effective_from
  from ref.jurisdiction_packs p
 where p.jurisdiction = 'TN'
   and not exists (
     select 1 from ref.charge_famille_rules r
      where r.pack_version_id = p.id
        and r.pattern like '%hors +forfait%'
   );

-- --- 2. Les consommables de bureau qui se boivent et se mangent ---------------------------

insert into ref.charge_famille_rules
  (pack_version_id, famille_code, match_kind, pattern, priority, valid_from)
select p.id, 'FOURNITURES', 'designation_pattern',
       '(eau +(min[eé]rale|de +source|en +bouteille)|bouteille +d.eau|bonbonne|fontaine +[aà] +eau|'
       || 'caf[eé]|th[eé] +en +(sachet|vrac)|infusion|sucre|lait +(en +poudre|uht|demi[- ]?[eé]cr[eé]m)|'
       || 'biscuit|gobelet|touillette|capsule(s)? +de +caf[eé]|dosette)',
       5, p.effective_from
  from ref.jurisdiction_packs p
 where p.jurisdiction = 'TN'
   and not exists (
     select 1 from ref.charge_famille_rules r
      where r.pack_version_id = p.id
        and r.pattern like '%eau +(min[eé]rale%'
   );
