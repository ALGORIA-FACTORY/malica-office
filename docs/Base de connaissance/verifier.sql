\echo '=== COMPTAGES ==='
select 'comptes officiels (NC 01)      ' l, count(*) n from ref.accounts where is_official
union all select 'extensions Regalica            ', count(*) from ref.accounts where not is_official
union all select 'rôles comptables               ', count(*) from ref.account_roles
union all select 'liaisons rôle -> compte (TN)   ', count(*) from ref.role_bindings
union all select 'schémas d''écriture             ', count(*) from ref.entry_templates
union all select 'lignes de schéma               ', count(*) from ref.entry_template_lines
union all select 'contrôles                      ', count(*) from ref.entry_controls
union all select 'paramètres fiscaux             ', count(*) from ref.fiscal_parameters
union all select 'tranches de barème             ', count(*) from ref.fiscal_scale_brackets
union all select 'obligations déclaratives       ', count(*) from ref.fiscal_obligations
union all select 'documents en file d''ingestion  ', count(*) from legal.ingestion_queue;

\echo ''
\echo '=== INVARIANTS : tout doit être à zéro ==='
select 'rôle utilisé par un schéma mais sans liaison' i, count(*) n
  from (select distinct role_code from ref.entry_template_lines) l
  where not exists (select 1 from ref.role_bindings b where b.role_code = l.role_code)
union all
select 'liaison vers un compte inexistant', count(*)
  from ref.role_bindings b
  where not exists (select 1 from ref.accounts a where a.account_code = b.account_code)
union all
select 'liaison violant la classe admise', count(*)
  from ref.role_bindings b
  join ref.account_roles r on r.code = b.role_code
  join ref.accounts a on a.account_code = b.account_code
  where not (a.account_class = any(r.classes_admises))
union all
select 'paramètre calculable sans citation', count(*)
  from ref.fiscal_parameters where valeur_num is not null and (article is null or citation is null)
union all
select 'paramètre non établi portant une valeur', count(*)
  from ref.fiscal_parameters where confiance='non_trouve' and valeur_num is not null
union all
select 'compte orphelin (parent inexistant)', count(*)
  from ref.accounts a where a.parent_code is not null
    and not exists (select 1 from ref.accounts p where p.account_code = a.parent_code)
union all
select 'schéma citant un contrôle inconnu', count(*)
  from ref.entry_templates t where t.controle is not null
    and not exists (select 1 from ref.entry_controls c where c.code = t.controle);

\echo ''
\echo '=== CORPUS JURIDIQUE ==='
select 'documents en file        ' l, count(*)::text n from legal.ingestion_queue
union all select 'documents ingérés        ', count(*)::text from legal.documents
union all select 'pages extraites          ', sum(pages)::text from legal.documents
union all select 'dont océrisés            ', count(*)::text from legal.documents where origine_texte='ocr'
union all select 'références extraites     ', count(*)::text from legal.references_extraites
union all select 'articles découpés        ', count(*)::text from legal.articles_extraits
union all select 'identités d''articles     ', count(*)::text from legal.articles
union all select 'versions d''articles      ', count(*)::text from legal.article_versions;

\echo ''
\echo '=== INVARIANTS DU CORPUS : tout doit être à zéro ==='
select 'article sans empreinte' i, count(*) n from legal.articles_extraits where sha256 is null or length(sha256)<>64
union all select 'version orpheline', count(*) from legal.article_versions v
  where not exists (select 1 from legal.articles a where a.id=v.article_id)
union all select 'document ingéré hors de la file', count(*) from legal.documents d
  where not exists (select 1 from legal.ingestion_queue q where q.id=d.queue_id)
union all select 'document ingéré sans empreinte', count(*) from legal.documents where sha256 is null;
