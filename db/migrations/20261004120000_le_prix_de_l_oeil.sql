-- Le prix de l'œil — D31 close.
--
-- `20260826163000` laissait cette ligne en suspens, et disait pourquoi : le
-- workspace Bailian n'était pas activé, aucun tarif public n'était fiable, et
-- « inscrire un prix supposé reviendrait à produire un chiffre sans origine ».
-- Le prix a maintenant une origine : relevé le 4 octobre 2026 dans la console
-- Model Studio (région Singapour) par l'exploitant.
--
--   qwen-vl-ocr-2025-11-20   0,07 USD / Mtok en entrée
--                            0,16 USD / Mtok en sortie
--
-- CE QUE CELA DÉBLOQUE. `public.agents_run_log` lève quand il ne trouve aucun
-- tarif en vigueur, et la passe de relevé n'était donc PAS journalisée : elle
-- s'exécutait sans laisser ni coût ni latence. Le plafond de `agents.budgets`
-- ne pouvait pas border l'appel le plus cher du produit. Mesuré encore le
-- 4 octobre, chaîne réelle de bout en bout :
--
--   « qwen-vl-ocr-2025-11-20 : non journalisé (aucun tarif en vigueur
--     pour le modele qwen-vl-ocr-2025-11-20 (role vision)) »
--
-- LE MILLÉSIME, PAS « -latest ». `20260826163000` proposait en modèle
-- `qwen-vl-ocr-latest`. On inscrit le millésime figé, celui que le code appelle
-- (`apps/api/src/malica/modeles.ts`), parce que `agents_run_log` cherche le
-- tarif PAR NOM DE MODÈLE : un tarif au nom mouvant ne rejoindrait jamais
-- l'appel. Et un modèle qui suit « -latest » changerait le relevé sans qu'une
-- ligne de code bouge, donc une pièce relue ne donnerait plus ce qu'elle
-- donnait à sa comptabilisation.
--
-- LA DATE EST ÉCRITE, PAS CALCULÉE. R11 : `current_date` dans une migration de
-- référentiel donne une base différente selon le jour où on la joue. Les lignes
-- posées par `20260826163000` en portent déjà la trace (leurs dates d'effet
-- diffèrent entre le poste et le serveur) ; on n'en ajoute pas une.
--
-- `sovereign` est faux : la pièce quitte l'infrastructure pour Singapour.
-- `pdf-text` reste en vigueur et n'est pas clos : les deux cohabitent, le
-- relevé choisissant la couche de texte quand le PDF en porte une, et l'œil
-- sinon. Le tarif se cherchant par (modèle, rôle), cette cohabitation n'a rien
-- d'ambigu.

insert into agents.model_pricing
  (provider, model, role, price_in_per_mtok, price_out_per_mtok,
   currency, sovereign, effective_from)
values
  ('alibaba', 'qwen-vl-ocr-2025-11-20', 'vision', 0.07, 0.16,
   'USD', false, date '2026-10-04')
on conflict (provider, model, role, effective_from) do nothing;
