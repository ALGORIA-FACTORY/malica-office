/**
 * « Inviter ma comptabilité » (décision du 12 novembre 2026, 7.1 et 7.2,
 * règle A5), dans la carte de la société, Réglages › Sociétés.
 *
 * Deux choix, dans le même geste :
 *
 *   Externe — l'expert-comptable reçoit un e-mail (Brevo, si configuré) et un
 *             lien que le propriétaire peut copier ; il accepte avec SA
 *             comptabilité, et le mandat devient actif. La société garde sa
 *             licence. Absent quand un mandat est déjà actif.
 *   Interne — le comptable salarié, sur la place « Comptable interne »
 *             comprise dans l'offre (7.2). Absent quand la place est prise.
 *
 * Suivi : « invitation envoyée le … · Relancer · Copier le lien ». Le jeton
 * n'est jamais gardé en clair : le lien se copie à l'émission, et « Relancer »
 * en émet un neuf. Aucun prix : rien ici ne se vend, la coque le montre aussi.
 *
 * La base décide (propriétaire seul, place de trop, mandat déjà actif) ;
 * l'écran montre le refus.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { clePlaceComptable, usePlaceComptable } from "@/hooks/use-comptable-interne";
import { useI18n } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { dateEnLettres } from "@/lib/lisible";
import { office } from "@/verticals/malica-office/composition";

type Choix = "externe" | "interne";

const cleInvitation = (tenantId: string) => ["invitation-de-ma-comptabilite", tenantId] as const;

export function InviterMaComptabilite({
  tenantId,
  aUnMandat,
}: {
  tenantId: string;
  /** Un mandat externe est actif : on n'invite pas une seconde comptabilité. */
  aUnMandat: boolean;
}) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const place = usePlaceComptable(tenantId).data;
  const derniere = useQuery({
    queryKey: cleInvitation(tenantId),
    queryFn: () => office().identity.invitationDeMaComptabilite(tenantId),
  });
  const [email, setEmail] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoyee, setEnvoyee] = useState<string | null>(null);
  /** Le lien de la dernière émission : il ne se relit pas, il se copie maintenant. */
  const [lien, setLien] = useState<string | null>(null);
  const [copie, setCopie] = useState(false);

  const interneLibre = place ? place.engagees < place.incluses : false;
  const choixOfferts: Choix[] = [
    ...(aUnMandat ? [] : (["externe"] as const)),
    ...(interneLibre ? (["interne"] as const) : []),
  ];
  const [choisi, setChoisi] = useState<Choix | null>(null);
  const choix = choisi && choixOfferts.includes(choisi) ? choisi : (choixOfferts[0] ?? null);

  const lienDe = (r: { jeton: string; lien: string | null }) =>
    r.lien ?? `${window.location.origin}/invitation#${r.jeton}`;

  const externe = useMutation({
    mutationFn: (adresse: string) => office().identity.inviterMaComptabilite(tenantId, adresse),
    onSuccess: async (r) => {
      setErreur(null);
      setEnvoyee(r.email);
      setLien(lienDe(r));
      setCopie(false);
      setEmail("");
      await qc.invalidateQueries({ queryKey: cleInvitation(tenantId) });
    },
    onError: (e: unknown) => {
      setEnvoyee(null);
      setErreur(texteDeLErreur(e, "components/malica/inviter-ma-comptabilite", t("common.error")));
    },
  });
  const interne = useMutation({
    mutationFn: () => office().facturation.inviterComptableInterne(email.trim(), tenantId),
    onSuccess: async (r) => {
      setErreur(null);
      setEnvoyee(r.email);
      setLien(null);
      setEmail("");
      await qc.invalidateQueries({ queryKey: clePlaceComptable(tenantId) });
    },
    onError: (e: unknown) => {
      setEnvoyee(null);
      setErreur(texteDeLErreur(e, "components/malica/inviter-ma-comptabilite", t("common.error")));
    },
  });

  const enAttente = derniere.data?.statut === "en_attente" ? derniere.data : null;
  const occupe = externe.isPending || interne.isPending;

  const copier = async () => {
    if (!lien) return;
    try {
      await navigator.clipboard.writeText(lien);
      setCopie(true);
    } catch {
      setCopie(false);
    }
  };

  return (
    <div className="invite">
      {enAttente && !aUnMandat ? (
        <>
          <p className="mn">
            {t("pme.inviterCompta.suivi", {
              email: enAttente.email,
              jour: dateEnLettres(enAttente.envoyeeLe.slice(0, 10), locale),
            })}
          </p>
          <button
            type="button"
            className="btn btn-sec mt-2"
            onClick={() => externe.mutate(enAttente.email)}
            disabled={occupe}
          >
            {t("pme.inviterCompta.relancer")}
          </button>
          {lien ? (
            <button type="button" className="btn btn-sec mt-2" onClick={() => void copier()}>
              {t(copie ? "pme.inviterCompta.copie" : "pme.inviterCompta.copier")}
            </button>
          ) : null}
        </>
      ) : null}

      {choix ? (
        <>
          <span className="lb" id={`inviter-compta-${tenantId}`}>
            {t("pme.inviterCompta.titre")}
          </span>
          <div role="radiogroup" aria-labelledby={`inviter-compta-${tenantId}`} className="roles">
            {choixOfferts.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={c === choix}
                onClick={() => setChoisi(c)}
                className="role"
              >
                <span className="hd">
                  <i aria-hidden />
                  <b>
                    {t(c === "externe" ? "pme.inviterCompta.externe" : "pme.inviterCompta.interne")}
                  </b>
                  <small>
                    {t(
                      c === "externe"
                        ? "pme.inviterCompta.externe.sous"
                        : "pme.comptableInterne.place",
                    )}
                  </small>
                </span>
              </button>
            ))}
          </div>
          <label className="champ">
            <span className="lb">
              {t(
                choix === "externe"
                  ? "pme.inviterCompta.externe.adresse"
                  : "pme.comptableInterne.adresse",
              )}
            </span>
            <input
              type="email"
              inputMode="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("pme.membres.adresse")}
            />
          </label>
          <button
            type="button"
            className="btn"
            onClick={() => (choix === "externe" ? externe.mutate(email.trim()) : interne.mutate())}
            disabled={occupe || email.trim().length === 0}
          >
            {t("pme.inviterCompta.envoyer")}
          </button>
        </>
      ) : null}

      {erreur ? <p className="warn">{erreur}</p> : null}
      {envoyee ? (
        <p className="ok" aria-live="polite">
          {t("pme.membres.envoyee", { email: envoyee })}
        </p>
      ) : null}
    </div>
  );
}
