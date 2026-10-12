import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";

import { files } from "@/capabilities/files";
import { useSuperposition } from "@/hooks/use-superposition";
import { MalicaAvatar } from "@/components/malica/office-ui";
import { usePme } from "@/components/malica/pme-context";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { office } from "@/verticals/malica-office/composition";
import type { RegimeDisponible } from "@malica/socle/ports/repositories";

const CameraScanner = lazy(() =>
  import("@/components/malica/CameraScanner").then((m) => ({ default: m.CameraScanner })),
);

export const Route = createFileRoute("/_authenticated/pme/fiche")({
  head: () => ({
    meta: [
      { title: "Votre situation fiscale — Malica Office" },
      {
        name: "description",
        content:
          "Le régime, l'assujettissement à la TVA et l'exercice du dossier, lus sur la carte d'identification fiscale et confirmés par vous.",
      },
      { property: "og:title", content: "Votre situation fiscale — Malica Office" },
      {
        property: "og:description",
        content: "Photographiez votre carte : je lis, vous confirmez.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: FicheFiscale,
});

const OU = "routes/_authenticated/pme.fiche";

/**
 * La situation fiscale du dossier — lue sur la carte, arrêtée par la personne.
 *
 * ============================================================ POURQUOI CET ÉCRAN
 *
 * Sans lui, Malica ignore si le dossier est assujetti à la TVA et s'il relève
 * du réel. Elle ne peut donc ni qualifier une opération, ni répondre sur une
 * déduction — ses deux issues seraient de supposer en silence, ou d'interroger
 * le client à chaque question.
 *
 * ============================================================ POURQUOI LA CARTE
 *
 * Le référentiel fiscal porte ceci : « Condition d'application du taux 3 % aux
 * personnes physiques : présentation de la CARTE D'IDENTIFICATION FISCALE
 * régime réel » — Article 52-I-a. Le droit tunisien désigne lui-même cette
 * carte comme la preuve du régime. La lire est plus sûr que de la demander :
 * un dirigeant se trompe sur son régime, la carte non.
 *
 * ====================================================== ELLE LIT, VOUS ARRÊTEZ
 *
 * La lecture REMPLIT le formulaire, elle ne l'enregistre pas. Tout reste
 * modifiable, et ce qu'elle n'a pas su lire reste vide au lieu d'être deviné.
 * C'est R10 : Malica propose, l'expert arrête le paramétrage.
 */
function FicheFiscale() {
  const { t, locale } = useI18n();
  const pme = usePme();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [scanne, setScanne] = useState(false);
  useSuperposition(
    scanne,
    useCallback(() => setScanne(false), []),
  );
  const [erreur, setErreur] = useState<string | null>(null);
  const [luDeLaCarte, setLuDeLaCarte] = useState<Set<string>>(new Set());

  const [regimeImposition, setRegimeImposition] = useState("");
  const [regimeTva, setRegimeTva] = useState("");
  const [prorata, setProrata] = useState("");
  const [secteur, setSecteur] = useState("");
  const [debut, setDebut] = useState("");
  const [cloture, setCloture] = useState("");
  const [forme, setForme] = useState("");
  const [mode, setMode] = useState("");

  const regimes = useQuery({
    queryKey: ["regimes", pme.jurisdiction],
    queryFn: () => office().identity.regimesDisponibles(pme.jurisdiction),
  });
  const formes = useQuery({
    queryKey: ["formes", pme.jurisdiction],
    queryFn: () => office().identity.formesDisponibles(pme.jurisdiction),
  });
  // Les codes viennent du référentiel ; leur libellé, du dictionnaire.
  const choixDe = (axe: "forme" | "mode") =>
    (formes.data ?? [])
      .filter((f) => f.axe === axe)
      .map((f) => ({ code: f.code, libelle: libelleDuChoix(axe, f.code, t) }));

  const courante = useQuery({
    queryKey: ["fiche", pme.tenantId],
    queryFn: () => office().identity.ficheCourante(pme.tenantId),
  });

  const parAxe = (axe: RegimeDisponible["axe"]) =>
    (regimes.data ?? []).filter((r) => r.axe === axe);

  /*
   * La fiche en place remplit le formulaire.
   *
   * Sans cela, un expert qui revient sur cet écran voit des champs vides
   * alors qu'une situation EST établie — et l'enregistrer effacerait ce qui y
   * était, puisque la nouvelle fiche clôture l'ancienne. On modifie ce qui
   * existe, on ne repart pas de zéro.
   *
   * Une seule fois : la garde empêche d'écraser ce que la personne vient de
   * saisir à chaque nouvelle réponse du serveur.
   */
  const [seme, setSeme] = useState(false);
  useEffect(() => {
    const f = courante.data;
    if (!f || seme) return;
    setRegimeImposition(f.regimeImposition ?? "");
    setRegimeTva(f.regimeTva ?? "");
    setProrata(f.prorataTva ?? "");
    setSecteur(f.secteur ?? "");
    setDebut(f.debutActivite ?? "");
    setCloture(f.clotureExercice ?? "");
    setForme(f.formeJuridique ?? "");
    setMode(f.modeDepot ?? "");
    setSeme(true);
  }, [courante.data, seme]);

  /** Une image, lue par l'œil, qui remplit le formulaire sans rien décider. */
  const lecture = useMutation({
    // Les octets partent tels quels : l'œil les reçoit par leur propre route,
    // sans passer par une adresse de données de plusieurs mégaoctets.
    mutationFn: (blob: Blob) =>
      office().malica.lireCarte({ jurisdiction: pme.jurisdiction, fichier: blob }),
    onSuccess: (res) => {
      setErreur(null);
      const c = res.carte;
      const lus = new Set<string>();
      // On ne remplit QUE ce qui a été lu. Un champ absent reste vide : c'est
      // une information, pas un trou à combler.
      if (c.regime_imposition) {
        setRegimeImposition(c.regime_imposition);
        lus.add("regime_imposition");
      }
      if (c.regime_tva) {
        setRegimeTva(c.regime_tva);
        lus.add("regime_tva");
      }
      if (c.activite) {
        setSecteur(c.activite);
        lus.add("secteur");
      }
      if (c.debut_activite) {
        setDebut(c.debut_activite);
        lus.add("debut_activite");
      }
      setLuDeLaCarte(lus);
    },
    onError: (e: unknown) => setErreur(texteDeLErreur(e, OU, t("common.error"))),
  });

  const enregistrement = useMutation({
    mutationFn: () =>
      office().identity.etablirFiche({
        tenantId: pme.tenantId,
        regimeImposition: regimeImposition || null,
        regimeTva: regimeTva || null,
        prorataTva: regimeTva === "partiel" && prorata ? Number(prorata) : null,
        secteur: secteur.trim() || null,
        debutActivite: debut || null,
        clotureExercice: cloture || null,
        formeJuridique: forme || null,
        modeDepot: mode || null,
        // La source dit d'où vient la fiche, et elle ne ment pas : « carte »
        // seulement si l'œil a réellement rempli quelque chose.
        source: luDeLaCarte.size > 0 ? ("carte" as const) : ("saisie" as const),
        validFrom: new Date().toISOString().slice(0, 10),
      }),
    onSuccess: async () => {
      setErreur(null);
      await qc.invalidateQueries({ queryKey: ["fiche", pme.tenantId] });
      void navigate({ to: "/pme" });
    },
    onError: (e: unknown) => setErreur(texteDeLErreur(e, OU, t("common.error"))),
  });

  const rien =
    !regimeImposition && !regimeTva && !secteur.trim() && !debut && !cloture && !forme && !mode;
  // Les listes et la fiche viennent de la base ; si elle ne répond pas, on le dit.
  const echecLecture = regimes.error ?? formes.error ?? courante.error ?? null;
  const dateLisible = (iso: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(iso)
      ? new Intl.DateTimeFormat(locale, {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          timeZone: "UTC",
        }).format(new Date(`${iso}T00:00:00Z`))
      : iso;

  return (
    <div className="rg-rise flex min-h-0 flex-col px-1 pt-1">
      <p className="text-[22px] font-semibold leading-[1.15] tracking-[-0.025em]">
        {t("fiche.titre")}
      </p>
      {/*
       * Une ligne, pas trois.
       *
       * Quand une situation existe déjà, c'est CELA qu'il faut dire — le
       * formulaire la modifie, il ne repart pas de zéro. Le reste du temps, on
       * explique à quoi sert l'écran. Jamais les deux : cet écran doit tenir
       * en une page comme tous les autres.
       */}
      <p className="mt-[3px] text-[12.5px] leading-[1.45] text-text-2">
        {courante.data
          ? t("fiche.dejaEtablie", { depuis: dateLisible(courante.data.validFrom) })
          : t("fiche.sous")}
      </p>

      {/* ------------------------------------------------- lire la carte */}
      <div className="mt-3 flex gap-2.5">
        <MalicaAvatar size={28} alt="Malica" rond />
        <p className="text-[13px] leading-[1.45] text-text-2">{t("fiche.voix")}</p>
      </div>

      <button
        type="button"
        onClick={() => setScanne(true)}
        disabled={lecture.isPending}
        className="mt-2.5 h-11 w-full flex-none bg-foreground text-[14px] font-semibold text-background disabled:opacity-60"
      >
        {lecture.isPending ? t("fiche.lecture") : t("fiche.photographier")}
      </button>

      {luDeLaCarte.size > 0 ? (
        <p className="mt-2 text-[12px] leading-[1.5] text-signal-ok">
          {t("fiche.lu", { count: luDeLaCarte.size })}
        </p>
      ) : null}

      {erreur || echecLecture ? (
        <p
          role="alert"
          className="mt-3 border border-s-2 border-border border-s-signal-stop px-3 py-2 text-[12.5px]"
        >
          {erreur ?? texteDeLErreur(echecLecture, OU, t("common.error"))}
        </p>
      ) : null}

      {/* ------------------------------------------------------ le formulaire */}
      <div className="mt-3 space-y-2.5">
        <Choix
          label={t("fiche.champ.imposition")}
          options={parAxe("imposition")}
          valeur={regimeImposition}
          onChange={setRegimeImposition}
          lu={luDeLaCarte.has("regime_imposition")}
          vide={t("fiche.nonRenseigne")}
        />

        <Choix
          label={t("fiche.champ.tva")}
          options={parAxe("tva")}
          valeur={regimeTva}
          onChange={(v) => {
            setRegimeTva(v);
            if (v !== "partiel") setProrata("");
          }}
          lu={luDeLaCarte.has("regime_tva")}
          vide={t("fiche.nonRenseigne")}
        />

        {/* Le prorata n'existe que pour un assujetti partiel : la base le
            refuse ailleurs, l'écran ne le propose donc pas ailleurs. */}
        {regimeTva === "partiel" ? (
          <Saisie
            label={t("fiche.champ.prorata")}
            valeur={prorata}
            onChange={setProrata}
            type="number"
            aide={t("fiche.aide.prorata")}
          />
        ) : null}

        <Saisie
          label={t("fiche.champ.secteur")}
          valeur={secteur}
          onChange={setSecteur}
          lu={luDeLaCarte.has("secteur")}
        />

        {/* La forme et le mode de dépôt décident des délais : sans les deux,
            Malica ne dérive aucune échéance — et le dit. */}
        <div className="grid grid-cols-2 gap-2.5">
          <Choix
            label={t("fiche.champ.forme")}
            options={choixDe("forme")}
            valeur={forme}
            onChange={setForme}
            vide={t("fiche.nonRenseigne")}
          />
          <Choix
            label={t("fiche.champ.mode")}
            options={choixDe("mode")}
            valeur={mode}
            onChange={setMode}
            vide={t("fiche.nonRenseigne")}
          />
        </div>
        <p className="text-[11px] leading-[1.4] text-muted-foreground">{t("fiche.aide.forme")}</p>

        {/* Deux dates courtes : elles tiennent sur une ligne, et la page y gagne. */}
        <div className="grid grid-cols-2 gap-2.5">
          <Saisie
            label={t("fiche.champ.debut")}
            valeur={debut}
            onChange={setDebut}
            type="date"
            lu={luDeLaCarte.has("debut_activite")}
          />
          <Saisie
            label={t("fiche.champ.cloture")}
            valeur={cloture}
            onChange={setCloture}
            aide={t("fiche.aide.cloture")}
          />
        </div>
      </div>

      <button
        type="button"
        disabled={rien || enregistrement.isPending}
        onClick={() => enregistrement.mutate()}
        className="mt-3 h-11 w-full flex-none border border-line-strong text-[14px] font-semibold disabled:opacity-40"
      >
        {t("fiche.enregistrer")}
      </button>
      <p className="mt-1.5 pb-1 text-[11px] leading-[1.4] text-muted-foreground">
        {t("fiche.promesse")}
      </p>

      {scanne ? (
        <Suspense fallback={null}>
          <CameraScanner
            onCancel={() => setScanne(false)}
            /*
             * Le repli DOIT photographier.
             *
             * Il fermait seulement l'obturateur : sur un téléphone en HTTP — là
             * où le cadrage assisté est refusé et où ce bouton est justement le
             * seul chemin — on tapait dans le vide.
             *
             * L'appareil photo natif donne la même image, et la lecture qui suit
             * est identique.
             */
            onFallback={() => {
              setScanne(false);
              void files.takePhoto().then(([pris]) => {
                // Une carte tient sur une face : une photo, la première.
                if (pris) lecture.mutate(pris.blob);
              });
            }}
            onDone={(pages) => {
              setScanne(false);
              // Une carte tient sur une face : on lit la première prise.
              if (pages[0]) lecture.mutate(pages[0]);
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

/** Le libellé d'un code du référentiel, dans la langue de la personne. */
function libelleDuChoix(axe: "forme" | "mode", code: string, t: (k: MessageKey) => string) {
  const CLES: Record<string, MessageKey> = {
    "forme.physique": "fiche.forme.physique",
    "forme.morale": "fiche.forme.morale",
    "mode.papier": "fiche.mode.papier",
    "mode.electronique": "fiche.mode.electronique",
  };
  const cle = CLES[`${axe}.${code}`];
  return cle ? t(cle) : code;
}

/** Un choix parmi ce que le référentiel porte — jamais une liste écrite ici. */
function Choix({
  label,
  options,
  valeur,
  onChange,
  lu,
  vide,
}: {
  label: string;
  options: ReadonlyArray<{ code: string; libelle: string }>;
  valeur: string;
  onChange: (v: string) => void;
  lu?: boolean;
  vide: string;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </span>
        {lu ? <MarqueLue /> : null}
      </span>
      <select
        value={valeur}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 h-10 w-full border border-border bg-transparent px-2 text-[14px] focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <option value="">{vide}</option>
        {options.map((o) => (
          <option key={o.code} value={o.code}>
            {o.libelle}
          </option>
        ))}
      </select>
    </label>
  );
}

function Saisie({
  label,
  valeur,
  onChange,
  type,
  aide,
  lu,
}: {
  label: string;
  valeur: string;
  onChange: (v: string) => void;
  type?: string;
  aide?: string;
  lu?: boolean;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </span>
        {lu ? <MarqueLue /> : null}
      </span>
      <input
        value={valeur}
        onChange={(e) => onChange(e.target.value)}
        type={type ?? "text"}
        className={cn(
          "mt-1 h-10 w-full border border-border bg-transparent px-2 text-[14px]",
          "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        )}
      />
      {aide ? <span className="mt-0.5 block text-[11px] text-muted-foreground">{aide}</span> : null}
    </label>
  );
}

/**
 * Ce que la carte a donné.
 *
 * La marque n'est pas décorative : elle dit à l'expert ce qu'il relit et ce
 * qu'il a saisi lui-même. Sans elle, une valeur lue de travers se confondrait
 * avec une valeur qu'il a validée.
 */
function MarqueLue() {
  const { t } = useI18n();
  return (
    <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-marigold">
      {t("fiche.marqueLue")}
    </span>
  );
}
