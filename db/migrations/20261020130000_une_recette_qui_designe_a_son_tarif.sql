-- Une recette qui désigne a son tarif, donc elle se journalise.
--
-- ================================================================== POURQUOI
--
-- Le défaut a été nommé TROIS fois dans ce dépôt, et il a coûté à chaque
-- fois :
--
--   5 octobre   le rôle écrit en dur « reasoner » pendant que l'appel passait
--               par « chat » : aucun tarif pour ce couple, l'écriture du
--               journal refusée, EN SILENCE, et plus aucune désignation
--               mesurée pendant dix jours ;
--   15 octobre  la source du relevé portait un suffixe « +pdf-scan », et
--               `agents.model_pricing` cherche par le NOM DU MODÈLE : ce nom
--               composite n'en désigne aucun, même silence ;
--   18 octobre  l'étude de l'OCR le nomme une troisième fois.
--
-- `public.agents_run_log` cherche un tarif par le COUPLE (modèle, rôle) et
-- LÈVE quand il n'en trouve pas. `read-flow.ts` attrape cette levée, crie, et
-- ne fait pas échouer la lecture — c'est juste, et c'est exactement ce qui
-- rend l'absence invisible. Une recette qui désignerait sans cette ligne
-- tournerait donc sans laisser de trace, et le RECOURS AU MODÈLE — ce que le
-- plan de la fabrique demande de mesurer avant tout le reste — resterait
-- impossible à compter.
--
-- ====================================================== POURQUOI CE NOM, EXACTEMENT
--
-- `recette/1` est la VERSION DU LANGAGE des recettes
-- (`apps/api/src/fabrique/recette.ts`), et `modeles.ts` la dérive au lieu de
-- la recopier. Le jour où `recette/2` interprétera autrement, les deux se
-- distingueront au journal — et ce test-là deviendra rouge tant que la ligne
-- de tarif correspondante n'existera pas, ce qui est précisément le service
-- rendu. C'est le même raisonnement que le millésime figé de l'œil : un
-- « dernier en date » changerait la lecture sans qu'une ligne bouge.
--
-- ====================================================== POURQUOI UN RÔLE DE PLUS
--
-- Une recette ne raisonne pas (`reasoner`), ne converse pas (`chat`) et ne
-- voit pas la pièce (`vision`) : elle interprète un plan de jetons. Lui
-- attribuer l'un des trois ferait un couple qui MENT sur ce qui a désigné, et
-- le journal servirait alors à confondre les deux chemins au lieu de les
-- séparer. Le `check` de la colonne est donc élargi, nommément — et il reprend
-- « embedding », ajouté le 1er septembre 2026 par les empreintes vectorielles :
-- une liste close se réécrit ENTIÈRE, et en oublier un terme supprime en
-- silence ce que quelqu'un d'autre avait ouvert.
--
-- ======================================================= POURQUOI UN PRIX NUL
--
-- Zéro au jeton, souverain, comme `pdf-text` et PaddleOCR : une interprétation
-- déterministe ne consomme aucun jeton de modèle et ne sort d'aucune machine.
-- Ce que la ligne rend mesurable est le NOMBRE d'appels — et c'est le chiffre
-- qui dira si la fabrique tient sa promesse.
--
-- R11 : `effective_from` en littéral, jamais `current_date`, et `currency`
-- écrite plutôt que laissée au défaut. La date est celle du plan de la
-- fabrique (18 octobre 2026), comme les autres livraisons de ce lot : une
-- date POSTÉRIEURE au jour où la migration se joue rendrait le tarif absent
-- — et l'organe se journaliserait en silence, ce que cette migration existe
-- justement pour empêcher.

begin;

alter table agents.model_pricing
  drop constraint if exists model_pricing_role_check;

alter table agents.model_pricing
  add constraint model_pricing_role_check
  check (role in ('reasoner', 'chat', 'vision', 'cache', 'embedding', 'recette'));

comment on column agents.model_pricing.role is
  'Le rôle sous lequel l''organe a été appelé. Le tarif se cherche par le '
  'COUPLE (modèle, rôle) : un rôle écrit en dur à côté d''un modèle dérivé '
  'd''ailleurs a déjà fait disparaître dix jours de mesures. « recette » est '
  'l''interprète déterministe de la fabrique de lecteurs — il ne raisonne '
  'pas, ne converse pas et ne voit pas la pièce.';

insert into agents.model_pricing
  (provider, model, role, price_in_per_mtok, price_out_per_mtok, currency, sovereign,
   effective_from)
values
  ('interne', 'recette/1', 'recette', 0, 0, 'EUR', true, date '2026-10-18')
on conflict do nothing;

commit;
