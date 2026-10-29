/**
 * L'aperçu d'une pièce — la vraie page, lue dans la base.
 *
 * ================================================================= POURQUOI
 *
 * 23 octobre 2026, l'accueil « principe Spotify » validé par Wissem : des
 * aperçus de documents qui défilent, « de la base » — pas une feuille dessinée.
 * 28 octobre 2026 (« Malica sans blocage ») : une miniature de la vraie photo à
 * gauche de CHAQUE pièce, dans toutes les listes. C'est la seule brique qui la
 * montre, partout.
 *
 * ==================================================== CE QUI COÛTE, ET COMMENT
 *
 * Une photo de facture pèse un à trois mégaoctets, et une liste en montre vingt
 * à cent. Les listes chargeaient ces octets complets : sur un forfait mobile,
 * une liste ouverte en coûtait des centaines. Donc :
 *
 *   — par défaut, la MINIATURE (`capture.miniature`) : un JPEG de quelques
 *     dizaines de kilo-octets que le serveur fait une fois et garde, sous la
 *     même RLS que la pièce (`apps/api/src/miniature.ts`) ;
 *   — `taille="page"` garde les octets complets, pour les seuls cadres où une
 *     pièce SEULE s'affiche en grand (le reçu d'un règlement, la page à
 *     vérifier) : une pièce, pas cent ;
 *   — rien n'est demandé tant que l'aperçu n'approche pas de l'écran
 *     (`IntersectionObserver`, marge de 200 px) ;
 *   — une fois lu, il reste en cache : une pièce ne change pas d'octets ;
 *   — sans image (un PDF chiffré ou cassé, une pièce sans octets), et pendant le
 *     chargement, la feuille esquissée prend la place, sans rien inventer.
 *
 * Une pièce photographiée hors ligne existe avant ses octets : le serveur
 * répond 404 « contenu absent » tant que la file ne les a pas déposés. Ce
 * 404-là n'est pas définitif — l'aperçu réessaie, à intervalles croissants et
 * bornés, et la file le relance dès qu'elle a déposé (`rafraichirLApercu`).
 * Un 5xx (la fabrication a échoué un instant) se réessaie de même. Seul un
 * 204 — « ce document n'a pas de miniature » — est gardé pour définitif ; une
 * erreur ne l'est jamais : réessais épuisés, l'aperçu redemande à son
 * prochain affichage.
 *
 * ============================================================ CE QU'IL DIT
 *
 * Partout où il paraît, le nom de la pièce est écrit à côté, ou porté par le
 * bouton qui l'entoure : l'aperçu est donc décoratif (`aria-hidden`, `alt`
 * vide), sinon le lecteur d'écran dirait la pièce deux fois. Le point d'état, en
 * haut à l'extrémité de la ligne (à gauche en arabe), reprend la teinte de la
 * pastille de la pièce (`parcoursDeLaPiece`) : il ne porte jamais seul une
 * information, le statut est écrit dans la ligne.
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { pagesJpegDuPdf } from "@/capabilities/pages-du-pdf";
import type { ParcoursDeLaPiece } from "@/lib/fiche-de-la-piece";
import { ErreurApi } from "@/lib/transport/erreurs";
import { office } from "@/verticals/malica-office/composition";

/** La teinte du point d'état : celle de la pastille de la pièce. */
type TonDeLaPiece = ParcoursDeLaPiece["pastille"]["ton"];

/** Quatre reprises, après 2, 4, 8 puis 16 s : octets pas encore là, ou échec passager. */
const REPRISES = 4;

/** Ce qui peut changer d'un instant à l'autre : pas d'octets encore (404), une panne (5xx). */
const passagere = (erreur: unknown) =>
  erreur instanceof ErreurApi && (erreur.statut === 404 || erreur.statut >= 500);

/** L'image de la page entière, ou `null` : le contenu n'en donne pas. */
async function pageDe(pieceId: string): Promise<Blob | null> {
  const octets = await office().capture.apercu(pieceId);
  if (!octets) return null;
  if (octets.type.startsWith("image/")) return octets;
  if (octets.type === "application/pdf") {
    return pagesJpegDuPdf(await octets.arrayBuffer())[0] ?? null;
  }
  return null;
}

export function ApercuDePiece({
  pieceId,
  className,
  taille = "miniature",
  ton,
}: {
  pieceId: string;
  className?: string;
  /** `page` : les octets complets, pour une pièce seule affichée en grand. */
  taille?: "miniature" | "page";
  /** Le point d'état ; absent, pas de point. */
  ton?: TonDeLaPiece;
}) {
  const cadre = useRef<HTMLSpanElement | null>(null);
  const [proche, setProche] = useState(false);

  useEffect(() => {
    const el = cadre.current;
    if (!el || proche) return;
    if (typeof IntersectionObserver === "undefined") {
      setProche(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entrees) => {
        if (entrees.some((e) => e.isIntersecting)) {
          setProche(true);
          obs.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [proche]);

  const image = useQuery({
    queryKey: ["apercu", taille, pieceId],
    queryFn: () => (taille === "page" ? pageDe(pieceId) : office().capture.miniature(pieceId)),
    enabled: proche,
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000,
    // Seul ce qui est passager se réessaie ; un 204 (`null`) est une réponse.
    retry: (n, erreur) => passagere(erreur) && n < REPRISES,
    retryDelay: (n) => 2000 * 2 ** n,
  });

  // L'URL d'objet vit avec le composant, et se rend à sa disparition.
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!image.data) return;
    const u = URL.createObjectURL(image.data);
    setUrl(u);
    return () => {
      URL.revokeObjectURL(u);
      setUrl(null);
    };
  }, [image.data]);

  return (
    <span ref={cadre} className={["apercu", className].filter(Boolean).join(" ")} aria-hidden>
      {url ? (
        <img src={url} alt="" />
      ) : (
        <span className="esq">
          <i />
          <i />
          <i />
          <i />
        </span>
      )}
      {ton ? <span className="pt" data-ton={ton} /> : null}
    </span>
  );
}
