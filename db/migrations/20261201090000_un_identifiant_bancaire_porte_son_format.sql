-- Un identifiant bancaire porte son format : le RIB et l'IBAN se lisent par le pack.
--
-- ==================================================================== POURQUOI
--
-- Banc sans IA du 4 novembre 2026 (412 pièces fictives, sans modèle) : 55 RIB
-- sortaient « 99 » — le premier groupe de « 99 340 9403398267119 10 ». L'expert
-- d'identifiant lisait la valeur derrière son repère, jeton par jeton, et l'espace
-- entre deux groupes l'arrêtait. Corriger le RIB dans le moteur aurait été une
-- rustine ; la cause est qu'aucun format ne disait ce qu'est un RIB.
--
-- Le lecteur d'identifiants de l'adaptateur (`identifiantsDuPlan`) lit désormais
-- TOUT format du pack sur la forme compacte d'une suite de jetons de la rangée
-- (sans espaces ni séparateurs). Il suffit donc que le pack déclare le format, et
-- que les champs du concept le nomment.
--
-- ===================================================================== CE QUI EST POSÉ
--
--   - `rib`  : vingt chiffres (banque 2, agence 3, compte 13, clé 2). Texte : la
--              structure du RIB tunisien est celle de la Banque centrale (INCERTAIN :
--              référence exacte à vérifier) ; la clé n'est PAS contrôlée ici — son
--              algorithme n'est pas posé au pack, et une clé non vérifiée ne doit
--              rien refuser.
--   - `iban` : « TN » puis vingt-deux chiffres (deux chiffres de contrôle, le RIB).
--              Norme ISO 13616 ; longueur tunisienne de 24 caractères (INCERTAIN :
--              registre SWIFT de l'IBAN à relire).
--
-- Tous les champs dont le CONCEPT est `rib` ou `iban` nomment ce format, dans toutes
-- les grilles : la règle porte sur le concept, jamais sur un champ.

insert into ref.identifiant_formats
  (pack_version_id, jurisdiction, kind, label, pattern, exemple, legal_reference, valid_from)
select p.id, p.jurisdiction, f.kind, f.label, f.pattern, f.exemple, f.legal_reference, p.effective_from
  from ref.jurisdiction_packs p
 cross join (values
   ('rib', 'Relevé d''identité bancaire', '[0-9]{20}', '99340940339826711910',
    'Structure du RIB tunisien (banque, agence, compte, clé) — référence BCT INCERTAINE'),
   ('iban', 'IBAN', 'TN[0-9]{22}', 'TN5999340940339826711910',
    'ISO 13616 — longueur tunisienne INCERTAINE')
 ) as f(kind, label, pattern, exemple, legal_reference)
 where p.jurisdiction = 'TN'
on conflict (pack_version_id, kind, valid_from) do nothing;

update ref.grille_champs gc
   set format_code = k.code
  from ref.concepts k
 where k.id = gc.concept_id
   and k.code in ('rib', 'iban')
   and gc.type = 'identifiant'
   and gc.format_code is distinct from k.code;
