/**
 * L'aperçu d'une pièce — la vraie page, lue dans la base.
 *
 * ================================================================= POURQUOI
 *
 * 23 octobre 2026, l'accueil « principe Spotify » validé par Wissem : des
 * aperçus de documents qui défilent, « de la base » — pas une feuille dessinée.
 * Les octets viennent de `/pieces/:id/contenu`, sous la session, par
 * `capture.apercu`.
 *
 * ==================================================== CE QUI COÛTE, ET COMMENT
 *
 * Une photo de facture pèse un à trois mégaoctets. Une rangée qui en
 * chargerait dix d'un coup au démarrage ruinerait un forfait mobile. Donc :
 *
 *   — rien n'est demandé tant que l'aperçu n'approche pas de l'écran
 *     (`IntersectionObserver`, marge de 200 px) ;
 *   — une fois lu, il reste en cache : une pièce ne change pas d'octets ;
 *   — un PDF montre sa première page quand elle est une image JPEG
 *     (`pagesJpegDuPdf`, le cas des scans) ; sinon, et pendant le chargement,
 *     la feuille esquissée prend la place, sans rien inventer.
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { pagesJpegDuPdf } from "@/capabilities/pages-du-pdf";
import { office } from "@/verticals/malica-office/composition";

/** L'image à montrer, ou `null` : le contenu n'en donne pas. */
async function imageDe(pieceId: string): Promise<Blob | null> {
  const octets = await office().capture.apercu(pieceId);
  if (!octets) return null;
  if (octets.type.startsWith("image/")) return octets;
  if (octets.type === "application/pdf") {
    return pagesJpegDuPdf(await octets.arrayBuffer())[0] ?? null;
  }
  return null;
}

export function ApercuDePiece({ pieceId, className }: { pieceId: string; className?: string }) {
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
    queryKey: ["apercu", pieceId],
    queryFn: () => imageDe(pieceId),
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

  return (
    <span
      ref={cadre}
      className={["apercu", className].filter(Boolean).join(" ")}
      aria-hidden="true"
    >
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
    </span>
  );
}
