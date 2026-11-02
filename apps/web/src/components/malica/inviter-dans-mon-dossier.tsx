/**
 * Inviter quelqu'un dans son dossier — UN seul geste, depuis le 19 octobre 2026.
 *
 * ================================================================= POURQUOI
 *
 * L'écran des réglages portait TROIS invitations pour la même chose : « Qui
 * entre dans ce dossier » (dirigeant ou collaborateur), « Inviter un siège »
 * sous chaque société, et « Inviter un propriétaire ». Relevé sur l'appareil :
 * trois champs d'adresse, deux vocabulaires (« dirigeant », « propriétaire »),
 * et des chemins qui ne disaient pas la même chose sur le prix.
 *
 * Il n'en reste qu'un, dans les mots des trois rôles décidés le 19 octobre :
 *
 *   `proprietaire` — dirige la société avec le propriétaire principal, sur une
 *                    place payée, sans toucher l'abonnement ;
 *   `utilisateur`  — le quotidien, sur une place.
 *
 * Les deux passent par la porte qui compte les places et ne s'ouvre qu'au
 * propriétaire principal (`proprietaire_inviter`, `siege_inviter`) : la base
 * refuse la place de trop, l'écran montre le refus.
 *
 * ======================================================= PAS DE MOT DE PASSE
 *
 * On n'ouvre pas un compte pour quelqu'un d'autre. L'invitation nomme une
 * ADRESSE ; la personne crée son compte elle-même, et l'invitation
 * l'attend dans son portail. Son mot de passe ne passe par personne.
 *
 * ============================================ LE RÔLE SE CHOISIT EN LE LISANT
 *
 * Maquette validée du 2 novembre 2026 : chaque rôle est une carte qui dit ce
 * qu'il permet, et le prix d'une place (web et PWA seulement) est lu dans la
 * grille (`usePrixEnPlus`). Un propriétaire occupe une place au même prix
 * qu'un utilisateur : c'est un rôle donné par le propriétaire principal.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { COMMERCE } from "@/capabilities/coque";
import { usePme } from "@/components/malica/pme-context";
import { usePrix } from "@/hooks/use-decimales";
import { usePrixEnPlus } from "@/hooks/use-prix-en-plus";
import { useI18n, type MessageKey } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { office } from "@/verticals/malica-office/composition";

type Role = "utilisateur" | "proprietaire";

/*
 * Les clés de nom gardent leur nom d'origine (`dirigeant`, `collaborateur`) ;
 * leurs textes disent les rôles du 19 octobre — propriétaire, utilisateur.
 */
const ROLES: ReadonlyArray<{ role: Role; nom: MessageKey; droits: MessageKey[] }> = [
  {
    role: "utilisateur",
    nom: "pme.membres.role.collaborateur",
    droits: ["pme.inviter.utilisateur.droit1", "pme.inviter.utilisateur.droit2"],
  },
  {
    role: "proprietaire",
    nom: "pme.membres.role.dirigeant",
    droits: [
      "pme.inviter.proprietaire.droit1",
      "pme.inviter.proprietaire.droit2",
      "pme.inviter.proprietaire.droit3",
    ],
  },
];

export function InviterDansMonDossier({ occupes }: { occupes: number | null }) {
  const { t } = useI18n();
  const pme = usePme();
  const qc = useQueryClient();
  const prix = usePrix();
  const grille = usePrixEnPlus(pme.tenantId);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("utilisateur");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoyee, setEnvoyee] = useState<string | null>(null);

  const invitations = useQuery({
    queryKey: ["invitations-du-dossier", pme.tenantId],
    queryFn: () => office().collab.invitations(pme.tenantId),
  });

  const inviter = useMutation({
    mutationFn: () =>
      role === "proprietaire"
        ? office().facturation.inviterProprietaire(email.trim(), pme.tenantId)
        : office().facturation.inviterSiege(email.trim(), pme.tenantId),
    onSuccess: async (r) => {
      setErreur(null);
      setEnvoyee(r.email);
      setEmail("");
      await qc.invalidateQueries({ queryKey: ["invitations-du-dossier", pme.tenantId] });
      await qc.invalidateQueries({ queryKey: ["forfait-sieges"] });
      await qc.invalidateQueries({ queryKey: ["mon-forfait"] });
    },
    onError: (e: unknown) => {
      setEnvoyee(null);
      setErreur(texteDeLErreur(e, "components/malica/inviter-dans-mon-dossier", t("common.error")));
    },
  });

  const enAttente = (invitations.data ?? []).filter((i) => !i.acceptedAt);
  // Un prix à zéro veut dire « pas de place en plus dans cette offre » : on ne
  // l'annonce pas comme un tarif.
  const g = COMMERCE && grille.data && Number(grille.data.prix_siege_sup) > 0 ? grille.data : null;
  /*
   * Le coût n'est dit que s'il se lit entier : le prix d'une place dans la
   * grille ET le nombre de places occupées. Sinon, rien plutôt qu'un chiffre
   * deviné.
   */
  const cout =
    g && occupes !== null
      ? occupes < g.sieges_inclus
        ? t("pme.inviter.cout.compris", {
            occupes: String(occupes),
            inclus: String(g.sieges_inclus),
            prix: prix(g.prix_siege_sup),
            devise: pme.currency,
          })
        : t("pme.inviter.cout.enPlus", { prix: prix(g.prix_siege_sup), devise: pme.currency })
      : null;

  return (
    <div className="card invite">
      {/* L'explication de l'invitation et des rôles est dans le ⓘ d'« Utilisateurs ». */}
      <span className="lb" id="inviter-role">
        {t("pme.inviter.titreRole")}
      </span>
      <div role="radiogroup" aria-labelledby="inviter-role" className="roles">
        {ROLES.map((r) => (
          <button
            key={r.role}
            type="button"
            role="radio"
            aria-checked={r.role === role}
            onClick={() => setRole(r.role)}
            className="role"
          >
            <span className="hd">
              <i aria-hidden />
              <b>{t(r.nom)}</b>
              <small>
                {t(
                  COMMERCE && r.role === "proprietaire"
                    ? "pme.inviter.placeMemePrix"
                    : "pme.inviter.place",
                )}
              </small>
            </span>
            <ul>
              {r.droits.map((d) => (
                <li key={d}>{t(d)}</li>
              ))}
            </ul>
          </button>
        ))}
      </div>

      <label className="champ">
        <span className="lb">{t("pme.inviter.titreAdresse")}</span>
        <input
          type="email"
          inputMode="email"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("pme.membres.adresse")}
        />
      </label>

      {cout ? <p className="cout">{cout}</p> : null}
      <button
        type="button"
        className="btn"
        onClick={() => inviter.mutate()}
        disabled={inviter.isPending || email.trim().length === 0}
      >
        {t("pme.inviter.envoyer")}
      </button>

      {/*
       * Ce qui s'est passé, dit tout de suite. Une invitation qui part sans
       * un mot laisse croire qu'on a mal cliqué, et on la renvoie trois fois.
       */}
      {erreur ? <p className="warn">{erreur}</p> : null}
      {envoyee ? (
        <p className="ok" aria-live="polite">
          {t("pme.membres.envoyee", { email: envoyee })}
        </p>
      ) : null}

      {enAttente.length > 0 ? (
        <div className="attente">
          <span className="lb">{t("pme.inviter.enAttente")}</span>
          <ul>
            {enAttente.map((i) => (
              <li key={i.id}>
                <span className="av" aria-hidden>
                  {i.email.slice(0, 1).toUpperCase()}
                </span>
                <span className="ml">{i.email}</span>
                <span className="pill am">{t("pme.membres.attend")}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
