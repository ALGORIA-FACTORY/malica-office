# Monte une base Malica Office locale, à partir des migrations du dépôt.
#
# Le schéma n'est pas copié depuis la production : il est REJOUÉ depuis
# `db/migrations`, qui en est la source de vérité. La base locale contient
# donc le schéma complet et le référentiel fiscal semé par les migrations —
# et AUCUNE donnée de tenant. Les pièces et les organisations des clients
# restent là où elles doivent être.
#
#   .\db\local\charger.ps1                  # crée malica_local
#   .\db\local\charger.ps1 -Recreate        # la supprime d'abord

param(
  [string]$Base = "malica_local",
  [string]$PgUser = "postgres",
  [string]$PgHost = "localhost",
  [int]$Port = 5432,
  [switch]$Recreate
)

$ErrorActionPreference = "Stop"
$racine = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

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

# Les migrations sont jouees TELLES QU'ELLES SONT, et par db/migrer.mjs : le
# seul chemin qui tient le registre app.migrations. Ce chargeur les jouait par
# psql, sans registre ; une base montee ainsi ne pouvait ensuite rejoindre
# migrer.mjs qu'en etant « adoptee » — inscrite sans verification. C'est ce qui
# a fait mentir le registre de malica_local le 8 septembre 2026. Il n'y a plus
# qu'un chemin : celui de la CI et des serveurs. migrer.mjs joue aussi la
# couche de compatibilite (auth, roles) avant les migrations.
#
# Ce chargeur a longtemps reecrit leur texte au vol quand pgvector manquait :
# vector(768) devenait real[], l'index HNSW disparaissait. La base locale et une
# base de production n'avaient donc pas le meme schema, et rien ne le disait
# hors d'une ligne de console. Un chargeur qui adapte les migrations n'est pas
# un chargeur : c'est une divergence automatisee.
#
# Le schema legal a ete retire (migration 20260830190000), ce qui supprime le
# besoin du TYPE vector. Il reste la ligne "create extension if not exists
# vector" en tete de la migration 20260824130649, qui echouera si l'extension
# n'est pas disponible sur le serveur.
#
# C'est voulu. Un echec bruyant vaut mieux qu'une adaptation silencieuse : il
# dit qu'il manque quelque chose, la ou l'ancienne version laissait croire que
# tout allait bien.
$url = "postgres://{0}:{1}@{2}:{3}/{4}" -f $PgUser, [uri]::EscapeDataString($env:PGPASSWORD), $PgHost, $Port, $Base
$arguments = @((Join-Path $racine "db\migrer.mjs"), "--base", $url)
# Le role de connexion de l'API doit avoir un mot de passe pour se connecter.
# Il est propre a l'environnement : jamais dans un fichier versionne. Le role
# est global au serveur : le poser change aussi celui des autres bases.
if ($env:MALICA_API_PASSWORD) {
  $arguments += "--mot-de-passe-api"
} else {
  Write-Host "  MALICA_API_PASSWORD absente : le mot de passe de malica_api reste celui qu'il est." -ForegroundColor Yellow
}
& node @arguments
if ($LASTEXITCODE -ne 0) { throw "db/migrer.mjs a echoue sur $Base" }

$resume = "select table_schema, count(*) as tables from information_schema.tables " +
          "where table_type='BASE TABLE' and table_schema not in " +
          "('information_schema','pg_catalog','pg_toast') group by 1 order by 1;"
& $psql -h $PgHost -p $Port -U $PgUser -d $Base -c $resume
