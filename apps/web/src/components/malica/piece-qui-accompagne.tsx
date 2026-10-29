/**
 * La fiche d'une pièce qui en ACCOMPAGNE une autre — le reçu que Malica
 * produit, la photo qui prouve un règlement.
 *
 * ================================================================= POURQUOI
 *
 * Maquette « Reçus et justificatifs d'une pièce », validée par Wissem le
 * 25 octobre 2026. Ces pièces tombaient dans l'écran d'une pièce « pas encore
 * lue » : un « Lire la pièce » mort — la base refuse de les lire —, et un
 * « Supprimer et reprendre la photo » qui mélangeait deux gestes, y compris
 * sur un reçu qu'on ne photographie jamais.
 *
 * L'écran dit, dans l'ordre : ce qu'elle vaut, en une phrase ; à quoi elle
 * est rattachée, toujours ouvrable ; le document tel qu'il est ; puis les
 * gestes, chacun seul, chacun avec sa feuille.
 *
 * ================================================================= QUI DÉCIDE
 *
 * La base (`capture.pieceQuiAccompagne`) : le genre, la pièce mère, ce que la
 * pièce atteste ou prouve, si elle compte encore, et où un justificatif peut
 * aller. `lib/piece-qui-accompagne` choisit les mots et les gestes. Ce fichier
 * dessine.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";

import { ApercuDePiece } from "@/components/malica/apercu-de-piece";
import { FeuilleDuBas } from "@/components/malica/feuille-du-bas";
import { usePme } from "@/components/malica/pme-context";
import { useDecimales } from "@/hooks/use-decimales";
import { useDossiers } from "@/hooks/use-dossiers";
import { clePiecesLues } from "@/hooks/use-pieces-lues";
import { useSuperposition } from "@/hooks/use-superposition";
import { useI18n } from "@/i18n";
import { dossierDeLaPiece } from "@/lib/dossiers";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { jourEtMois, montant } from "@/lib/lisible";
import { ficheQuiAccompagne, repriseRefusee, totalAtteste } from "@/lib/piece-qui-accompagne";
import { photographierUnePreuve } from "@/lib/preuve-de-paiement";
import { ErreurReseau } from "@/lib/transport/erreurs";
import { office } from "@/verticals/malica-office/composition";
import type { PieceQuiAccompagne } from "@malica/socle/ports/repositories";
import { depuisUniteMineure } from "@malica/socle/somme-decimale";

const OU = "components/malica/piece-qui-accompagne";

type Feuille = "rattacher" | "reprendre" | "supprimer";

/** Le chevron des lignes de la fiche, le même que partout ailleurs sur la pièce. */
function Chevron() {
  return (
    <svg viewBox="0 0 24 24" className="g ch" aria-hidden>
      <path d="M9.5 5.5L16 12l-6.5 6.5" />
    </svg>
  );
}

export function PieceQuiAccompagneFiche({
  pieceId,
  typeDeDocument,
  donnees,
  onAgrandir,
}: {
  pieceId: string;
  /** Le type retenu par la base pour cette pièce (`pieces.document_kind`). */
  typeDeDocument: string | null;
  donnees: PieceQuiAccompagne;
  /** Ouvrir le document en plein écran — la visionneuse de la fiche. */
  onAgrandir: () => void;
}) {
  const { t, locale } = useI18n();
  const pme = usePme();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const decimales = useDecimales();
  const sept = useDossiers();
  const fiche = ficheQuiAccompagne(donnees);
  const recu = donnees.genre === "recu";

  const [feuille, setFeuille] = useState<Feuille | null>(null);
  const [choix, setChoix] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const feuilleRef = useRef<HTMLDivElement | null>(null);
  const fermer = useCallback(() => {
    setFeuille(null);
    setErreur(null);
  }, []);
  useSuperposition(feuille !== null, fermer, feuilleRef);
  const ouvrir = (f: Feuille) => {
    setErreur(null);
    // Le premier règlement proposé est choisi d'avance, comme sur la maquette.
    if (f === "rattacher") setChoix(donnees.candidats[0]?.id ?? null);
    setFeuille(f);
  };

  /* ---------------------------------------------------------- les mots */

  const lisible = (mineur: number | null) =>
    mineur === null || decimales === null
      ? "—"
      : montant(depuisUniteMineure(mineur, decimales), locale);
  const jour = (iso: string | null | undefined) => (iso ? jourEtMois(iso, locale) : "");
  const nomDuType = (code: string | null | undefined) =>
    sept.types.find((x) => x.code === code)?.libelle ?? null;

  // Une pièce née avant que son type ne soit déclaré n'en porte pas : son
  // genre, dit par la base, donne celui du référentiel.
  const type = typeDeDocument ?? (recu ? "recu_de_paiement" : "justificatif_paiement");
  const dossier = sept.parCode(dossierDeLaPiece({ typeDeDocument: type, kind: null }, sept.types));
  const surTitre = [
    dossier?.libelle,
    t(recu ? "pme.accompagne.genre.recu" : "pme.accompagne.genre.justificatif"),
  ]
    .filter(Boolean)
    .join(" · ");
  const titre = (recu ? null : fiche.cite?.nomDeLaPreuve) ?? nomDuType(type) ?? "";
  const sous = t(recu ? "pme.accompagne.recu.sous" : "pme.accompagne.justificatif.sous", {
    date: jour(donnees.creeLe),
  });

  const c = fiche.cite;
  const surLeReglement = c
    ? {
        par: c.moyenPar,
        moyen: c.moyen.toLocaleLowerCase(locale),
        date: jour(c.payeLe),
        montant: lisible(c.montantMineur),
        devise: c.devise,
      }
    : null;
  const annulation = donnees.annulation
    ? { le: jour(donnees.annulation.le), motif: donnees.annulation.motif }
    : null;
  const phrase = (() => {
    switch (fiche.cas) {
      case "recu":
        if (donnees.reglements.length === 0) return t("pme.accompagne.recu.ancien");
        return donnees.reglements.length === 1 && surLeReglement
          ? t("pme.accompagne.recu.atteste", surLeReglement)
          : t("pme.accompagne.recu.atteste.plusieurs", {
              count: donnees.reglements.length,
              montant: lisible(totalAtteste(donnees.reglements)),
              devise: c?.devise ?? "",
            });
      case "recuPerime":
        return t("pme.accompagne.recu.annule", { ...surLeReglement, ...annulation });
      case "justificatif":
        return surLeReglement ? t("pme.accompagne.justificatif.prouve", surLeReglement) : "";
      case "justificatifPerime":
        return t("pme.accompagne.justificatif.annule", { ...surLeReglement, ...annulation });
      case "justificatifSeul":
        return t("pme.accompagne.justificatif.sansReglement");
    }
  })();

  const mere = donnees.mere;
  const titreMere =
    (!recu && c && mere?.emetteur
      ? t("pme.accompagne.mere.reglement", {
          tiers: mere.emetteur,
          moyen: c.moyen,
          date: jour(c.payeLe),
        })
      : mere?.emetteur) ??
    nomDuType(mere?.typeDeDocument) ??
    t("pme.piece.title");
  const sousMere = mere
    ? [
        nomDuType(mere.typeDeDocument) && mere.date
          ? t("pme.accompagne.mere.du", {
              type: nomDuType(mere.typeDeDocument) ?? "",
              date: jour(mere.date),
            })
          : nomDuType(mere.typeDeDocument),
        mere.ttc
          ? t("pme.accompagne.mere.ttc", {
              montant: montant(mere.ttc, locale),
              devise: mere.devise ?? pme.currency,
            })
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  /* ---------------------------------------------------------- les gestes */

  const invalider = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["piece-qui-accompagne"] }),
      qc.invalidateQueries({ queryKey: ["paiements"] }),
      qc.invalidateQueries({ queryKey: ["joints"] }),
      qc.invalidateQueries({ queryKey: ["pieces", pme.tenantId] }),
      qc.invalidateQueries({ queryKey: clePiecesLues(pme.tenantId) }),
    ]);
  };
  const versLaMere = () =>
    mere
      ? navigate({ to: "/pme/piece/$pieceId", params: { pieceId: mere.id }, replace: true })
      : navigate({ to: "/pme/list", replace: true });

  const deplacer = useMutation({
    mutationFn: (paiementId: string) => office().capture.deplacerJustificatif(pieceId, paiementId),
    onSuccess: async () => {
      fermer();
      await invalider();
    },
    onError: (e: unknown) => setErreur(texteDeLErreur(e, OU, t("common.error"))),
  });

  const reprendre = useMutation({
    mutationFn: async () => {
      /*
       * Hors ligne, la photo partirait plus tard comme une preuve seule, et
       * l'ancienne resterait : chaque essai ferait un doublon. On le dit
       * AVANT d'ouvrir l'appareil.
       */
      if (typeof navigator !== "undefined" && navigator.onLine === false)
        throw new ErreurReseau("hors_ligne");
      const nouveau = await photographierUnePreuve({
        tenantId: pme.tenantId,
        entityId: pme.entityId,
        vis: donnees.vis,
        sourcePieceId: mere?.id ?? pieceId,
        depotExige: true,
      });
      if (!nouveau) return null;
      try {
        await office().capture.remplacerJustificatif(pieceId, nouveau);
      } catch (e) {
        // Un remplacement refusé ne laisse pas une photo orpheline derrière lui.
        await office()
          .capture.supprimer(nouveau)
          .catch(() => undefined);
        throw e;
      }
      return nouveau;
    },
    onSuccess: async (nouveau) => {
      if (!nouveau) return;
      fermer();
      await invalider();
      // L'ancienne n'existe plus : la fiche est celle de la nouvelle photo.
      await navigate({ to: "/pme/piece/$pieceId", params: { pieceId: nouveau }, replace: true });
    },
    onError: (e: unknown) => setErreur(texteDeLErreur(e, OU, t("common.error"))),
  });

  const supprimer = useMutation({
    mutationFn: () => office().capture.supprimerPieceQuiAccompagne(pieceId),
    onSuccess: async () => {
      fermer();
      await invalider();
      await versLaMere();
    },
    onError: (e: unknown) => setErreur(texteDeLErreur(e, OU, t("common.error"))),
  });

  const enCours = deplacer.isPending || reprendre.isPending || supprimer.isPending;
  const principal = (() => {
    switch (feuille) {
      case "rattacher":
        return {
          libelle: t("pme.accompagne.feuille.rattacher.bouton"),
          action: () => choix && deplacer.mutate(choix),
          eteint: choix === null,
        };
      case "reprendre":
        return {
          libelle: t("pme.accompagne.feuille.reprendre.bouton"),
          action: () => {
            // Une pièce transmise ne se remplace pas : on le dit AVANT
            // d'ouvrir l'appareil, sinon la nouvelle photo resterait orpheline.
            const refus = repriseRefusee(donnees);
            if (refus) setErreur(t(refus));
            else reprendre.mutate();
          },
          eteint: false,
        };
      case "supprimer":
        return {
          libelle: t("pme.accompagne.feuille.supprimer.bouton"),
          action: () => supprimer.mutate(),
          eteint: false,
        };
      default:
        return null;
    }
  })();

  return (
    <div data-ecran="dossier">
      <div className="a-tete">
        <span className="a-lab">{surTitre}</span>
        <h1>{titre}</h1>
        <span className="sous">{sous}</span>
      </div>

      <div className="a-corps">
        {/* 1 · ce qu'elle vaut, en une phrase */}
        <div className="f-carte a-etat">
          <span className={`q ${fiche.ton}`}>
            <i />
            {t(fiche.etat)}
          </span>
          <p>{phrase}</p>
        </div>

        {/* 2 · à quoi elle est rattachée : toujours dit, toujours ouvrable */}
        {mere ? (
          <>
            <span className="a-lab">{t("pme.accompagne.rattacheA")}</span>
            <Link
              className="f-ligne a-mere"
              to="/pme/piece/$pieceId"
              params={{ pieceId: mere.id }}
              preload="intent"
            >
              <span className="bd">
                <span className="vl-g">{titreMere}</span>
                <span className="lb">{sousMere}</span>
              </span>
              <span className="ouv">{t("pme.accompagne.ouvrir")}</span>
              <Chevron />
            </Link>
          </>
        ) : null}

        {/* 3 · le document tel qu'il est, touchable pour l'agrandir */}
        {recu ? (
          <button
            type="button"
            className={fiche.tampon ? "a-recu perime" : "a-recu"}
            aria-label={t("pme.accompagne.agrandir.recu")}
            onClick={onAgrandir}
          >
            <span className="papier">
              <ApercuDePiece pieceId={pieceId} taille="page" />
              {fiche.tampon ? <span className="tampon">{t("pme.accompagne.tampon")}</span> : null}
            </span>
            <span className="dent" aria-hidden />
            <span className="toucher">{t("pme.accompagne.toucher")}</span>
          </button>
        ) : (
          <button
            type="button"
            className="a-photo"
            aria-label={t("pme.accompagne.agrandir.photo")}
            onClick={onAgrandir}
          >
            <ApercuDePiece pieceId={pieceId} taille="page" />
            <span className="coin hd" aria-hidden />
            <span className="coin hf" aria-hidden />
            <span className="coin bd" aria-hidden />
            <span className="coin bf" aria-hidden />
            <span className="pastille">
              {t("pme.accompagne.photoDu", { date: jour(donnees.creeLe) })}
            </span>
          </button>
        )}

        {/* 4 · le geste principal, quand il y en a un */}
        {fiche.nouveauRecu && mere ? (
          <div className="f-dec-gestes">
            <button
              type="button"
              className="pr"
              onClick={() =>
                void navigate({
                  to: "/pme/piece/$pieceId",
                  params: { pieceId: mere.id },
                  search: { onglet: "reglement" },
                })
              }
            >
              {t("pme.accompagne.nouveauRecu")}
            </button>
          </div>
        ) : null}

        {/* 5 · les gestes, chacun seul */}
        <div className="f-carte">
          {fiche.peutRattacher ? (
            <button type="button" className="f-ligne" onClick={() => ouvrir("rattacher")}>
              <span className="bd">
                <span className="lb-a">{t("pme.accompagne.rattacher")}</span>
              </span>
              <Chevron />
            </button>
          ) : null}
          {fiche.peutReprendre ? (
            <button type="button" className="f-ligne" onClick={() => ouvrir("reprendre")}>
              <span className="bd">
                <span className="lb-a">{t("pme.accompagne.reprendre")}</span>
              </span>
              <Chevron />
            </button>
          ) : null}
          <button type="button" className="f-ligne sup" onClick={() => ouvrir("supprimer")}>
            <span className="bd">
              <span className="lb-a">{t(fiche.supprimer)}</span>
            </span>
          </button>
        </div>
        <p className="f-note">{t(fiche.note)}</p>
      </div>

      {/* la feuille : rattacher, reprendre, supprimer */}
      {feuille !== null && principal ? (
        <FeuilleDuBas
          titre={
            feuille === "rattacher"
              ? t("pme.accompagne.rattacher")
              : feuille === "reprendre"
                ? t("pme.accompagne.reprendre")
                : t(fiche.titreSuppression)
          }
          onFermer={fermer}
          feuilleRef={feuilleRef}
          disposition="flex flex-col gap-3.5 overflow-y-auto"
          croix={false}
        >
          {feuille === "rattacher" ? (
            <>
              <p className="text-[13.5px] leading-[1.5] text-text-2">
                {c && mere?.emetteur
                  ? t("pme.accompagne.feuille.rattacher.explique", {
                      par: c.moyenPar,
                      date: jour(c.payeLe),
                      tiers: mere.emetteur,
                    })
                  : t("pme.accompagne.feuille.rattacher.expliqueSeul")}
              </p>
              {donnees.candidats.length === 0 ? (
                <p className="text-[14px] text-text-2">
                  {t("pme.accompagne.feuille.rattacher.aucun")}
                </p>
              ) : (
                donnees.candidats.map((k) => (
                  <button
                    key={k.id}
                    type="button"
                    onClick={() => setChoix(k.id)}
                    aria-pressed={choix === k.id}
                    className={`flex min-h-[60px] w-full flex-col items-start gap-[3px] rounded-[16px] border px-3.5 py-2.5 text-start ${
                      choix === k.id ? "border-foreground bg-muted" : "border-border"
                    }`}
                  >
                    <b className="text-[14.5px] font-semibold">{k.tiers ?? t("pme.piece.title")}</b>
                    <span className="text-[12.5px] text-text-2">
                      {t("pme.accompagne.feuille.candidat", {
                        moyen: k.moyen,
                        montant: lisible(k.montantMineur),
                        date: jour(k.payeLe),
                      })}
                    </span>
                  </button>
                ))
              )}
            </>
          ) : feuille === "reprendre" ? (
            <div className="flex gap-2.5 rounded-[16px] bg-signal-warn/10 p-3.5">
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5 shrink-0 text-signal-warn"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden
              >
                <path d="M12 4l9 16H3z" />
                <path d="M12 10v4" />
                <path d="M12 17v.5" />
              </svg>
              <p className="text-[14px] leading-[1.5]">
                {t("pme.accompagne.feuille.reprendre.avertit")}
              </p>
            </div>
          ) : (
            <p className="text-[14px] leading-[1.5]">
              {t(fiche.expliqueSuppression, { action: t("pme.paiement.preuve.prendre") })}
            </p>
          )}

          {erreur ? (
            <p role="alert" className="text-[13px] text-signal-warn">
              {erreur}
            </p>
          ) : null}
          <button
            type="button"
            disabled={principal.eteint || enCours}
            onClick={principal.action}
            className={`h-[52px] w-full shrink-0 rounded-full text-[15px] font-bold disabled:opacity-40 ${
              feuille === "supprimer"
                ? "bg-signal-stop text-background"
                : "bg-foreground text-background"
            }`}
          >
            {enCours ? t("common.loading") : principal.libelle}
          </button>
          <button
            type="button"
            onClick={fermer}
            className="mb-3 min-h-[44px] shrink-0 text-[14px] text-text-2 underline underline-offset-[3px]"
          >
            {t("common.cancel")}
          </button>
        </FeuilleDuBas>
      ) : null}
    </div>
  );
}
