/**
 * Les photos de profil de quelques personnes — pour les pastilles des sièges.
 *
 * Deux temps, comme le reste : la base dit QUI a une photo et sa version
 * (`identite.photosDesProfils`, sous la RLS : une personne que la base ne
 * montre pas n'a pas de photo pour moi), puis chaque photo se lit une fois par
 * version. La version est dans la clé : une photo changée se recharge, une
 * photo inchangée ne se relit jamais. Les octets restent dans le cache de
 * l'application, vidé à la déconnexion — jamais dans un cache HTTP qui servirait
 * le visage de quelqu'un à qui s'asseoit après lui.
 */
import { useQueries, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import { lirePhoto } from "@/lib/photo-de-profil";
import { office } from "@/verticals/malica-office/composition";

/** Identifiant → adresse `blob:` de sa photo, pour qui en a une. */
export function usePhotosDeProfil(ids: readonly string[]): Record<string, string> {
  const cle = [...new Set(ids)].sort();
  const versions = useQuery({
    queryKey: ["photos-de-profil", cle],
    queryFn: () => office().identity.photosDesProfils(cle),
    enabled: cle.length > 0,
    staleTime: 5 * 60_000,
  });
  const avec = Object.entries(versions.data ?? {});
  const octets = useQueries({
    queries: avec.map(([id, version]) => ({
      queryKey: ["photo-de-profil", id, version],
      queryFn: () => lirePhoto(id),
      staleTime: Infinity,
      gcTime: 30 * 60_000,
    })),
  });

  // Un `blob:` par photo lue ; rendu à la mémoire quand la liste change.
  const lues = octets.map((o) => o.data ?? null);
  const signature = avec.map(([id, v], i) => `${id}:${v}:${lues[i] ? 1 : 0}`).join("|");
  const adresses = useMemo(() => {
    const r: Record<string, string> = {};
    avec.forEach(([id], i) => {
      const blob = lues[i];
      if (blob) r[id] = URL.createObjectURL(blob);
    });
    return r;
    // La signature résume ce dont dépendent `avec` et `lues`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  useEffect(
    () => () => {
      for (const a of Object.values(adresses)) URL.revokeObjectURL(a);
    },
    [adresses],
  );
  return adresses;
}
