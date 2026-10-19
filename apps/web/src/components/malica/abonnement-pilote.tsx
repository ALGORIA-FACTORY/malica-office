/**
 * L'abonnement piloté depuis l'application (décisions du 19 octobre 2026).
 *
 * Quatre blocs pour l'écran des réglages : le nom de la personne, le choix de
 * l'offre, les recharges, et les propriétaires. Aucun ne décide rien (R3) :
 * la grille, les empêchements, les plafonds et les refus viennent de la base,
 * l'écran les montre et transmet le geste. Les prix sont des chaînes `numeric`
 * et restent des chaînes : on n'en calcule aucun ici (R4).
 *
 * Le propriétaire principal se reconnaît à ce que la base lui rend : le prix
 * de sa licence. Un propriétaire ou un utilisateur le reçoit vide — il voit
 * alors la règle, pas les boutons.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { usePme } from "@/components/malica/pme-context";
import { useI18n, type MessageKey } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { office } from "@/verticals/malica-office/composition";
import type { OffreDeLaGrille } from "@malica/socle/ports/repositories";

const OU = "components/malica/abonnement-pilote";

/** Les clés que ces gestes rendent caduques. */
const CLES = [
  ["mon-forfait"],
  ["forfait-sieges"],
  ["forfait-organisations"],
  ["mes-offres"],
  ["mes-recharges"],
  ["recharge-automatique"],
];

function useInvalider() {
  const qc = useQueryClient();
  return async () => {
    for (const queryKey of CLES) await qc.invalidateQueries({ queryKey });
  };
}

/** Les empêchements que la base nomme, et leur phrase. Un code inconnu se tait. */
const EMPECHEMENTS: Record<string, MessageKey> = {
  deja_courant: "pme.reglages.offres.empechement.deja_courant",
  commande_speciale: "pme.reglages.offres.empechement.commande_speciale",
  sieges_occupes: "pme.reglages.offres.empechement.sieges_occupes",
  organisations: "pme.reglages.offres.empechement.organisations",
  offre_inconnue: "pme.reglages.offres.empechement.offre_inconnue",
  pas_de_licence: "pme.reglages.offres.empechement.pas_de_licence",
};

/** Un refus de la base dit en clair ; sinon le texte d'erreur commun. */
function refus(e: unknown, t: (k: MessageKey) => string): string {
  const message = e instanceof Error ? e.message : String(e ?? "");
  const forfait = /forfait_refuse:([a-z_]+)/.exec(message);
  if (forfait && EMPECHEMENTS[forfait[1]!]) return t(EMPECHEMENTS[forfait[1]!]!);
  if (/offre_sans_recharge/.test(message)) return t("pme.reglages.recharges.verrou");
  return texteDeLErreur(e, OU, t("common.error"));
}

function nomDeLOffre(code: string): string {
  return code.charAt(0).toUpperCase() + code.slice(1);
}

/** Le propriétaire principal : celui à qui la base rend le prix de la licence. */
function useEstPrincipal(): boolean {
  const pme = usePme();
  return Boolean(pme.forfait.ligne && pme.forfait.ligne.prix_mensuel_ht !== null);
}

/* ------------------------------------------------------------------ le nom */

export function MonNom() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const profil = useQuery({
    queryKey: ["mon-profil"],
    queryFn: () => office().identity.monProfil(),
  });
  const [prenom, setPrenom] = useState("");
  const [nom, setNom] = useState("");
  const [retour, setRetour] = useState<string | null>(null);

  useEffect(() => {
    if (profil.data) {
      setPrenom(profil.data.prenom ?? "");
      setNom(profil.data.nom ?? "");
    }
  }, [profil.data]);

  const ecrire = useMutation({
    mutationFn: () => office().identity.ecrireMonProfil(prenom, nom),
    onSuccess: async () => {
      setRetour(t("pme.reglages.profil.enregistre"));
      await qc.invalidateQueries({ queryKey: ["mon-profil"] });
    },
    onError: (e: unknown) => setRetour(refus(e, t)),
  });

  const champ = "h-[46px] min-w-0 flex-1 border border-line-strong bg-transparent px-3 text-[14px]";
  return (
    <div className="card">
      <p className="t-body">{t("pme.reglages.profil.aide")}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          value={prenom}
          onChange={(e) => setPrenom(e.target.value)}
          placeholder={t("pme.reglages.profil.prenom")}
          aria-label={t("pme.reglages.profil.prenom")}
          autoComplete="given-name"
          className={champ}
        />
        <input
          value={nom}
          onChange={(e) => setNom(e.target.value)}
          placeholder={t("pme.reglages.profil.nom")}
          aria-label={t("pme.reglages.profil.nom")}
          autoComplete="family-name"
          className={champ}
        />
        <button
          type="button"
          className="btn"
          style={{ width: "auto" }}
          disabled={ecrire.isPending}
          onClick={() => ecrire.mutate()}
        >
          {t("pme.reglages.profil.enregistrer")}
        </button>
      </div>
      {retour ? (
        <p className="t-body" aria-live="polite">
          {retour}
        </p>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- l'offre */

export function ChangerDOffre() {
  const { t, locale } = useI18n();
  const pme = usePme();
  const invalider = useInvalider();
  const principal = useEstPrincipal();
  const offres = useQuery({
    queryKey: ["mes-offres", pme.tenantId],
    queryFn: () => office().facturation.mesOffres(pme.tenantId),
    enabled: principal,
    retry: false,
  });
  const [armee, setArmee] = useState<string | null>(null);
  const [retour, setRetour] = useState<string | null>(null);

  const changer = useMutation({
    mutationFn: (code: string) => office().facturation.changerForfait(code, pme.tenantId),
    onSuccess: async (_r, code) => {
      setArmee(null);
      setRetour(t("pme.reglages.offres.fait", { offre: nomDeLOffre(code) }));
      await invalider();
    },
    onError: (e: unknown) => {
      setArmee(null);
      setRetour(refus(e, t));
    },
  });

  if (!principal) {
    return (
      <div className="card">
        <p className="t-body">{t("pme.reglages.offres.principalSeul")}</p>
      </div>
    );
  }

  const entier = (n: number) => new Intl.NumberFormat(locale).format(n);
  const ligne = (o: OffreDeLaGrille) =>
    [
      t("pme.reglages.offres.prix", { prix: o.prix_mensuel_ht, devise: pme.currency }),
      t("pme.reglages.offres.lectures", { n: entier(o.lectures_par_organisation) }),
      o.sieges_inclus > 0
        ? t("pme.reglages.offres.places", { count: o.sieges_inclus })
        : t("pme.reglages.offres.seul"),
      t("pme.reglages.offres.societes", { count: o.organisations_incluses }),
    ].join(" · ");

  return (
    <div className="rows">
      {(offres.data ?? []).map((o) => {
        const bloque = o.empechement ? EMPECHEMENTS[o.empechement] : undefined;
        return (
          <div key={o.code} className="card" data-offre={o.code} data-courant={o.courant}>
            <div className="nm">
              <b>{o.libelle}</b>
              <span className="px">
                {t("pme.reglages.offres.incluses", { n: entier(o.lectures_incluses) })}
              </span>
            </div>
            <p className="t-body">{ligne(o)}</p>
            {o.empechement ? (
              <p className="t-body">{bloque ? t(bloque) : null}</p>
            ) : (
              <button
                type="button"
                className="btn"
                disabled={changer.isPending}
                onClick={() =>
                  armee === o.code ? changer.mutate(o.code) : (setArmee(o.code), setRetour(null))
                }
              >
                {armee === o.code
                  ? t("pme.reglages.offres.confirmer", { offre: o.libelle })
                  : t("pme.reglages.offres.passer", { offre: o.libelle })}
              </button>
            )}
          </div>
        );
      })}
      {offres.error ? <p className="warn">{refus(offres.error, t)}</p> : null}
      {retour ? (
        <p className="t-body" aria-live="polite">
          {retour}
        </p>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------- les recharges */

export function MesRecharges() {
  const { t, locale } = useI18n();
  const pme = usePme();
  const invalider = useInvalider();
  const principal = useEstPrincipal();
  const paliers = useQuery({
    queryKey: ["paliers-de-recharge"],
    queryFn: () => office().facturation.paliersDeRecharge(),
    enabled: principal,
  });
  const miennes = useQuery({
    queryKey: ["mes-recharges"],
    queryFn: () => office().facturation.mesRecharges(),
    enabled: principal,
    retry: false,
  });
  const auto = useQuery({
    queryKey: ["recharge-automatique"],
    queryFn: () => office().facturation.maRechargeAutomatique(),
    enabled: principal,
    retry: false,
  });
  const [retour, setRetour] = useState<string | null>(null);
  const [palierAuto, setPalierAuto] = useState("");
  const [plafond, setPlafond] = useState("");

  useEffect(() => {
    if (auto.data?.active) {
      setPalierAuto(auto.data.recharge_code ?? "");
      setPlafond(auto.data.plafond_mois_ht ?? "");
    }
  }, [auto.data]);

  const acheter = useMutation({
    mutationFn: (code: string) => office().facturation.acheterRecharge(code, pme.tenantId),
    onSuccess: async () => {
      setRetour(t("pme.reglages.recharges.achetee"));
      await invalider();
    },
    onError: (e: unknown) => setRetour(refus(e, t)),
  });

  const regler = useMutation({
    mutationFn: (active: boolean) =>
      office().facturation.reglerRechargeAutomatique(
        active,
        active ? palierAuto : null,
        active ? plafond.replace(",", ".") : null,
        pme.tenantId,
      ),
    onSuccess: async () => {
      setRetour(null);
      await invalider();
    },
    onError: (e: unknown) => setRetour(refus(e, t)),
  });

  if (!principal) return null;

  const offre = pme.forfait.ligne?.offre ?? null;
  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
      new Date(`${iso.slice(0, 10)}T00:00:00Z`),
    );
  const liste = [...(paliers.data ?? [])].sort((a, b) => a.rang - b.rang);
  const libelleDu = (code: string | null) =>
    liste.find((p) => p.code === code)
      ? t("pme.reglages.recharges.palier", { n: liste.find((p) => p.code === code)!.lectures })
      : (code ?? "");
  const champ = "h-[46px] min-w-0 flex-1 border border-line-strong bg-transparent px-3 text-[14px]";

  // Le Basic n'en prend pas : la carte reste visible, verrouillée, et dit dès quand.
  if (offre === "basic") {
    return (
      <div className="inv off" data-verrou="Solo">
        <span className="bd">
          <b>{t("pme.reglages.recharges")}</b>
          <span>{t("pme.reglages.recharges.verrou")}</span>
        </span>
      </div>
    );
  }

  return (
    <>
      <div className="rows">
        {liste.map((p) => (
          <div key={p.code} className="card" data-palier={p.code}>
            <div className="nm">
              <b>{t("pme.reglages.recharges.palier", { n: p.lectures })}</b>
              <span className="px">
                {t("pme.reglages.recharges.prix", { prix: p.prix_ht, devise: pme.currency })}
              </span>
            </div>
            <button
              type="button"
              className="btn"
              disabled={acheter.isPending}
              onClick={() => acheter.mutate(p.code)}
            >
              {t("pme.reglages.recharges.acheter")}
            </button>
          </div>
        ))}
      </div>

      <div className="card">
        <b>{t("pme.reglages.recharges.miennes")}</b>
        {(miennes.data ?? []).length === 0 ? (
          <p className="t-body">{t("pme.reglages.recharges.aucune")}</p>
        ) : (
          (miennes.data ?? []).map((r) => (
            <p key={r.recharge_id} className="t-body" data-recharge={r.recharge_id}>
              {t("pme.reglages.recharges.reste", {
                restantes: r.restantes,
                lectures: r.lectures,
                date: date(r.expire_le),
              })}
              {r.gelee ? ` — ${t("pme.reglages.recharges.gelee")}` : ""}
              {r.expiree ? ` — ${t("pme.reglages.recharges.expiree")}` : ""}
            </p>
          ))
        )}
      </div>

      <div className="card">
        <b>{t("pme.reglages.recharges.auto")}</b>
        <p className="t-body">{t("pme.reglages.recharges.auto.sous")}</p>
        <p className="t-body">
          {auto.data?.active
            ? t("pme.reglages.recharges.auto.active", {
                palier: libelleDu(auto.data.recharge_code),
                plafond: auto.data.plafond_mois_ht ?? "",
                devise: pme.currency,
              })
            : t("pme.reglages.recharges.auto.inactive")}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <select
            value={palierAuto}
            onChange={(e) => setPalierAuto(e.target.value)}
            aria-label={t("pme.reglages.recharges.auto.palier")}
            className={champ}
          >
            <option value="">{t("pme.reglages.recharges.auto.palier")}</option>
            {liste.map((p) => (
              <option key={p.code} value={p.code}>
                {t("pme.reglages.recharges.palier", { n: p.lectures })} —{" "}
                {t("pme.reglages.recharges.prix", { prix: p.prix_ht, devise: pme.currency })}
              </option>
            ))}
          </select>
          <input
            inputMode="decimal"
            value={plafond}
            onChange={(e) => setPlafond(e.target.value)}
            placeholder={t("pme.reglages.recharges.auto.plafond")}
            aria-label={t("pme.reglages.recharges.auto.plafond")}
            className={champ}
          />
          <button
            type="button"
            className="btn"
            style={{ width: "auto" }}
            disabled={regler.isPending || palierAuto === "" || plafond.trim() === ""}
            onClick={() => regler.mutate(true)}
          >
            {t("pme.reglages.recharges.auto.activer")}
          </button>
          {auto.data?.active ? (
            <button
              type="button"
              className="btn"
              style={{ width: "auto" }}
              disabled={regler.isPending}
              onClick={() => regler.mutate(false)}
            >
              {t("pme.reglages.recharges.auto.arreter")}
            </button>
          ) : null}
        </div>
      </div>
      {retour ? (
        <p className="t-body" aria-live="polite">
          {retour}
        </p>
      ) : null}
    </>
  );
}

/* --------------------------------------------------------- les propriétaires */

export function MesProprietaires() {
  const { t } = useI18n();
  const pme = usePme();
  const invalider = useInvalider();
  const principal = useEstPrincipal();
  const compte = useQuery({ queryKey: ["compte"], queryFn: () => office().auth.session() });
  const sieges = useQuery({
    queryKey: ["forfait-sieges", pme.tenantId],
    queryFn: () => office().facturation.sieges(),
    enabled: principal,
    retry: false,
  });
  const [email, setEmail] = useState("");
  const [armee, setArmee] = useState<string | null>(null);
  const [retour, setRetour] = useState<string | null>(null);

  const inviter = useMutation({
    mutationFn: () => office().facturation.inviterProprietaire(email.trim(), pme.tenantId),
    onSuccess: async (r) => {
      setRetour(t("pme.reglages.proprietaires.invite", { email: r.email }));
      setEmail("");
      await invalider();
    },
    onError: (e: unknown) => setRetour(refus(e, t)),
  });

  const transmettre = useMutation({
    mutationFn: (p: { id: string; nom: string }) =>
      office().facturation.transmettreLicence(pme.tenantId, p.id),
    onSuccess: async (_r, p) => {
      setArmee(null);
      setRetour(t("pme.reglages.proprietaires.transmis", { nom: p.nom }));
      await invalider();
    },
    onError: (e: unknown) => {
      setArmee(null);
      setRetour(refus(e, t));
    },
  });

  if (!principal) return null;

  const moi = compte.data?.id ?? null;
  const autres = (sieges.data ?? []).filter(
    (s) => s.role === "dirigeant" && s.tenant_id === pme.tenantId && s.user_id !== moi,
  );

  return (
    <>
      <div className="card">
        <p className="t-body">{t("pme.reglages.proprietaires.email")}</p>
        <div className="mt-2 flex gap-2">
          <input
            type="email"
            inputMode="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-label={t("pme.reglages.proprietaires.email")}
            className="h-[46px] min-w-0 flex-1 border border-line-strong bg-transparent px-3 text-[14px]"
          />
          <button
            type="button"
            className="btn"
            style={{ width: "auto" }}
            disabled={inviter.isPending || email.trim() === ""}
            onClick={() => inviter.mutate()}
          >
            {t("pme.reglages.proprietaires.inviter")}
          </button>
        </div>
      </div>

      <div className="card">
        <b>{t("pme.reglages.proprietaires.transmettre")}</b>
        <p className="t-body">{t("pme.reglages.proprietaires.transmettre.sous")}</p>
        {autres.length === 0 ? (
          <p className="t-body">{t("pme.reglages.proprietaires.aucun")}</p>
        ) : (
          autres.map((s) => {
            const nom = s.nom ?? s.user_id;
            return (
              <button
                key={s.user_id}
                type="button"
                className="btn mt-2"
                disabled={transmettre.isPending}
                onClick={() =>
                  armee === s.user_id
                    ? transmettre.mutate({ id: s.user_id, nom })
                    : (setArmee(s.user_id), setRetour(null))
                }
              >
                {armee === s.user_id
                  ? t("pme.reglages.proprietaires.transmettre.confirmer", { nom })
                  : t("pme.reglages.proprietaires.transmettre.a", { nom })}
              </button>
            );
          })
        )}
      </div>
      {retour ? (
        <p className="t-body" aria-live="polite">
          {retour}
        </p>
      ) : null}
    </>
  );
}
