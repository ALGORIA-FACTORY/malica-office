#!/usr/bin/env bash
# Les flux Maestro, un par un, sur l'émulateur de android-e2e.yml.
#
# Un flux qui échoue sur une ASSERTION échoue : il n'est pas rejoué. Seule
# une déconnexion de l'émulateur (adb qui le perd, Maestro qui ne trouve plus
# d'appareil) donne droit à UN rejeu, après avoir attendu que l'appareil
# revienne. L'émulateur qui disparaissait en plein flux (21 octobre 2026,
# exécution 39565902966) emportait tous les flux suivants avec lui.
#
# Quand l'émulateur ne revient pas — son processus est mort (qemu en SIGSEGV,
# exécution 42821890932, 10 novembre 2026) —, attendre ne sert à rien : la
# boucle s'arrête, et écrit dans `maestro-emulateur-perdu.txt` les flux qui
# n'ont pas rendu de verdict. android-e2e.yml relève alors l'émulateur UNE fois
# et rappelle ce script, qui ne joue que ceux-là : les verdicts déjà rendus
# (`maestro-reussis.txt`, `maestro-echecs.txt`) ne se rejouent pas.
#
#   bash android/maestro-ci/lancer-les-flux.sh
#
# Lit MALICA_EMAIL et MALICA_MOT_DE_PASSE dans l'environnement.
set -u

DECONNEXION="device 'emulator-[0-9]*' not found|Missing [0-9]+ device|Not enough devices connected|could not connect to TCP port|Unable to connect to adb daemon|device offline|no devices/emulators found|UNAVAILABLE: io exception"

appareil_pret() {
  timeout 120 adb wait-for-device || return 1
  for _ in $(seq 1 60); do
    if [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; then
      return 0
    fi
    sleep 2
  done
  return 1
}

retrouver_appareil() {
  appareil_pret && return 0
  echo "L'émulateur ne répond plus : adb est relancé."
  adb kill-server || true
  adb start-server || true
  appareil_pret
}

REUSSIS="maestro-reussis.txt"
ECHECS="maestro-echecs.txt"
PERDU="maestro-emulateur-perdu.txt"
touch "$REUSSIS" "$ECHECS"
rm -f "$PERDU"

perdu=""
for flux in android/maestro/*.yaml; do
  nom=$(basename "$flux" .yaml)
  if grep -qxF "$nom" "$REUSSIS"; then
    echo "${nom} : déjà réussi avant la relève de l'émulateur."
    continue
  fi
  if grep -qxF "$nom" "$ECHECS"; then
    echo "${nom} : déjà en échec avant la relève de l'émulateur ; il n'est pas rejoué."
    continue
  fi
  # L'émulateur est perdu : ce flux n'a pas de verdict, il attend la relève.
  if [ -n "$perdu" ]; then
    echo "$nom" >> "$PERDU"
    continue
  fi
  for essai in 1 2; do
    echo "::group::${nom} (essai ${essai})"
    if ! retrouver_appareil; then
      echo "::endgroup::"
      echo "::error::${nom} : aucun émulateur joignable."
      free -m || true
      perdu="oui"
      echo "$nom" >> "$PERDU"
      break
    fi
    adb shell cmd connectivity airplane-mode disable >/dev/null 2>&1 || true
    journal="maestro-${nom}.log"
    maestro test \
      -e MALICA_EMAIL="$MALICA_EMAIL" -e MALICA_MOT_DE_PASSE="$MALICA_MOT_DE_PASSE" \
      --format junit --output "maestro-${nom}.xml" "$flux" 2>&1 | tee "$journal"
    code=${PIPESTATUS[0]}
    echo "::endgroup::"
    if [ "$code" -eq 0 ]; then
      echo "${nom} : réussi."
      echo "$nom" >> "$REUSSIS"
      break
    fi
    if grep -Eq "$DECONNEXION" "$journal"; then
      if [ "$essai" -eq 1 ]; then
        echo "::warning::${nom} : l'émulateur s'est déconnecté pendant le flux ; un seul rejeu."
        free -m || true
        continue
      fi
      # Deux déconnexions de suite : ce n'est pas un verdict sur le flux.
      echo "::error::${nom} : l'émulateur s'est déconnecté deux fois."
      perdu="oui"
      echo "$nom" >> "$PERDU"
      break
    fi
    echo "::error::${nom} : échec (code ${code})."
    echo "$nom" >> "$ECHECS"
    break
  done
done

statut=0
if [ -s "$ECHECS" ]; then
  echo "Flux en échec : $(tr '\n' ' ' < "$ECHECS")"
  statut=1
fi
if [ -n "$perdu" ]; then
  echo "Émulateur perdu ; flux sans verdict : $(tr '\n' ' ' < "$PERDU")"
  statut=1
fi
[ "$statut" -eq 0 ] && echo "Tous les flux sont passés."
exit "$statut"
