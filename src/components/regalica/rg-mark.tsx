/**
 * Sigle Regalica.
 *
 * Rendu par masque CSS sur `currentColor` : le sigle prend toujours la couleur
 * du texte environnant — encre sur papier, papier sur encre. Aucune couleur
 * propre, conformément à la doctrine Edition One.
 */
export function RgMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={className}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        flex: "0 0 auto",
        backgroundColor: "currentColor",
        WebkitMask: "url(/rg-mark.svg) center / contain no-repeat",
        mask: "url(/rg-mark.svg) center / contain no-repeat",
      }}
    />
  );
}
