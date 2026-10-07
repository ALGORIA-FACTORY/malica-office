-- La nature d'une charge se lit sur le libellé, pas seulement sur le compte.
--
-- ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
--
-- 7 octobre 2026. Le commanditaire photographie une facture de SUARL
-- CASA-ELECT — prises, boîtes d'appareillage, câble souple — et signale :
-- « charges non classées ».
--
-- Relevé : les trois articles sont bien projetés, et tous les trois portent la
-- famille `NON_CLASSE`.
--
-- La cause immédiate était ailleurs (le sens de la pièce, lu « vente », donnait
-- l'imputation 701 qui n'a aucune règle). Mais la corriger ne suffit pas : avec
-- le sens juste, l'imputation devient 601, et TOUT achat tombe alors dans
-- « Marchandises ». Du câble électrique acheté par une société de services n'est
-- pas une marchandise — une marchandise se revend.
--
-- ===================================================== CE QUI MANQUAIT, EXACTEMENT
--
-- `charge_famille_resolve` sait depuis toujours apparier sur DEUX critères :
--
--     match_kind = 'account_prefix'      le compte d'imputation
--     match_kind = 'designation_pattern' le libellé de l'article
--
-- Les dix règles du pack étaient TOUTES du premier type. Le libellé était passé
-- à la fonction, et aucune règle ne le regardait : le mécanisme existait, la
-- donnée manquait.
--
-- Or l'imputation vient de `ref.account_mappings`, qui donne UN compte par sens
-- de pièce — 601 pour tout achat. Classer sur le compte seul ne pouvait donc
-- produire qu'une seule famille pour toutes les charges du dossier.
--
-- ======================================================= R10, ET CE QUE CELA VEUT DIRE
--
-- Ces règles sont des DÉFAUTS LIVRÉS, pas des vérités. Deux cabinets tunisiens
-- peuvent loger le même câble à deux endroits, et les deux ont raison chez eux :
-- pour un électricien, le câble est une marchandise ; pour une société de
-- services, une fourniture.
--
-- Elles sont donc datées, versionnées, et surchargeables — et elles passent
-- AVANT les règles de compte (priorité 5 contre 10 à 30), parce que le libellé
-- en dit plus que l'imputation générique du sens de la pièce.
--
-- Ce que cette migration NE FAIT PAS : elle n'ajoute aucune famille. Il manque
-- au référentiel une famille pour l'ÉNERGIE et l'EAU — la STEG et la SONEDE
-- n'ont aujourd'hui aucune famille qui leur convienne, et en créer une touche
-- aussi le plan comptable. À décider à part.
--
-- ===================================================================== R11
--
-- `valid_from` est pris sur `effective_from` du pack : aucune date du jour
-- n'entre dans le référentiel.

insert into ref.charge_famille_rules
  (pack_version_id, famille_code, match_kind, pattern, priority, valid_from)
select p.id, v.famille, 'designation_pattern', v.motif, 5, p.effective_from
  from ref.jurisdiction_packs p
 cross join (values
   -- Loyer et charges locatives. « كراء » : le loyer en arabe.
   ('LOYER',
    '(loyer|bail|location +(du +|de +)?(local|bureau|atelier|dep[oô]t)|quote-?part +charges +communes|syndic|كراء)'),

   -- Télécoms. Les trois opérateurs tunisiens sont nommés : une facture
   -- Ooredoo ne dit pas toujours « télécom ».
   ('TELECOM',
    '(t[eé]l[eé]com|tunisie +t[eé]l[eé]com|ooredoo|orange|topnet|adsl|fibre|internet|abonnement +t[eé]l[eé]phon|forfait +mobile|اتصالات)'),

   -- Fournitures et petit matériel. C'est la famille de la facture CASA-ELECT :
   -- prises, boîtes d'appareillage, câble.
   ('FOURNITURES',
    '(fourniture|papeterie|ramette|cartouche|toner|stylo|classeur|c[aâ]ble|prise|interrupteur|disjoncteur|ampoule|lampe|bo[iî]te +app|visserie|quincaillerie|outillage|consommable|لوازم)'),

   -- Transport et carburant.
   ('TRANSPORT',
    '(carburant|gasoil|gazoil|essence|station +service|taxi|transport|p[eé]age|autoroute|livraison|fret|location +(de +)?v[eé]hicule|نقل)'),

   -- Honoraires et prestations intellectuelles.
   ('HONORAIRES',
    '(honoraire|prestation +intellectuelle|conseil|avocat|expert-?comptable|commissaire +aux +comptes|audit|formation|[eé]tude +technique|أتعاب)'),

   -- Frais bancaires.
   ('SERVICES_BANCAIRES',
    '(commission +bancaire|frais +bancaire|tenue +de +compte|agios|frais +de +virement|[eé]dition +de +ch[eé]quier)'),

   -- Droits et taxes. Le droit de timbre a déjà son référentiel propre
   -- (`ref.fiscal_charges`) ; cette règle attrape le cas où il apparaît comme
   -- une ligne d'article.
   ('IMPOTS_DROITS',
    '(droit +de +timbre|timbre +fiscal|taxe +(sur +les +|de +)?(immeubles|collectivit)|tcl|vignette)'),

   -- Marchandises destinées à la revente. Volontairement ÉTROITE : c'est la
   -- famille par défaut du compte 601, donc une règle large ici la rendrait
   -- inévitable et annulerait tout le reste.
   ('MARCHANDISES',
    '(marchandise|achat +pour +revente|stock +destin[eé] +[aà] +la +vente)')
 ) as v(famille, motif)
 where p.jurisdiction = 'TN'
on conflict do nothing;

comment on column ref.charge_famille_rules.priority is
  'Ordre d''examen, le plus petit d''abord. Les règles de LIBELLÉ sont à 5, '
  'avant celles de COMPTE (10 à 30) : l''imputation d''une pièce vient du sens '
  'du document et donne un seul compte pour tous les achats, alors que le '
  'libellé distingue la nature. Un défaut livré, surchargeable par le cabinet (R10).';
