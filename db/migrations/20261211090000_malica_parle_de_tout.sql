-- « Parler à Malica » parle de tout : la garde des chiffres ne retient que ce qui engage.
--
-- Mesuré le 11 novembre 2026 sur le vrai modèle (docs/validation-chat-malica/
-- qualite-claude.md) : la règle « toute phrase qui porte un chiffre sans source
-- est retirée » vidait les réponses générales — « 17 % de 2 450 » sans
-- résultat, une formule de tableur sans la formule, Ibn Khaldoun sans ses
-- dates. Note de l'axe « parler de tout » : 5,5 sur 10, contre 9 pour le même
-- modèle sans Malica.
--
-- R3 interdit à Malica d'émettre une valeur LIANTE. Une année de naissance n'en
-- est pas une ; un montant, un taux, un délai en sont. Trois ajouts :
--
--   1. `plateforme.assistant_gardes` — ce qui rend un chiffre liant (R4 : en
--      base, versionné, réglable) : les marques d'une phrase qui engage, et le
--      seuil à partir duquel un entier est un montant. Sans ligne, la garde
--      juge TOUT chiffre, comme avant : le manque retombe du côté strict.
--   2. `public.assistant_configuration()` rend cette règle au serveur.
--   3. La consigne gagne la section « PARLER DE TOUT » et l'outil `calculer`
--      (le moteur du Socle calcule ; le modèle n'écrit que l'opération, sur des
--      nombres donnés par la personne ou par un outil du tour).
--
-- INCERTAIN, à confirmer par le dirigeant et un expert-comptable : la liste
-- des marques est un DÉFAUT livré (R10), large à dessein — une phrase générale
-- qui emploie « taux », « prix » ou « loi » avec un chiffre reste jugée.

begin;

create table if not exists plateforme.assistant_gardes (
  id                uuid primary key default gen_random_uuid(),
  -- Un mot entier (« taux »), une racine suivie d'un astérisque (« factur* »),
  -- ou un signe (« % »). En minuscules, sans accent.
  marques_liantes   text[] not null check (cardinality(marques_liantes) between 1 and 500),
  entier_liant_des  integer not null check (entier_liant_des between 1 and 1000000000),
  motif             text not null check (length(btrim(motif)) > 0),
  decide_par        uuid references auth.users (id),
  decide_le         timestamptz not null default now()
);

comment on table plateforme.assistant_gardes is
  'Ce qui rend un chiffre liant dans « Parler à Malica » : les marques d''une phrase qui engage '
  'et le seuil d''un entier-montant. Un chiffre liant sans source est retiré. La dernière '
  'décision vaut ; rien ne se réécrit.';

create index if not exists assistant_gardes_recent_idx
  on plateforme.assistant_gardes (decide_le desc);

alter table plateforme.assistant_gardes enable row level security;
revoke all on table plateforme.assistant_gardes from public, anon;
grant select on table plateforme.assistant_gardes to authenticated;

drop policy if exists assistant_gardes_lire on plateforme.assistant_gardes;
create policy assistant_gardes_lire on plateforme.assistant_gardes
  for select to authenticated using ((select app.is_platform()));

drop trigger if exists assistant_gardes_ne_se_reecrivent_pas on plateforme.assistant_gardes;
create trigger assistant_gardes_ne_se_reecrivent_pas
  before update or delete on plateforme.assistant_gardes
  for each row execute function app.deny_mutation();

insert into plateforme.assistant_gardes (marques_liantes, entier_liant_des, motif, decide_le)
select array[
         -- les signes et les monnaies
         '%', '‰', '٪', '€', '$', '£', 'pour cent', 'pourcent*', 'percent*',
         'tnd', 'dt', 'dinar*', 'millime*', 'eur', 'euro*', 'usd', 'dollar*', 'fcfa', 'xof',
         'دينار', 'مليم', 'أورو', 'دولار',
         -- le droit et l'impôt
         'tva', 'taxe*', 'impot*', 'fiscal*', 'retenue*', 'timbre*', 'taux', 'seuil*', 'plafond*',
         'delai*', 'echeance*', 'penalite*', 'amende*', 'majoration*', 'interet*', 'cotisation*',
         'cnss', 'smig', 'smag', 'declar*', 'exercice*', 'article*', 'loi', 'lois', 'decret*',
         'code', 'note commune', 'notes communes', 'circulaire*', 'jort',
         'أداء', 'ضريبة', 'نسبة', 'معلوم', 'خطية', 'فصل', 'قانون', 'أجل', 'مجلة',
         'vat', 'tax', 'taxes', 'rate', 'rates', 'threshold*', 'deadline*', 'penalt*',
         -- les comptes et l'argent
         'ht', 'ttc', 'factur*', 'montant*', 'total', 'totaux', 'solde*', 'chiffre d''affaires',
         'benefice*', 'resultat*', 'charge*', 'achat*', 'achet*', 'vente*', 'vend*', 'dette*',
         'creance*', 'capital', 'amorti*', 'prix', 'cout*', 'coute*', 'paie*', 'pay*', 'regl*',
         'rembours*', 'remise*', 'marge*', 'tresorerie', 'budget*', 'loyer*', 'honoraire*',
         'salaire*', 'fournisseur*', 'client*', 'piece*', 'ecriture*', 'compte*',
         'فاتورة', 'مبلغ', 'سعر', 'ثمن', 'مزود', 'حريف', 'رصيد',
         'amount*', 'invoice*', 'price*', 'cost*', 'fee', 'fees', 'salary', 'supplier*', 'customer*'
       ]::text[],
       10000,
       'Défaut livré : un chiffre engage dans une phrase qui parle d''argent, d''impôt ou de droit, '
       || 'ou quand il a des décimales ou vaut dix mille et plus. Le reste (une année, un âge, un rang) passe.',
       timestamptz '2026-11-11 09:00:00+00'
 where not exists (select 1 from plateforme.assistant_gardes);

-- La configuration lue par le serveur gagne la règle de la garde.
create or replace function public.assistant_configuration()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if coalesce(current_setting('malica.origine', true), '') <> 'serveur' then
    raise exception 'refus.reserve.serveur' using errcode = '42501';
  end if;
  return (
  with c as (
    select k.id, k.texte, k.decide_le from plateforme.assistant_consignes k
     order by k.decide_le desc, k.id desc limit 1
  ), r as (
    select to_jsonb(g) - 'decide_par' - 'motif' as j, g.modele_courant, g.modele_difficile
      from plateforme.assistant_reglages g
     order by g.decide_le desc, g.id desc limit 1
  )
  select jsonb_build_object(
    'consigne', (select jsonb_build_object('id', c.id, 'texte', c.texte, 'decide_le', c.decide_le) from c),
    'reglage', (select r.j from r),
    'tarifs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'model', p.model, 'role', p.role,
               'in', p.price_in_per_mtok, 'out', p.price_out_per_mtok)
             order by p.model, p.role)
        from agents.model_pricing p, r
       where p.model in (r.modele_courant, r.modele_difficile)
         and p.effective_from <= current_date
         and (p.effective_to is null or p.effective_to > current_date)), '[]'::jsonb),
    'plafond', app.plafond_de_l_assistant(),
    -- Ce qui rend un chiffre liant ; absent, la garde juge tout chiffre.
    'garde', (select jsonb_build_object(
                'marques_liantes', to_jsonb(g.marques_liantes),
                'entier_liant_des', g.entier_liant_des)
                from plateforme.assistant_gardes g
               order by g.decide_le desc, g.id desc limit 1)));
end
$function$;

revoke all on function public.assistant_configuration() from public, anon;
grant execute on function public.assistant_configuration() to authenticated;

insert into plateforme.assistant_consignes (texte, motif, decide_le)
select k.texte || E'\n\n' || $section$PARLER DE TOUT
Tu n'es pas limitée à la comptabilité. Une question générale — culture, histoire, sciences, économie, langue, rédaction, traduction, bureautique, organisation, conseil pratique — reçoit une vraie réponse, complète et soignée, comme celle d'une assistante cultivée. Pour une explication, donne dans cet ordre : l'essentiel en une ou deux phrases ; le mécanisme ou les raisons, en quelques points ; un exemple concret de la vie courante, raconté sans aucun nombre — ni prix, ni pourcentage, ni quantité (« un panier de courses qui coûte un peu plus cher chaque mois ») ; et, si c'est utile, ce que cela change en pratique pour une PME. Pour ces réponses, les phrases peuvent être plus longues, et les listes et le gras sont bienvenus ; pas d'intertitre : des paragraphes qui s'enchaînent.
Tu n'écris jamais de phrase sur ta façon de répondre : ni que la question est générale ou hors du dossier, ni que tu n'as pas consulté les données, ni qu'aucun outil ou aucune règle n'est en jeu. Tu réponds, et tu t'arrêtes. Tu ne ramènes pas la conversation au dossier si la personne ne le demande pas.
Dans une réponse générale, les nombres de culture générale sont permis : une année, un siècle, un âge, une durée, un rang, un décompte. La règle des chiffres vaut toujours, sans exception, pour tout ce qui engage : un montant, un prix, un pourcentage, un taux, un seuil, un délai légal, et tout chiffre du dossier ou du droit. Ceux-là viennent d'un outil de ce tour ou de la personne elle-même ; écrits de mémoire, ils sont retirés.
Un calcul ne se fait jamais de tête. Tu appelles calculer avec l'opération — « 2450 * 17 / 100 » — sur des nombres que la personne t'a donnés ou qu'un outil t'a rendus dans ce tour ; puis tu donnes le résultat rendu et tu montres l'opération, étape par étape si elle en a plusieurs (un appel par étape). Pour un exemple chiffré, prends les nombres de la personne ou ceux du dossier : n'invente ni montant ni taux d'exemple.
Une formule de tableur ou un extrait de code s'écrit entre accents graves, seul sur sa ligne, et une formule commence par le signe égal : `=A2*(1+B2)`. Tu expliques ensuite chaque élément en mots, en écrivant entre accents graves le morceau de formule dont tu parles (`A2`, `1+B2`). Tu ne donnes ni taux ni montant d'exemple, même hypothétique : pour illustrer, propose à la personne de te donner ses propres nombres.
Dans la langue de la personne, du premier au dernier mot : une question en arabe reçoit une réponse entièrement en arabe, y compris quand elle porte sur le dossier.$section$,
       'Ajout de la section « PARLER DE TOUT » (réponses générales complètes, outil calculer, formules) : '
       || 'mesure du 11 novembre 2026, axe « parler de tout » à 5,5 sur 10.',
       greatest(timestamptz '2026-11-11 09:00:00+00', k.decide_le + interval '1 second')
  from (select c.texte, c.decide_le
          from plateforme.assistant_consignes c
         order by c.decide_le desc, c.id desc
         limit 1) k
 where not exists (
   select 1 from plateforme.assistant_consignes c
    where c.motif like 'Ajout de la section « PARLER DE TOUT »%');

commit;
