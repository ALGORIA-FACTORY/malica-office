-- ============================================================================
-- Le defaut de `ancre_texte_min` passe de 3 a 2, apres mesure.
-- ============================================================================
--
-- ------------------------------------------------------------- CE QU'ON CORRIGE
--
-- La migration 20261020090000 a livre `fabrique.seuil.recette.ancre_texte_min`
-- a 3, et elle le disait elle-meme : « un POINT DE DEPART A MESURER, pas un
-- releve ». La limite n° 4 du 19 octobre 2026 le reprenait :
--
--   « `ancre_texte_min = 3` rend impossible une recette designant un total HT
--     de facture francaise ordinaire — « HT » fait deux caracteres. R10 : le
--     cabinet le change sans deploiement, mais le defaut livre n'est
--     probablement pas 3. »
--
-- Deux agents l'ont signale, et le second l'a mesure : la recette de banc etait
-- refusee sur « HT » et « Qte ».
--
-- ------------------------------------------------------- CE QUE LA MESURE DONNE
--
-- Mesure dans `apps/api/src/fabrique/interprete.test.ts`, sur le pied de la
-- facture francaise de banc, en comptant pour chaque ancre de la recette
-- COMBIEN de jetons elle attrape reellement :
--
--   « HT »          2 caracteres   1 jeton
--   « TVA »         3 caracteres   1 jeton
--   « TTC »         3 caracteres   1 jeton
--   « Qte »         3 caracteres   1 jeton
--   « Total »       5 caracteres   3 jetons
--   « FACTURE »     7 caracteres   2 jetons
--   « Designation » 11 caracteres  1 jeton
--
-- La borne a 3 refuse donc QUATRE ancres qui ne designent qu'un jeton, et
-- AUCUNE des deux qui en designent plusieurs. Elle ne protege pas de ce qu'elle
-- visait : elle n'est pas trop haute, elle porte sur la mauvaise grandeur.
--
-- Ce qui discrimine est le GENRE du motif, et cela se mesure aussi : « HT » en
-- `exact` attrape un jeton, le meme « HT » en `contient` en attrape trois
-- (« HT », « P.U.HT », « BaseHT »). Une borne de longueur refuse les deux ou
-- accepte les deux ; elle ne peut pas les distinguer.
--
-- Et la garde qui tient vraiment est ailleurs, elle aussi mesuree : `prendre:
-- unique` refuse de choisir, donc une ancre trop large s'ABSTIENT au lieu de
-- designer en silence — y compris « Total », cinq caracteres et trois jetons.
--
-- ------------------------------------------------------------ CE QUI S'OUVRE
--
-- A 2, une ancre de DEUX caracteres devient acceptable. Ce qui devient donc
-- acceptable et ne devrait pas l'etre : un motif `contient` de deux caracteres
-- — « HT » inclus, qui attrape tout le pied — associe a un `prendre` qui
-- choisit (`premier`, `dernier`, `nieme`) plutot qu'a `unique`. Cette recette
-- designerait un jeton sans jamais le dire.
--
-- Ce trou n'est pas ouvert par ce changement : il existait deja a toute
-- longueur, et la mesure ci-dessus le montre — « Total » en `exact` avec
-- `premier` est exactement ce cas, et la borne a 3 ne l'a jamais inquiete. La
-- borne de longueur ne le fermait pas ; elle fermait le pied de facture
-- francaise.
--
-- Une ancre d'UN caractere reste refusee. C'est ce que la borne garde de
-- defendable : un caractere seul n'est pas une etiquette, c'est un symbole
-- (« D » pour dinar) et il revient partout. Le cas arabe nomme par la migration
-- du 20 octobre — « ت » pour la date — reste donc refuse par le defaut, et un
-- cabinet l'abaisse a 1 sans deploiement (R10).
--
-- ------------------------------------------- LA GARDE QUI DEVRAIT LA REMPLACER
--
-- La grandeur juste est le NOMBRE DE JETONS qu'une ancre attrape sur les
-- exemples de la recette, et elle ne se tient pas dans le validateur : il est
-- pur et ne voit aucune piece, par construction. Elle se tient la ou les plans
-- existent — a la GENERATION, quand le modele propose, et a l'EVALUATION, avant
-- qu'une recette soit activee. Cela appartient a `fabrique/generateur*` et
-- `fabrique/cycle*` ; la forme exacte est ecrite dans
-- `.superpowers/sdd/fabrique/limites-langage-report.md`, et n'est pas posee ici.
--
-- ------------------------------------------------------------------------ R11
--
-- La date de validite est un LITTERAL, et elle n'est pas dans le futur : elle
-- vaut aujourd'hui, donc la borne change des que la migration est jouee. La
-- ligne du 18 octobre n'est pas reecrite ni close par `current_date` —
-- `fabrique.bornes_de_recette` prend la plus recente des lignes valides
-- (`distinct on (code) ... order by code, valid_from desc`), donc deux machines
-- qui jouent ce depot a deux jours d'intervalle obtiennent le meme referentiel.
--
-- R10 : le defaut reste surchargeable par cabinet, sans deploiement, par
-- `parametrage.fabrique_seuils`, et `arrete_par_le_cabinet` continue de dire
-- qui a decide.

insert into ref.socle_params
  (pack_version_id, code, value_num, legal_reference, valid_from)
select p.id,
       'fabrique.seuil.recette.ancre_texte_min',
       2,
       'Politique de fabrique de lecteurs ALGORIA',
       date '2026-10-19'
  from ref.jurisdiction_packs p
 where p.effective_from <= date '2026-10-19'
   and (p.effective_to is null or p.effective_to >= date '2026-10-19')
on conflict (pack_version_id, code, valid_from) do nothing;
