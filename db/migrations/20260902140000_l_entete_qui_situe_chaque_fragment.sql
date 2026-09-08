-- L'en-tete qui situe chaque fragment.
--
-- ============================================================ LE PROBLEME
--
-- Un fragment decoupe perd ce qui le situait. Celui qui porte « le taux est
-- porte a 19 % » ne dit plus, a lui seul, de quel impot ni de quelle annee il
-- parle : il devient introuvable a la question « taux de TVA ». Anthropic a
-- mesure ce defaut et son remede — prefixer chaque fragment d'une phrase qui le
-- situe avant de l'encoder — a 35 % d'echecs de recherche en moins.
--
-- Anthropic fait ecrire cette phrase par un modele, ce qui coute et ce qui peut
-- inventer. Nous n'en avons pas besoin : tout est deja en base — le nom du
-- corpus, le numero, l'edition, la nature du texte, son autorite, a qui il est
-- opposable, son statut. L'en-tete se COMPOSE. C'est le role de la fonction
-- ci-dessous : une seule regle, ecrite une seule fois, verifiable.
--
-- ============================================================ ET L'ARABE
--
-- L'en-tete porte le nom du corpus dans LES DEUX LANGUES. Mesure faite avant
-- cette migration : a la question francaise « convention fiscale entre la
-- Tunisie et l'Arabie saoudite : imposition des dividendes », la convention en
-- question — qui n'existe qu'en arabe — ne remontait pas une seule fois dans
-- les cinq premiers resultats. Le nom francais colle desormais au fragment
-- arabe, et le nom arabe au fragment francais.
--
-- ============================================================ CE QU'IL NE FAIT PAS
--
-- L'en-tete n'entre PAS dans `legal.chunks.texte` : le texte servi reste
-- l'extrait exact de la version, mot pour mot. L'en-tete est une aide a la
-- recherche, rangee a part, et Malica ne la cite jamais.

begin;

-- 1. Les sept corpus qui n'avaient pas de nom.
insert into legal.corpus_noms (code, nom_fr, nom_ar, famille, porte_le_droit) values
  ('CASSUR',  'code des assurances', 'مجلة التأمين', 'code', true),
  ('CDOUANE', 'code des douanes', 'مجلة الديوانة', 'code', true),
  ('CNSS',    'loi n° 60-30 relative aux régimes de sécurité sociale',
              'القانون عدد 30 لسنة 1960 المتعلق بأنظمة الضمان الاجتماعي', 'loi', true),
  ('NCT',     'normes comptables tunisiennes', 'المعايير المحاسبية التونسية', 'code', true),
  ('CONV-ARABIE-SAOUDITE', 'convention fiscale Tunisie–Arabie saoudite',
              'الاتفاقية الجبائية بين تونس والمملكة العربية السعودية', 'convention', true),
  ('CONV-EGYPTE', 'convention fiscale Tunisie–Égypte',
              'الاتفاقية الجبائية بين تونس ومصر', 'convention', true),
  ('DECRET_LOI_FINANCES_NOV', 'décret-loi n° 2022-69 du 22 novembre 2022',
              'المرسوم عدد 69 لسنة 2022', 'loi_finances', true)
on conflict (code) do nothing;

-- 2. La phrase qui situe un fragment. Deterministe : memes entrees, meme sortie.
create or replace function legal.entete_de_fragment(
  p_corpus text, p_numero text, p_edition int, p_source text, p_statut text
) returns text
language sql stable as $fn$
  select
    case when n.famille = 'doctrine'
         then 'Note commune n° ' || p_numero
              || coalesce(' de ' || substring(p_corpus from '\d{4}$'), '')
              || coalesce(' — ' || n.nom_ar, '')
         else coalesce(n.nom_fr, p_corpus)
              || coalesce(' — ' || n.nom_ar, '')
              || ', article ' || p_numero
              || coalesce(', édition ' || p_edition::text, '')
    end
    || '. ' || coalesce(s.libelle, 'texte de nature indéterminée')
    || ', portée ' || coalesce(s.autorite, 'indéterminée')
    || case when coalesce(array_length(s.opposable_a, 1), 0) > 0
            then ', opposable à : ' || array_to_string(s.opposable_a, ', ')
            else '' end
    || '. '
    || case p_statut
         when 'en_vigueur'           then 'En vigueur'
         when 'abroge'               then 'Abrogé'
         when 'annule'               then 'Annulé'
         when 'caduc'                then 'Caduc'
         when 'non_entre_en_vigueur' then 'Non entré en vigueur'
         else 'Statut indéterminé'
       end
    || '.'
  from (select 1) rien
  left join legal.corpus_noms n on n.code = p_corpus
  left join legal.sources s on s.code = p_source;
$fn$;

comment on function legal.entete_de_fragment(text, text, int, text, text) is
  'La phrase qui situe un fragment pour la recherche : nom du corpus dans les deux langues, numéro, édition, nature, autorité, opposabilité, statut. Elle est encodée avec le fragment mais ne fait jamais partie du texte servi.';

-- 3. Le fragment garde l'en-tete avec lequel il a ete encode.
--
-- On l'ECRIT plutot que de le recalculer a la volee, pour une raison : le
-- statut d'un article change, les editions s'ajoutent. Un en-tete range a cote
-- de l'empreinte dit ce qui a REELLEMENT ete encode ce jour-la ; un contrôle le
-- compare a ce que la fonction rendrait aujourd'hui, et signale ce qui a vieilli.
alter table legal.chunks add column if not exists entete text;

comment on column legal.chunks.entete is
  'La phrase de contexte encodée en tête de ce fragment. Ne fait pas partie du texte servi.';

commit;
