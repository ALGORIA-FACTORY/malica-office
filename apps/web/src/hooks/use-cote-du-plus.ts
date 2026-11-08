/**
 * Le côté du bouton « + » — planche 5, approuvée le 7 novembre 2026.
 *
 * « Pour un gaucher qui tient son téléphone d'une main, le + à droite est
 * hors de portée du pouce. » Le côté se règle : à droite (par défaut, comme
 * avant) ou à gauche. C'est le côté PHYSIQUE, sous le pouce : le même en
 * arabe (décision du 1er novembre 2026, « à droite aussi en arabe »).
 *
 * Il suit le compte (`identity.profiles.cote_du_plus`), lu sous la même clé
 * que « Mon nom » (`["mon-profil"]`) : une seule requête. L'appareil en garde
 * une copie pour que la barre du bas s'affiche du bon côté dès la première
 * image, avant la réponse du serveur.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type { CoteDuPlus, MonProfil } from "@malica/socle/ports/repositories";

import { office } from "@/verticals/malica-office/composition";

const CLE = "malica.cote-du-plus";

function copieDeLAppareil(): CoteDuPlus {
  try {
    return window.localStorage.getItem(CLE) === "gauche" ? "gauche" : "droite";
  } catch {
    return "droite";
  }
}

function garderSurLAppareil(cote: CoteDuPlus) {
  try {
    window.localStorage.setItem(CLE, cote);
  } catch {
    /* stockage refusé : le serveur reste la référence */
  }
}

export function useCoteDuPlus() {
  const qc = useQueryClient();
  // Au premier rendu (SSR compris) : à droite ; la copie de l'appareil suit aussitôt.
  const [local, setLocal] = useState<CoteDuPlus>("droite");
  useEffect(() => setLocal(copieDeLAppareil()), []);

  const profil = useQuery({
    queryKey: ["mon-profil"],
    queryFn: () => office().identity.monProfil(),
    staleTime: 5 * 60_000,
  });
  const duCompte = profil.data?.cote_du_plus;
  useEffect(() => {
    if (duCompte === "gauche" || duCompte === "droite") {
      garderSurLAppareil(duCompte);
      setLocal(duCompte);
    }
  }, [duCompte]);

  const ecrire = useMutation({
    mutationFn: (cote: CoteDuPlus) => office().identity.ecrireCoteDuPlus(cote),
    onMutate: (cote) => {
      const avant = qc.getQueryData<MonProfil | null>(["mon-profil"]);
      garderSurLAppareil(cote);
      setLocal(cote);
      if (avant) qc.setQueryData<MonProfil>(["mon-profil"], { ...avant, cote_du_plus: cote });
      return { avant };
    },
    onError: (_e, _cote, ctx) => {
      const avant = ctx?.avant?.cote_du_plus ?? "droite";
      garderSurLAppareil(avant);
      setLocal(avant);
      if (ctx?.avant) qc.setQueryData(["mon-profil"], ctx.avant);
    },
  });

  return { cote: local, choisir: (cote: CoteDuPlus) => ecrire.mutate(cote) };
}
