#!/usr/bin/env bash
# Les flux Maestro, un par un, sur l'émulateur de android-e2e.yml.
#
# Un flux qui échoue sur une ASSERTION échoue : il n'est pas rejoué. Seule
# une déconnexion de l'émulateur (adb qui le perd, Maestro qui ne trouve plus
# d'appareil) donne droit à UN rejeu, après avoir attendu que l'appareil
# revienne. L'émulateur qui disparaissait en plein flux (21 octobre 2026,
# exécution 39565902966) emportait tous les flux suivants avec lui.
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

echecs=()
for flux in android/maestro/*.yaml; do
  nom=$(basename "$flux" .yaml)
  for essai in 1 2; do
    echo "::group::${nom} (essai ${essai})"
    if ! retrouver_appareil; then
      echo "::endgroup::"
      echo "::error::${nom} : aucun émulateur joignable."
      free -m || true
      echecs+=("${nom} (émulateur perdu)")
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
      break
    fi
    if [ "$essai" -eq 1 ] && grep -Eq "$DECONNEXION" "$journal"; then
      echo "::warning::${nom} : l'émulateur s'est déconnecté pendant le flux ; un seul rejeu."
      free -m || true
      continue
    fi
    echo "::error::${nom} : échec (code ${code})."
    echecs+=("$nom")
    break
  done
done

if [ "${#echecs[@]}" -gt 0 ]; then
  echo "Flux en échec : ${echecs[*]}"
  exit 1
fi
echo "Tous les flux sont passés."
