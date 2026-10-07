-- Vingt natures de charge, leur compte officiel, et soixante façons de les reconnaître.
--
-- ================================================= CE QUE CETTE MIGRATION CORRIGE
--
-- 7 octobre 2026, à la demande d'un référentiel complet. En le mesurant, trois
-- défauts sont apparus — dont deux sont des ERREURS, pas des manques.
--
-- 1. LA FAMILLE « MARCHANDISES » ÉTAIT ACCROCHÉE AU COMPTE 601.
--    Dans le Système Comptable des Entreprises, 601 est « Achats stockés —
--    Matières premières et fournitures liées ». Les marchandises sont au 607.
--    Et comme l'imputation vaut 601 pour TOUT achat, cette seule règle
--    rangeait l'intégralité des charges d'un dossier en « marchandises ».
--
-- 2. LA FAMILLE « HONORAIRES » ÉTAIT ACCROCHÉE AU COMPTE 665.
--    665 est « Autres impôts, taxes et versements assimilés ». Les honoraires
--    sont au 622, « Rémunération d'intermédiaires et honoraires ». Vestige
--    probable du 24 août, quand le droit de timbre était imputé au 665 avant
--    d'être corrigé au 6654.
--
-- 3. ONZE NATURES MANQUAIENT, dont l'ÉNERGIE et l'EAU — la STEG et la SONEDE
--    n'avaient aucune case, alors qu'elles sont dans toutes les comptabilités
--    tunisiennes.
--
-- ============================================ CE QUI RESTE HORS DE CETTE MIGRATION
--
-- L'IMPUTATION COMPTABLE NE CHANGE PAS. `ref.account_mappings` continue de
-- donner 601 pour tout achat, et c'est délibéré : le compte d'une écriture est
-- une VALEUR LIANTE. Le changer ferait basculer l'imputation de toutes les
-- pièces à venir, et cela demande la validation de l'expert-comptable, pas une
-- migration écrite de ma main.
--
-- `charge_familles.main_account` est donc ajouté et renseigné — il DOCUMENTE le
-- compte canonique de chaque nature, prêt pour le jour où la proposition
-- d'écriture s'en servira. Rien ne le lit aujourd'hui.
--
-- La distinction est le cœur de cette migration : la FAMILLE sert à l'analyse
-- (« Vos charges »), elle n'engage rien ; le COMPTE engage une écriture.
-- Enrichir la première est sans risque, toucher au second ne l'est pas.
--
-- ===================================================================== R10
--
-- Tout ce qui suit est un DÉFAUT LIVRÉ : daté, versionné, surchargeable. Deux
-- cabinets tunisiens peuvent loger le même câble à deux endroits et avoir
-- raison tous les deux — pour un électricien c'est une marchandise, pour une
-- société de services une fourniture. Ce qui est tenu ici, c'est qu'une PME
-- puisse commencer le jour de son inscription sans attendre personne.
--
-- Et NON_CLASSE reste le dernier recours, assumé : « je ne sais pas » est une
-- réponse honnête, alors qu'une famille plausible et fausse se propage dans
-- l'analyse sans que personne la corrige.
--
-- ===================================================================== R11
--
-- `valid_from` est pris sur `effective_from` du pack. Aucune date du jour
-- n'entre dans le référentiel.

-- --- 1. Le compte canonique d'une nature -----------------------------------------------------

alter table ref.charge_familles add column if not exists main_account text;

comment on column ref.charge_familles.main_account is
  'Compte du Système Comptable des Entreprises qui correspond à cette nature. '
  'DOCUMENTAIRE au 7 octobre 2026 : la proposition d''écriture ne le lit pas '
  'encore, parce que le compte d''une écriture est une valeur liante et que son '
  'changement demande la validation de l''expert-comptable.';

-- --- 2. Les onze natures qui manquaient ------------------------------------------------------
-- Chaque compte cité a été vérifié présent dans `ref.accounts` : aucun compte
-- n'est inventé ici.

insert into ref.charge_familles (pack_version_id, code, label, ordinal, is_fallback, valid_from)
select p.id, v.code, v.label, v.ordinal, false, p.effective_from
  from ref.jurisdiction_packs p
 cross join (values
   ('MATIERES_PREMIERES', 'Matières premières',              11),
   ('ENERGIE_EAU',        'Énergie et eau',                  21),
   ('PETIT_EQUIPEMENT',   'Petit équipement et matériel',    31),
   ('SOUS_TRAITANCE',     'Sous-traitance',                  41),
   ('CHARGES_LOCATIVES',  'Charges locatives et copropriété',51),
   ('ENTRETIEN',          'Entretien et réparations',        61),
   ('ASSURANCE',          'Assurances',                      71),
   ('ETUDES',             'Études et services extérieurs',   81),
   ('PERSONNEL_EXTERIEUR','Personnel extérieur',             91),
   ('PUBLICITE',          'Publicité et communication',     101),
   ('DEPLACEMENT',        'Déplacements et missions',       111),
   ('LOGICIELS',          'Logiciels et redevances',        121)
 ) as v(code, label, ordinal)
 where p.jurisdiction = 'TN'
on conflict do nothing;

-- --- 3. Le compte de chaque nature, ancienne comme nouvelle ----------------------------------

update ref.charge_familles f
   set main_account = v.compte
  from (values
   ('MARCHANDISES',       '607'),  -- Achats de marchandises
   ('MATIERES_PREMIERES', '601'),  -- Achats stockés - Matières premières
   ('FOURNITURES',        '606'),  -- Achats non stockés de matières et fournitures
   ('ENERGIE_EAU',        '606'),  -- l'eau et l'énergie sont des achats non stockés
   ('PETIT_EQUIPEMENT',   '605'),  -- Achats de matériel, équipements et travaux
   ('SOUS_TRAITANCE',     '611'),  -- Sous-traitance générale
   ('LOYER',              '613'),  -- Locations
   ('CHARGES_LOCATIVES',  '614'),  -- Charges locatives et de copropriété
   ('ENTRETIEN',          '615'),  -- Entretien et réparations
   ('ASSURANCE',          '616'),  -- Primes d'assurances
   ('ETUDES',             '617'),  -- Études, recherches et divers services extérieurs
   ('PERSONNEL_EXTERIEUR','621'),  -- Personnel extérieur à l'entreprise
   ('HONORAIRES',         '622'),  -- Rémunération d'intermédiaires et honoraires
   ('PUBLICITE',          '623'),  -- Publicité, publications, relations publiques
   ('TRANSPORT',          '624'),  -- Transports de biens
   ('DEPLACEMENT',        '625'),  -- Déplacements, missions et réceptions
   ('TELECOM',            '626'),  -- Frais postaux et frais de télécommunications
   ('SERVICES_BANCAIRES', '627'),  -- Services bancaires et assimilés
   ('LOGICIELS',          '631'),  -- Redevances pour concessions, marques, licences
   ('IMPOTS_DROITS',      '665')   -- Autres impôts, taxes et versements assimilés
  ) as v(code, compte)
 where f.code = v.code;

-- --- 4. Les deux règles de compte qui étaient fausses -----------------------------------------
-- On les clôt par une date d'effet plutôt que de les effacer : une règle qui a
-- servi à imputer des pièces reste dans le référentiel, close.

update ref.charge_famille_rules r
   set valid_to = (select p.effective_from from ref.jurisdiction_packs p where p.id = r.pack_version_id)
 where r.match_kind = 'account_prefix'
   and ((r.famille_code = 'MARCHANDISES' and r.pattern = '601')
     or (r.famille_code = 'HONORAIRES' and r.pattern = '665'));

-- --- 5. Les règles de compte, rendues au sens réel de chaque compte --------------------------

insert into ref.charge_famille_rules
  (pack_version_id, famille_code, match_kind, pattern, priority, valid_from)
select p.id, v.famille, 'account_prefix', v.compte, v.priorite, p.effective_from
  from ref.jurisdiction_packs p
 cross join (values
   ('MARCHANDISES',       '607', 20),
   -- AUCUNE RÈGLE SUR 601, et c'est délibéré.
   --
   -- 601 est bien « Matières premières » dans le plan comptable. Mais tant que
   -- `ref.account_mappings` impute TOUT achat au 601, une règle « 601 →
   -- matières premières » rangerait là chaque charge que le libellé ne
   -- reconnaît pas : une réponse plausible et fausse, qui se propagerait dans
   -- l'analyse sans que personne la corrige.
   --
   -- Faute de cette règle, l'inconnu tombe en NON_CLASSE — « je ne sais pas »,
   -- ce qui est vrai et se corrige d'un geste. La règle sera ajoutée le jour où
   -- l'imputation suivra la nature, et pas avant.
   ('FOURNITURES',        '606', 20),
   ('PETIT_EQUIPEMENT',   '605', 20),
   ('SOUS_TRAITANCE',     '611', 20),
   ('CHARGES_LOCATIVES',  '614', 20),
   ('ENTRETIEN',          '615', 20),
   ('ASSURANCE',          '616', 20),
   ('ETUDES',             '617', 20),
   ('PERSONNEL_EXTERIEUR','621', 20),
   ('HONORAIRES',         '622', 20),
   ('PUBLICITE',          '623', 20),
   ('DEPLACEMENT',        '625', 20),
   ('LOGICIELS',          '631', 20)
 ) as v(famille, compte, priorite)
 where p.jurisdiction = 'TN'
on conflict do nothing;

-- --- 4 bis. LE CLASSEMENT DEVIENT DÉTERMINISTE ----------------------------------------------
--
-- Trouvé en jouant les mêmes libellés sur deux bases : la ligne
--
--     « Quote-part charges communes (syndic, ascenseur, gardiennage) »
--
-- tombait en CHARGES_LOCATIVES sur l'une et en PERSONNEL_EXTERIEUR sur l'autre
-- — « gardiennage » appartient aussi aux services de sécurité. Les deux règles
-- étaient à la même priorité, et `order by priority, match_kind` ne les
-- départageait pas : PostgreSQL rendait l'ordre physique des lignes.
--
-- Donc la MÊME facture pouvait recevoir deux natures différentes selon la base
-- qui la lit. C'est exactement ce que R11 interdit pour un référentiel, et
-- c'était ici dans la FONCTION et non dans les données.
--
-- Deux départages ajoutés après la priorité : la longueur du motif d'abord —
-- un motif plus long est plus spécifique, « quote-part charges communes » en
-- dit plus que « gardiennage » — puis le code de la famille, pour que l'ordre
-- soit total et que deux bases donnent toujours le même résultat.

create or replace function public.charge_famille_resolve(
  p_pack uuid, p_account text, p_designation text, p_at date default current_date)
returns table(famille_code text, famille_source text)
language sql
stable
set search_path to ''
as $function$
  with rules as (
    select r.famille_code, r.match_kind, r.pattern, r.priority
      from ref.charge_famille_rules r
     where r.pack_version_id = p_pack
       and r.valid_from <= p_at
       and (r.valid_to is null or r.valid_to >= p_at)
  ),
  hit as (
    select famille_code, match_kind as famille_source, priority, pattern
      from rules
     where (match_kind = 'account_prefix'
            and p_account is not null
            and p_account like pattern || '%')
        or (match_kind = 'designation_pattern'
            and p_designation is not null
            and p_designation ~* pattern)
     -- L'ordre est TOTAL : priorité, puis spécificité du motif, puis le nom de
     -- la famille. Sans le dernier critère, deux bases peuvent différer.
     order by priority, match_kind, length(pattern) desc, famille_code
     limit 1
  )
  select famille_code, famille_source from hit
  union all
  select f.code, 'fallback'
    from ref.charge_familles f
   where f.pack_version_id = p_pack and f.is_fallback
     and f.valid_from <= p_at and (f.valid_to is null or f.valid_to >= p_at)
     and not exists (select 1 from hit)
   limit 1
$function$;

-- --- 5 bis. La règle « loyer » de ce matin attrapait le syndic -------------------------------
--
-- `20261007120000` a livré, faute d'une famille pour les charges locatives :
--
--     LOYER ← (loyer|bail|location…|quote-part charges communes|syndic|كراء)
--
-- Maintenant que `CHARGES_LOCATIVES` existe, ces deux termes doivent y aller :
-- 613 « Locations » et 614 « Charges locatives et de copropriété » sont deux
-- comptes distincts, et les confondre empêche de comparer un loyer d'un mois
-- sur l'autre — le syndic le brouille.
--
-- La règle est CLOSE, pas effacée : elle a servi à ranger des pièces, et on doit
-- pouvoir expliquer un classement ancien. Celle qui la remplace, plus bas, ne
-- contient plus ces termes.

update ref.charge_famille_rules r
   set valid_to = (select p.effective_from from ref.jurisdiction_packs p where p.id = r.pack_version_id)
 where r.match_kind = 'designation_pattern'
   and r.famille_code = 'LOYER'
   and r.pattern like '%syndic%';

-- --- 6. Reconnaître une nature à son libellé --------------------------------------------------
-- Priorité 5 : AVANT toute règle de compte. L'imputation vient du sens de la
-- pièce et donne un seul compte pour tous les achats ; le libellé, lui,
-- distingue la nature. C'est donc lui qui doit parler le premier.
--
-- Les fournisseurs tunisiens sont NOMMÉS quand leur facture ne dit pas sa
-- nature : une facture STEG ne porte pas le mot « électricité », une facture
-- Ooredoo ne porte pas « télécom ».

-- Et une priorité DANS les règles de libellé, parce que deux natures peuvent
-- être nommées par la même ligne.
--
-- « Entretien climatiseur » : un climatiseur est du petit équipement, un
-- entretien est un service. Les deux motifs matchent, et la ligne décrit un
-- SERVICE — c'est l'action qui dit la nature, pas l'objet sur lequel elle porte.
-- Mesuré : sans cette priorité, la ligne tombait en « petit équipement ».
--
-- Le VERBE passe donc avant l'OBJET : priorité 4 pour les natures d'action,
-- 5 pour celles qui nomment une chose.

insert into ref.charge_famille_rules
  (pack_version_id, famille_code, match_kind, pattern, priority, valid_from)
select p.id, v.famille, 'designation_pattern', v.motif,
       case
         -- Une expression composée est plus sûre qu'un mot : « quote-part
         -- charges communes » ne peut rien être d'autre, alors que
         -- « gardiennage » apparaît aussi dedans.
         when v.famille = 'CHARGES_LOCATIVES' then 3
         when v.famille in ('ENTRETIEN', 'SOUS_TRAITANCE', 'ETUDES') then 4
         else 5
       end,
       p.effective_from
  from ref.jurisdiction_packs p
 cross join (values
   -- Énergie et eau. La STEG et la SONEDE sont les deux monopoles tunisiens.
   ('ENERGIE_EAU',
    '(steg|sonede|[eé]lectricit[eé]|consommation +d.eau|redevance +eau|gaz +(naturel|de +ville)|bouteille +de +gaz|facture +d.eau)'),

   -- Carburant : c'est du transport dans le plan comptable tunisien (624),
   -- distinct de l'énergie d'un local.
   ('TRANSPORT',
    '(carburant|gasoil|gazoil|essence|station +(service|shell|total|agil|ola)|p[eé]age|autoroute|fret|transit|d[eé]douanement|livraison|transport)'),

   -- Déplacements et missions, qui ne sont pas du transport de biens.
   ('DEPLACEMENT',
    '(h[oô]tel|nuit[eé]e|billet +(d.avion|de +train)|tunisair|nouvelair|taxi|louage|mission|per +diem|restaurant|r[eé]ception|frais +de +d[eé]placement)'),

   -- Petit équipement : du matériel, pas une immobilisation.
   ('PETIT_EQUIPEMENT',
    '(ordinateur|[eé]cran|imprimante|scanner|clavier|souris|onduleur|disque +dur|t[eé]l[eé]phone +portable|chaise|bureau +\\(meuble\\)|armoire|climatiseur|perceuse|[eé]chelle)'),

   -- Logiciels, licences, abonnements en ligne.
   -- Le mot « logiciel » SEUL est volontairement absent : « prestation de
   -- développement logiciel » est un service, pas une licence, et le motif le
   -- rangeait en redevances. Mesuré sur vingt-quatre libellés réels.
   ('LOGICIELS',
    '(licence|abonnement +(microsoft|google|adobe|zoom|canva|office|365)|saas|h[eé]bergement|nom +de +domaine|certificat +ssl|antivirus|redevance +(de +)?logiciel|progiciel)'),

   -- Entretien et réparations.
   ('ENTRETIEN',
    '(entretien|r[eé]paration|maintenance|d[eé]pannage|r[eé]vision|vidange|pi[eè]ce +de +rechange|nettoyage|femme +de +m[eé]nage|jardinage|d[eé]sinsectisation)'),

   -- Assurances.
   ('ASSURANCE',
    '(assurance|prime +d.assurance|star +assurance|comar|gat +assurance|maghrebia|lloyd +tunisien|responsabilit[eé] +civile|multirisque)'),

   -- Publicité et communication.
   ('PUBLICITE',
    '(publicit[eé]|annonce|insertion +presse|impression +de +(flyers|brochures|cartes)|enseigne|banderole|r[eé]seaux +sociaux|sponsoring|salon +professionnel|catalogue)'),

   -- Sous-traitance.
   ('SOUS_TRAITANCE',
    '(sous-?traitance|fa[cç]on|travail +[aà] +fa[cç]on|prestation +de +production)'),

   -- Personnel extérieur : intérim, mise à disposition.
   ('PERSONNEL_EXTERIEUR',
    '(int[eé]rim|personnel +(ext[eé]rieur|mis +[aà] +disposition)|mise +[aà] +disposition +de +personnel|gardiennage|s[eé]curit[eé] +(des +locaux|priv[eé]e))'),

   -- Études et services extérieurs.
   ('ETUDES',
    '(bureau +d.[eé]tudes|[eé]tude +(technique|de +march[eé])|certification|iso +[0-9]+|analyse +de +laboratoire|contr[oô]le +technique|expertise +technique)'),

   -- Charges locatives et copropriété, distinctes du loyer lui-même.
   ('CHARGES_LOCATIVES',
    '(charges +(locatives|communes|de +copropri[eé]t[eé])|syndic|ascenseur|quote-?part +charges)'),

   -- Matières premières, pour une activité de production.
   ('MATIERES_PREMIERES',
    '(mati[eè]re +premi[eè]re|intrant|r[eé]sine|acier|ciment|bois +brut|tissu +en +rouleau)'),

   -- Honoraires et prestations intellectuelles, élargies.
   ('HONORAIRES',
    '(honoraire|avocat|notaire|huissier|expert-?comptable|commissaire +aux +comptes|audit|conseil +(juridique|fiscal|en +gestion)|formation|coaching|architecte|g[eé]om[eè]tre|m[eé]decin +du +travail|أتعاب)'),

   -- Télécoms, avec les trois opérateurs et les fournisseurs d'accès.
   ('TELECOM',
    '(t[eé]l[eé]com|tunisie +t[eé]l[eé]com|ooredoo|orange +tunisie|topnet|globalnet|hexabyte|adsl|fibre|vdsl|internet|abonnement +t[eé]l[eé]phon|forfait +mobile|recharge +t[eé]l[eé]phonique|timbre +postal|affranchissement|rapide +poste|dhl|fedex|اتصالات)'),

   -- Fournitures de bureau et consommables, élargies.
   ('FOURNITURES',
    '(fourniture|papeterie|ramette|papier +a4|cartouche|toner|encre|stylo|classeur|agrafeuse|enveloppe|c[aâ]ble|prise|interrupteur|disjoncteur|ampoule|lampe|bo[iî]te +app|visserie|quincaillerie|outillage|consommable|produit +d.entretien|لوازم)'),

   -- Services bancaires, élargis.
   ('SERVICES_BANCAIRES',
    '(commission +bancaire|frais +bancaire|tenue +de +compte|agios|frais +de +virement|[eé]dition +de +ch[eé]quier|location +de +coffre|frais +sur +effet|escompte)'),

   -- Droits et taxes apparaissant en ligne de facture.
   ('IMPOTS_DROITS',
    '(droit +de +timbre|timbre +fiscal|tcl|taxe +(sur +les +immeubles|de +collectivit)|vignette|droit +d.enregistrement|taxe +professionnelle)'),

   -- Loyer, inchangé mais répété ici pour que la liste se lise d'un bloc.
   ('LOYER',
    '(loyer|bail|location +(du +|de +)?(local|bureau|atelier|d[eé]p[oô]t|hangar|magasin)|location +(de +)?(mat[eé]riel|v[eé]hicule|engin)|leasing|كراء)')
 ) as v(famille, motif)
 where p.jurisdiction = 'TN'
on conflict do nothing;
