# Charge le corpus juridique dans une base déjà migrée.
#
# ============================================================ POURQUOI À PART
#
# Les migrations créent les tables du corpus ; elles ne portent pas son contenu.
# Vingt-trois mégaoctets de textes de loi ne sont pas un schéma : ils vivent
# dans `docs/Base de connaissance/`, et ils s'ALIMENTENT — le Journal officiel
# publie, une loi de finances paraît, un article est amendé.
#
# C'est le volet 2 du paramétrage : Algoria Factory et son partenaire
# entretiennent ce corpus, hors de tout cabinet et de toute PME.
#
# ============================================================ CE QUI EST CHARGÉ
#
#   788 documents en file d'ingestion, dont 786 ingérés
#   3 110 articles identifiés
#   4 902 versions datées, texte intégral, arabe faisant foi
#   23 631 références juridiques extraites
#
# L'ordre n'est pas négociable : les versions référencent les articles, les
# références référencent la file. On charge les parents d'abord.
#
#   .\db\corpus\charger.ps1                       # base locale par défaut
#   .\db\corpus\charger.ps1 -Base autre_base
#
# Le mot de passe passe par $env:PGPASSWORD, jamais par la ligne de commande.

param(
  [string]$Base = "malica_local",
  [string]$PgUser = "postgres",
  [string]$PgHost = "localhost",
  [int]$Port = 5432,
  [string]$Archive = "docs\Base de connaissance\referentielmalica20260831.tar.gz"
)

$ErrorActionPreference = "Stop"
$racine = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

$psql = $null
foreach ($v in @("17", "16", "15")) {
  $c = "C:\Program Files\PostgreSQL\$v\bin\psql.exe"
  if (Test-Path $c) { $psql = $c; break }
}
if (-not $psql) { $psql = (Get-Command psql -ErrorAction SilentlyContinue).Source }
if (-not $psql) { throw "psql introuvable : installez PostgreSQL, ou ajoutez-le au PATH." }

if (-not $env:PGPASSWORD) {
  throw "Definissez `$env:PGPASSWORD avant de lancer ce script."
}

$archivePath = Join-Path $racine $Archive
if (-not (Test-Path $archivePath)) { throw "archive introuvable : $archivePath" }

$temp = Join-Path $env:TEMP "malica-corpus"
if (Test-Path $temp) { Remove-Item $temp -Recurse -Force }
New-Item -ItemType Directory -Force -Path $temp | Out-Null

Write-Host "extraction de l'archive" -ForegroundColor Cyan
tar -xzf $archivePath -C $temp
$dump = Join-Path $temp "paquet\dump_referentiel.sql"
if (-not (Test-Path $dump)) { throw "dump introuvable dans l'archive" }

# On ne charge QUE les tables du corpus : le reste du dump ferait doublon avec
# les migrations, qui font foi pour le schéma comme pour le référentiel.
$tables = @(
  "legal.ingestion_queue",
  "legal.articles",
  "legal.article_versions",
  "legal.references_extraites"
)

Write-Host "extraction des blocs de donnees" -ForegroundColor Cyan
#
# Les blocs sont ecrits dans l'ordre de $tables, PAS dans celui du dump.
#
# La version precedente recopiait les COPY au fil du dump. Or pg_dump les range
# par ordre alphabetique de table : article_versions arrivait avant articles, et
# le chargement mourait a la premiere ligne sur la contrainte
# article_versions_article_id_fkey. Le truncate ayant deja eu lieu, la base
# restait vide : corpus perdu, message de succes affiche quand meme.
#
# On indexe donc chaque bloc par sa table, puis on ecrit les parents d'abord.
$sortie = Join-Path $temp "corpus.sql"
$lignes = [System.IO.File]::ReadAllLines($dump)
$blocs = @{}
$courant = $null
foreach ($l in $lignes) {
  if ($l.StartsWith("COPY ")) {
    $nom = $l.Split(" ")[1]
    $courant = if ($tables -contains $nom) { $nom } else { $null }
    if ($courant) { $blocs[$courant] = [System.Collections.Generic.List[string]]::new(); $blocs[$courant].Add($l) }
    continue
  }
  if ($courant) {
    $blocs[$courant].Add($l)
    if ($l -eq "\.") { $courant = $null }
  }
}
$ecrivain = [System.IO.StreamWriter]::new($sortie, $false, [System.Text.UTF8Encoding]::new($false))
foreach ($t in $tables) {
  if (-not $blocs.ContainsKey($t)) { throw "bloc COPY absent du dump pour $t" }
  Write-Host ("  {0} : {1} lignes" -f $t, ($blocs[$t].Count - 2))
  foreach ($l in $blocs[$t]) { $ecrivain.WriteLine($l) }
}
$ecrivain.Close()

# Le corpus se REMPLACE, il ne s'accumule pas : une réingestion apporte une
# nouvelle photo de la file, et garder l'ancienne créerait des doublons dont
# personne ne saurait dire lequel fait foi.
Write-Host "remplacement du corpus" -ForegroundColor Yellow
& $psql -h $PgHost -p $Port -U $PgUser -d $Base -v ON_ERROR_STOP=1 -q -c `
  "truncate legal.references_extraites, legal.articles_extraits, legal.article_versions, legal.articles, legal.ingestion_queue cascade;"

& $psql -h $PgHost -p $Port -U $PgUser -d $Base -v ON_ERROR_STOP=1 -q -f $sortie
# Un chargement qui echoue apres le truncate laisse la base VIDE. Le script
# annoncait "corpus charge" quand meme, en vert. Il ne le fait plus.
if ($LASTEXITCODE -ne 0) {
  throw "le chargement du corpus a echoue (psql code $LASTEXITCODE). La base est vide : relancez apres correction."
}

Write-Host ""
$resume = "select 'documents' q, count(*)::text r from legal.ingestion_queue " +
          "union all select 'dont ingeres', count(*)::text from legal.ingestion_queue where statut='ingere' " +
          "union all select 'articles', count(*)::text from legal.articles " +
          "union all select 'versions', count(*)::text from legal.article_versions " +
          "union all select 'references', count(*)::text from legal.references_extraites;"
& $psql -h $PgHost -p $Port -U $PgUser -d $Base -c $resume

Remove-Item $temp -Recurse -Force
Write-Host "corpus charge." -ForegroundColor Green
