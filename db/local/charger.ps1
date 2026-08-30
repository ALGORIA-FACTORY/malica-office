# Monte une base Regalica Office locale, à partir des migrations du dépôt.
#
# Le schéma n'est pas copié depuis la production : il est REJOUÉ depuis
# `supabase/migrations`, qui en est la source de vérité. La base locale contient
# donc le schéma complet et le référentiel fiscal semé par les migrations —
# et AUCUNE donnée de tenant. Les pièces et les organisations des clients
# restent là où elles doivent être.
#
#   .\db\local\charger.ps1                  # crée regalica_local
#   .\db\local\charger.ps1 -Recreate        # la supprime d'abord

param(
  [string]$Base = "regalica_local",
  [string]$PgUser = "postgres",
  [string]$PgHost = "localhost",
  [int]$Port = 5432,
  [switch]$Recreate
)

$ErrorActionPreference = "Stop"
$racine = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$migrations = Join-Path $racine "supabase\migrations"

# PostgreSQL 16 est la version de reference du Guide de Stack (§06). On la
# prefere si plusieurs versions cohabitent sur le poste.
$psql = $null
foreach ($v in @("16", "17", "15")) {
  $c = "C:\Program Files\PostgreSQL\$v\bin\psql.exe"
  if (Test-Path $c) { $psql = $c; break }
}
if (-not $psql) { $psql = (Get-Command psql -ErrorAction SilentlyContinue).Source }
if (-not $psql) { throw "psql introuvable : installez PostgreSQL 16, ou ajoutez-le au PATH." }

if (-not $env:PGPASSWORD) {
  throw "Definissez `$env:PGPASSWORD avant de lancer ce script (mot de passe du superutilisateur local)."
}

function Run($db, $sql)  { & $psql -h $PgHost -p $Port -U $PgUser -d $db -v ON_ERROR_STOP=1 -q -c $sql }
function File($db, $f)   { & $psql -h $PgHost -p $Port -U $PgUser -d $db -v ON_ERROR_STOP=1 -q -f $f }

if ($Recreate) {
  Write-Host "suppression de $Base" -ForegroundColor DarkYellow
  Run "postgres" "drop database if exists $Base with (force);"
}
Run "postgres" "select 1"; if (-not $?) { throw "connexion au serveur impossible" }

$existe = (& $psql -h $PgHost -p $Port -U $PgUser -d postgres -t -A -c "select 1 from pg_database where datname='$Base'")
if (-not $existe) {
  Write-Host "creation de $Base" -ForegroundColor Cyan
  Run "postgres" "create database $Base;"
}

Write-Host "couche de compatibilite Supabase" -ForegroundColor Cyan
File $Base (Join-Path $PSScriptRoot "00_compat_supabase.sql")

# pgvector est present chez Supabase mais absent d'une installation Windows
# standard. Plutot que d'echouer sur une seule colonne, on adapte la migration
# concernee et on le dit franchement.
$vector = (& $psql -h $PgHost -p $Port -U $PgUser -d $Base -t -A -c "select 1 from pg_extension where extname='vector'")
if (-not $vector) {
  Write-Host "pgvector ABSENT — legal.chunks.embedding devient real[], index HNSW ignore" -ForegroundColor Yellow
}

$temp = Join-Path $env:TEMP "regalica-migrations"
New-Item -ItemType Directory -Force -Path $temp | Out-Null

$n = 0
foreach ($m in Get-ChildItem $migrations -Filter *.sql | Sort-Object Name) {
  $cible = $m.FullName
  if (-not $vector) {
    $texte = Get-Content $m.FullName -Raw
    if ($texte -match "extensions\.vector") {
      $texte = $texte -replace "extensions\.vector\(\d+\)", "real[]"
      # L'index HNSW n'a aucun sens sans le type : on le retire proprement.
      $texte = $texte -replace "(?ms)create index\s+\S*hnsw\S*.*?;", ""
      $texte = $texte -replace "(?m)^\s*create extension if not exists vector[^;]*;", ""
      $cible = Join-Path $temp $m.Name
      Set-Content -Path $cible -Value $texte -Encoding utf8
    }
  }
  Write-Host ("  {0}" -f $m.Name)
  File $Base $cible
  $n++
}

Write-Host ""
Write-Host "$n migrations appliquees sur $Base" -ForegroundColor Green

$resume = "select table_schema, count(*) as tables from information_schema.tables " +
          "where table_type='BASE TABLE' and table_schema not in " +
          "('information_schema','pg_catalog','pg_toast') group by 1 order by 1;"
& $psql -h $PgHost -p $Port -U $PgUser -d $Base -c $resume
