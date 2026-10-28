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
 *   — sans image (un PDF de texte, une pièce sans octets), et pendant le
 *     chargement, la feuille esquissée prend la place, sans rien inventer.
 *
 * ============================================================ CE QU'IL DIT
 *
 * Dans une liste, le nom de la pièce est écrit à côté : l'aperçu est alors
 * décoratif (`aria-hidden`), sinon le lecteur d'écran le dirait deux fois.
 * Seul, il prend un `nom`, et devient une image nommée. Le point d'état, en
 * haut à l'extrémité de la ligne (à gauche en arabe), reprend la teinte de la
 * pastille de la pièce (`parcoursDeLaPiece`) : il ne porte jamais seul une
 * information, le statut est écrit dans la ligne.
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { pagesJpegDuPdf } from "@/capabilities/pages-du-pdf";
import type { ParcoursDeLaPiece } from "@/lib/fiche-de-la-piece";
import { office } from "@/verticals/malica-office/composition";

/** La teinte du point d'état : celle de la pastille de la pièce. */
type TonDeLaPiece = ParcoursDeLaPiece["pastille"]["ton"];

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
  nom,
}: {
  pieceId: string;
  className?: string;
  /** `page` : les octets complets, pour une pièce seule affichée en grand. */
  taille?: "miniature" | "page";
  /** Le point d'état ; absent, pas de point. */
  ton?: TonDeLaPiece;
  /** Le nom à dire quand rien d'autre ne le dit ; absent, l'aperçu est décoratif. */
  nom?: string;
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
    retry: false,
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

  const accessible = nom
    ? ({ role: "img", "aria-label": nom } as const)
    : ({ "aria-hidden": true } as const);

  return (
    <span ref={cadre} className={["apercu", className].filter(Boolean).join(" ")} {...accessible}>
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
