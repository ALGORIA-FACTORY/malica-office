/**
 * « Parler à Malica » — la conversation, partagée par l'écran de la PME et le
 * panneau du cabinet.
 *
 * ================================================================ CE QUI ARRIVE
 *
 * La réponse arrive EN FLUX (`office().malica.converser`) : le texte s'écrit
 * au fil de l'eau, la consultation du dossier se dit (« Je regarde vos
 * pièces… »), et la fin apporte les sources, les propositions d'action et les
 * suggestions de suite. Le texte reçu est DÉJÀ gardé côté serveur : une phrase
 * chiffrée sans source ne part jamais (`malica/assistant/garde.ts`).
 *
 * ================================================================ CE QUI SE FAIT
 *
 * Rien, sans la personne. Une action que Malica propose (envoyer au cabinet,
 * valider une écriture) s'affiche avec un bouton ; c'est ce bouton qui appelle
 * le chemin ordinaire de l'application — la même porte, les mêmes droits que
 * si la personne l'avait fait depuis la fiche de la pièce.
 *
 * Le markdown est rendu par `TexteMarkdown`, en éléments React : aucun HTML
 * venu du modèle n'atteint le DOM.
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Fragment, useCallback, useRef, useState, type ReactNode } from "react";

import type {
  EvenementDeLAssistant,
  PropositionDAction,
  SourceDeLAssistant,
  SuggestionDeSuite,
} from "@malica/socle/ports/assistant";

import { useEnvoyer } from "@/hooks/use-gestes-du-circuit";
import { clePiecesLues } from "@/hooks/use-pieces-lues";
import { useI18n, type MessageKey } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { office } from "@/verticals/malica-office/composition";

export interface TourDeMalica {
  role: "user" | "assistant";
  contenu: string;
  sources?: SourceDeLAssistant[] | undefined;
  propositions?: PropositionDAction[] | undefined;
  suggestions?: SuggestionDeSuite[] | undefined;
  /** Phrases chiffrées retirées faute de source : jamais montrées, comptées. */
  retirees?: number | undefined;
  repli?: boolean | undefined;
  enCours?: boolean | undefined;
  /** L'outil que Malica consulte en ce moment. */
  outil?: string | null | undefined;
  /** La panne, telle quelle : l'écran la dit par `texteDeLErreur`, jamais brute. */
  erreur?: unknown;
  /** Le message rangé au fil : ce que le cabinet juge. */
  messageId?: string | null | undefined;
  /** Les instruments : modèle, premier mot, coût. Montrés au cabinet seulement. */
  meta?: string | undefined;
}

/** Les libellés de consultation, un par outil — écrits en entier pour que le dictionnaire les voie. */
const CONSULTE: Record<string, MessageKey> = {
  pieces_chercher: "pme.assistant.outil.pieces_chercher",
  piece_ouvrir: "pme.assistant.outil.piece_ouvrir",
  tva_du_mois: "pme.assistant.outil.tva_du_mois",
  echeances_fiscales: "pme.assistant.outil.echeances_fiscales",
  ecritures_proposees: "pme.assistant.outil.ecritures_proposees",
  tiers_chercher: "pme.assistant.outil.tiers_chercher",
  conseil_fiscal: "pme.assistant.outil.conseil_fiscal",
  action_proposer: "pme.assistant.outil.action_proposer",
};

const ACTIONS: Record<PropositionDAction["action"], MessageKey> = {
  envoyer_au_cabinet: "pme.assistant.proposition.envoyer_au_cabinet",
  valider_ecriture: "pme.assistant.proposition.valider_ecriture",
};

/**
 * Le fil de conversation : les tours, l'envoi en flux, la reprise d'un fil.
 * Le fil voyage par son identifiant, jamais par son contenu.
 */
export function useConversationMalica(tenantId: string | null | undefined) {
  const { locale } = useI18n();
  const [tours, setTours] = useState<TourDeMalica[]>([]);
  const [filId, setFilId] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const arret = useRef<AbortController | null>(null);

  const majDernier = (f: (t: TourDeMalica) => TourDeMalica) =>
    setTours((prec) => {
      const copie = [...prec];
      const dernier = copie[copie.length - 1];
      if (dernier?.role === "assistant") copie[copie.length - 1] = f(dernier);
      return copie;
    });

  const envoyer = useCallback(
    async (
      question: string,
      pieceIds: string[] = [],
    ): Promise<{ conversationId: string | null; reponse: string | null }> => {
      const q = question.trim();
      if (!q || !tenantId || enCours) return { conversationId: null, reponse: null };
      setEnCours(true);
      setTours((prec) => [
        ...prec,
        { role: "user", contenu: q },
        { role: "assistant", contenu: "", enCours: true, outil: null },
      ]);
      const controleur = new AbortController();
      arret.current = controleur;
      let nouveauFil: string | null = null;
      let reponse: string | null = null;
      const surEvenement = (ev: EvenementDeLAssistant) => {
        switch (ev.type) {
          case "debut":
            nouveauFil = ev.conversationId;
            setFilId(ev.conversationId);
            return;
          case "texte":
            majDernier((t) => ({ ...t, contenu: t.contenu + ev.texte, outil: null }));
            return;
          case "outil":
            majDernier((t) => ({ ...t, outil: ev.etat === "debut" ? ev.nom : null }));
            return;
          case "proposition":
            majDernier((t) => ({
              ...t,
              propositions: [...(t.propositions ?? []), ev.proposition],
            }));
            return;
          case "fin":
            reponse = ev.fin.reponse;
            majDernier((t) => ({
              ...t,
              contenu: ev.fin.reponse,
              sources: ev.fin.sources,
              propositions: ev.fin.propositions,
              suggestions: ev.fin.suggestions,
              retirees: ev.fin.chiffresRetires.length,
              repli: ev.fin.mesure.repli === "deepseek",
              messageId: ev.fin.messageId,
              meta: [
                ev.fin.mesure.modele ?? "—",
                ev.fin.mesure.latencePremierMotMs === null
                  ? null
                  : `${(ev.fin.mesure.latencePremierMotMs / 1000).toFixed(1)} s`,
                `${(ev.fin.mesure.latenceTotaleMs / 1000).toFixed(1)} s`,
                ev.fin.mesure.coutUsd === null ? null : `${ev.fin.mesure.coutUsd} $`,
                ev.fin.mesure.outils.join(", ") || null,
              ]
                .filter(Boolean)
                .join(" · "),
              enCours: false,
              outil: null,
            }));
            return;
          default:
            return;
        }
      };
      try {
        await office().malica.converser(
          { tenantId, question: q, locale, conversationId: filId, pieceIds },
          surEvenement,
          controleur.signal,
        );
      } catch (e) {
        // Un fil quitté en cours de réponse n'est pas une panne à montrer.
        if (!controleur.signal.aborted) {
          majDernier((t) => ({ ...t, enCours: false, outil: null, erreur: e }));
        }
      } finally {
        setEnCours(false);
        arret.current = null;
      }
      return { conversationId: nouveauFil, reponse };
    },
    [tenantId, enCours, locale, filId],
  );

  /**
   * Reprendre un fil : chaque réponse revient avec les sources qu'elle citait
   * et les actions qu'elle proposait, rangées avec elle.
   */
  const reprendre = useCallback(
    (
      id: string,
      messages: Array<{
        role: "user" | "assistant";
        contenu: string;
        sources?: SourceDeLAssistant[] | null | undefined;
        propositions?: PropositionDAction[] | null | undefined;
      }>,
    ) => {
      arret.current?.abort();
      setFilId(id);
      setTours(
        messages.map((m) => ({
          role: m.role,
          contenu: m.contenu,
          sources: m.sources ?? undefined,
          propositions: m.propositions ?? undefined,
        })),
      );
    },
    [],
  );

  const nouveau = useCallback(() => {
    arret.current?.abort();
    setFilId(null);
    setTours([]);
  }, []);

  return { tours, filId, enCours, envoyer, reprendre, nouveau };
}

/* ------------------------------------------------------------ le markdown -- */

/** Le gras, l'italique et le code d'une ligne, en éléments React. */
function enLigne(texte: string): ReactNode[] {
  const morceaux: ReactNode[] = [];
  const motif = /(\*\*[^*]+\*\*|_[^_\s][^_]*_|\*[^*\s][^*]*\*|`[^`]+`)/g;
  let fin = 0;
  let k = 0;
  for (const m of texte.matchAll(motif)) {
    if (m.index > fin) morceaux.push(texte.slice(fin, m.index));
    const brut = m[0];
    if (brut.startsWith("**")) morceaux.push(<strong key={k++}>{brut.slice(2, -2)}</strong>);
    else if (brut.startsWith("`")) morceaux.push(<code key={k++}>{brut.slice(1, -1)}</code>);
    else morceaux.push(<em key={k++}>{brut.slice(1, -1)}</em>);
    fin = m.index + brut.length;
  }
  if (fin < texte.length) morceaux.push(texte.slice(fin));
  return morceaux;
}

/**
 * Un markdown léger — paragraphes, listes à puces et numérotées, gras,
 * italique, code — rendu en éléments React. Ce que la consigne demande au
 * modèle, et rien de plus : ni titre, ni tableau, ni lien, ni HTML.
 */
function TexteMarkdown({ texte }: { texte: string }) {
  const blocs = texte
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
  return (
    <>
      {blocs.map((bloc, i) => {
        const lignes = bloc.split("\n");
        if (lignes.every((l) => /^\s*[-*•]\s+/.test(l))) {
          return (
            <ul key={i} className="list-disc ps-5">
              {lignes.map((l, j) => (
                <li key={j}>{enLigne(l.replace(/^\s*[-*•]\s+/, ""))}</li>
              ))}
            </ul>
          );
        }
        if (lignes.every((l) => /^\s*\d{1,2}[.)]\s+/.test(l))) {
          return (
            <ol key={i} className="list-decimal ps-5">
              {lignes.map((l, j) => (
                <li key={j}>{enLigne(l.replace(/^\s*\d{1,2}[.)]\s+/, ""))}</li>
              ))}
            </ol>
          );
        }
        return (
          <p key={i}>
            {lignes.map((l, j) => (
              <Fragment key={j}>
                {j > 0 ? <br /> : null}
                {enLigne(l.replace(/^#{1,6}\s+/, ""))}
              </Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
}

/* ------------------------------------------------------------ une réponse -- */

/**
 * Une réponse de Malica : le texte, ce qu'elle consulte, ses sources
 * cliquables (une pièce s'ouvre ; un article ou un chiffre du dossier déplie
 * ce qui a été remis au modèle), ses propositions à confirmer, ses suggestions.
 */
export function ReponseDeMalica({
  tour,
  tenantId,
  espace,
  surSuggestion,
}: {
  tour: TourDeMalica;
  tenantId: string;
  /** Où s'ouvre une pièce : l'espace de la PME ou celui du cabinet. */
  espace: "pme" | "cabinet";
  surSuggestion: (texte: string) => void;
}) {
  const { t } = useI18n();
  const [ouverte, setOuverte] = useState<string | null>(null);
  const sourceOuverte = tour.sources?.find((s) => s.cle === ouverte) ?? null;

  return (
    <>
      {tour.contenu ? <TexteMarkdown texte={tour.contenu} /> : null}
      {tour.enCours && tour.outil ? (
        <p className="et1" role="status">
          <i />
          {CONSULTE[tour.outil] ? t(CONSULTE[tour.outil]!) : t("malica.chat.thinking")}
        </p>
      ) : tour.enCours && !tour.contenu ? (
        <p className="et1" role="status">
          <i />
          {t("malica.chat.thinking")}
        </p>
      ) : null}
      {tour.erreur ? (
        <p className="et1" role="alert">
          <i />
          {texteDeLErreur(tour.erreur, "malica : assistant", t("pme.assistant.indisponible"))}
        </p>
      ) : null}

      {tour.sources && tour.sources.length > 0 ? (
        <div className="srcs" aria-label={t("pme.assistant.sources")}>
          {tour.sources.map((s) =>
            s.genre === "piece" && s.objetId ? (
              <Link
                key={s.cle}
                to={espace === "pme" ? "/pme/piece/$pieceId" : "/cabinet/piece/$pieceId"}
                params={{ pieceId: s.objetId }}
              >
                <IconeSource />
                {s.titre}
              </Link>
            ) : (
              <button
                key={s.cle}
                type="button"
                aria-expanded={ouverte === s.cle}
                onClick={() => setOuverte(ouverte === s.cle ? null : s.cle)}
              >
                <IconeSource />
                {s.titre}
              </button>
            ),
          )}
        </div>
      ) : null}
      {sourceOuverte?.extrait ? (
        <blockquote className="whitespace-pre-wrap border-s-2 border-border ps-3 text-[12px] text-muted-foreground">
          {sourceOuverte.extrait}
        </blockquote>
      ) : null}

      {(tour.propositions ?? []).map((p) => (
        <PropositionAConfirmer key={p.id} proposition={p} tenantId={tenantId} />
      ))}

      {tour.retirees ? (
        <p className="text-[11px] text-muted-foreground">{t("pme.assistant.retire")}</p>
      ) : null}
      {tour.repli ? (
        <p className="text-[11px] text-muted-foreground">{t("pme.assistant.repli")}</p>
      ) : null}

      {!tour.enCours && tour.suggestions && tour.suggestions.length > 0 ? (
        <div className="tabs">
          {tour.suggestions.map((s) => (
            <button key={s.texte} type="button" onClick={() => surSuggestion(s.texte)}>
              {s.texte}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}

/**
 * Une action proposée par Malica, que seule la personne déclenche. L'envoi au
 * cabinet passe par LA porte du circuit (`useEnvoyer`) : si le Socle ne
 * l'offre pas sur cette pièce (partie, gardée, retournée au siège), le bouton
 * n'existe pas — Malica a pu se tromper, la porte non.
 */
function PropositionAConfirmer({
  proposition: p,
  tenantId,
}: {
  proposition: PropositionDAction;
  tenantId: string;
}) {
  const { t } = useI18n();
  const [decision, setDecision] = useState<"faite" | "ignoree" | null>(null);
  const pieces = useQuery({
    queryKey: clePiecesLues(tenantId),
    queryFn: () => office().capture.listAvecLecture(tenantId),
    enabled: p.action === "envoyer_au_cabinet",
  });
  const piece = pieces.data?.find((x) => x.id === p.pieceId) ?? null;
  const envoi = useEnvoyer(tenantId, piece, { onSuccess: () => setDecision("faite") });
  const validation = useMutation({
    mutationFn: () => office().office.valider(p.pieceId, null),
    onSuccess: () => setDecision("faite"),
  });
  const geste = p.action === "envoyer_au_cabinet" ? envoi : validation;
  const erreur = geste?.error;

  return (
    <div className="esc" role="group" aria-label={t("pme.assistant.proposition.titre")}>
      <span className="bd">
        <b>{t(ACTIONS[p.action])}</b>
        <span>
          {p.libelle} — {p.raison}
        </span>
        <span>{t("pme.assistant.proposition.titre")}</span>
      </span>
      {decision === "faite" ? (
        <span>{t("pme.assistant.proposition.faite")}</span>
      ) : decision === "ignoree" ? (
        <span>{t("pme.assistant.proposition.ignoree")}</span>
      ) : (
        <span className="flex gap-2">
          {geste ? (
            <button
              type="button"
              className="go"
              disabled={geste.isPending}
              onClick={() => geste.mutate()}
            >
              {t("pme.assistant.proposition.confirmer")}
            </button>
          ) : null}
          <button type="button" onClick={() => setDecision("ignoree")}>
            {t("pme.assistant.proposition.ignorer")}
          </button>
        </span>
      )}
      {erreur ? (
        <span role="alert">
          {texteDeLErreur(erreur, "malica : proposition", t("malica.chat.error"))}
        </span>
      ) : null}
    </div>
  );
}

function IconeSource() {
  return (
    <svg viewBox="0 0 24 24" className="g" aria-hidden>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
    </svg>
  );
}

/* ------------------------------------------------------------ la pièce jointe -- */

/**
 * Joindre une photo ou un PDF : la pièce est DÉPOSÉE dans le dossier, puis
 * confiée à la lecture Malica — le modèle de la conversation ne voit jamais
 * l'image (R2) ; il lit ce que la lecture en a relevé, par `piece_ouvrir`.
 */
export function useJointe(tenantId: string | null | undefined) {
  const [jointes, setJointes] = useState<Array<{ id: string; nom: string }>>([]);
  const deposer = useMutation({
    mutationFn: async (fichier: File) => {
      if (!tenantId) throw new Error("dossier absent");
      const id = await office().capture.register({
        tenantId,
        entityId: null,
        file: fichier,
        fileName: fichier.name,
        source: fichier.type === "application/pdf" ? "pdf" : "photo",
        vis: "entite",
        idempotencyKey: crypto.randomUUID(),
      });
      await office().malica.demanderLaLecture(id);
      return { id, nom: fichier.name };
    },
    onSuccess: (j) => setJointes((prec) => [...prec, j]),
  });
  const retirer = useCallback(
    (id: string) => setJointes((prec) => prec.filter((j) => j.id !== id)),
    [],
  );
  const vider = useCallback(() => setJointes([]), []);
  return { jointes, deposer, retirer, vider };
}
