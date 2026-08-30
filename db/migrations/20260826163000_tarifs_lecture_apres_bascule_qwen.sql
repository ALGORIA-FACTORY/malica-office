-- Le tarif suit le code.
--
-- La lecture ne passe plus par la passerelle Lovable : un PDF natif est lu par
-- sa propre couche de texte, une image par Qwen-VL-OCR, et la désignation est
-- faite par DeepSeek (déjà tarifé en 'reasoner'). La ligne 'lovable' décrivait
-- un chemin qui n'existe plus dans le code.

-- On ne l'efface pas. `agents.model_pricing` est versionnée par date d'effet et
-- `agents.agent_runs` conserve des exécutions passées : supprimer la ligne
-- rendrait ces coûts déjà journalisés inexplicables. On la clôt à ce jour, ce
-- qui la retire des lectures futures sans réécrire l'histoire.
update agents.model_pricing
   set effective_to = current_date
 where provider = 'lovable'
   and model = 'google/gemini-2.5-flash'
   and role = 'vision'
   and effective_to is null;

-- Un PDF natif porte son texte et sa géométrie : le relevé est déterministe,
-- sans appel réseau ni modèle. Son prix n'est pas approximativement nul, il est
-- nul. La ligne existe parce que `public.agents_run_log` lève une exception
-- quand il ne trouve aucun tarif en vigueur : sans elle, la lecture la moins
-- chère du système serait la seule qu'on ne pourrait pas journaliser.
--
-- `sovereign` est vrai : rien ne sort de l'infrastructure.
insert into agents.model_pricing
  (provider, model, role, price_in_per_mtok, price_out_per_mtok, sovereign, effective_from)
values
  ('interne', 'pdf-text', 'vision', 0, 0, true, current_date)
on conflict do nothing;

-- Qwen-VL-OCR n'est volontairement pas tarifé ici.
--
-- Aucun modèle n'est encore activé sur le workspace Bailian (l'API répond
-- « AccessDenied.Unpurchased » sur les 13 modèles testés, y compris textuels),
-- et le tarif public de qwen-vl-ocr n'est documenté nulle part de façon fiable.
-- Inscrire un prix supposé dans cette table reviendrait exactement à ce que la
-- doctrine interdit ailleurs : produire un chiffre sans origine.
--
-- À faire une fois le workspace activé, avec le prix lu dans la console :
--
--   insert into agents.model_pricing
--     (provider, model, role, price_in_per_mtok, price_out_per_mtok,
--      currency, sovereign, effective_from)
--   values
--     ('alibaba', 'qwen-vl-ocr-latest', 'vision', <in>, <out>,
--      'CNY', false, current_date);
