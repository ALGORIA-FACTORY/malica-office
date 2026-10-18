import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import malicaLoin from "@/assets/malica-loin.webp";
import { MalicaChat } from "@/components/malica/MalicaChat";
import { usePme } from "@/components/malica/pme-context";
import { office } from "@/verticals/malica-office/composition";

/* ═══════════════════════════════════════════════════════════════════════════
 *
 *   LES CHAÎNES DE CET ÉCRAN — UN SEUL BLOC, ET IL EST ICI
 *
 * Elles sont en français, en dur, nommées. Elles n'entrent pas au
 * dictionnaire aujourd'hui pour une raison : la route est neuve et son
 * contenu n'est pas arrêté (voir « CE QUI N'EST PAS BRANCHÉ » plus bas). Une
 * clé i18n posée sur une phrase qui va changer se traduit deux fois.
 *
 * Elles sont donc toutes ici, visibles d'un coup d'œil, pour qu'on sache
 * exactement ce qu'il y a à verser au dictionnaire quand l'écran se fige.
 * Aucune autre chaîne française ne vit ailleurs dans ce fichier.
 * ═══════════════════════════════════════════════════════════════════════ */
const TEXTES = {
  /** Le nom qu'on lit en tête du fil, à côté de son visage. */
  malica: "Malica",
  /** Ce que le composeur propose, dans la voix du dessin. */
  composer: "Écrivez à Malica…",
  /** La suite du fil, quand un cabinet est mandaté et porte un nom. */
  suiteAvis: (cabinet: string) => `Demander l'avis de ${cabinet}`,
  /** La même, quand le cabinet existe mais n'a pas rendu son nom. */
  suiteAvisSansNom: "Demander l'avis de votre cabinet",
  /** La suite d'un siège : lui ne transmet pas, il demande. */
  suiteTransmission: "Demander la transmission au propriétaire du dossier",
  /** Et pourquoi le geste n'est pas encore offert ici. Voir R-CÂBLAGE ci-dessous. */
  suitePasEncore: "La demande n'est pas encore ouverte depuis cet écran",
  /** Aucun mandat : le geste n'a nulle part où aller, et l'écran le dit. */
  suiteSansCabinet: "Demander l'avis d'un cabinet",
  suiteSansCabinetDetail: "Aucun cabinet n'est mandaté sur ce dossier",
  /** Le pied du fil — repris mot pour mot du dessin. */
  pied:
    "Je cite l'article et sa version en vigueur à la date. Je ne tranche pas à la " +
    "place de votre expert-comptable sur ce qui engage votre dossier.",
} as const;

export const Route = createFileRoute("/_authenticated/pme/malica")({
  head: () => ({
    meta: [
      { title: "Malica — Malica Office" },
      {
        name: "description",
        content:
          "Posez votre question comptable, fiscale ou juridique. Malica cite l'article et sa version en vigueur, et remet au cabinet ce qui engage votre dossier.",
      },
      { property: "og:title", content: "Malica — Malica Office" },
      {
        property: "og:description",
        content: "La conversation avec Malica : la réponse, sa source, et la suite du fil.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PmeMalica,
});

/**
 * Converser avec Malica — l'écran, et son adresse.
 *
 * ================================================================= POURQUOI
 *
 * La conversation existait, et elle marchait : `MalicaChat`, monté en panneau
 * par-dessus l'accueil. Le commentaire qui l'y pose le disait lui-même —
 * « il garde la langue Edition One : c'est l'écran converser, qui aura son
 * propre dessin avec la route `pme.malica` ». La voici.
 *
 * Ce que cette route apporte, et c'est tout ce qu'elle apporte : une ADRESSE
 * (on peut y revenir, la partager, l'ouvrir d'un lien), le LANGAGE PME autour
 * du fil, le visage de Malica une fois en tête, la SUITE du fil, et le pied
 * qui dit ce que Malica ne tranche pas.
 *
 * ============================================ LA CONVERSATION N'EST PAS RÉÉCRITE
 *
 * `MalicaChat` est rendu tel quel. Rien de sa logique n'est recopié ici : ni
 * l'appel à `malica.demander`, ni la reprise d'un fil par
 * `conversations.ouvrir`, ni le renommage, ni la suppression en deux gestes,
 * ni le pouce du comptable (`conversations.juger`), ni le journal du modèle.
 * Un fil composé par deux endroits serait un fil qu'on peut forger, et la
 * duplication aurait doublé la surface où une réponse peut se perdre.
 *
 * Conséquence directe, et elle se voit : à l'INTÉRIEUR du composant, le fil
 * garde la langue Edition One. Les classes du dessin — `.moi`, `.mal`,
 * `.srcs`, `.et1`, `.cab`, `.comp` — ne peuvent pas descendre dessus, parce
 * que `MalicaChat` écrit son propre balisage en utilitaires et n'expose aucun
 * emplacement de rendu. Ce qu'il faudrait lui ajouter est listé au rapport de
 * livraison, pas contourné ici.
 *
 * ================================================ LE CSS EXISTE, ON NE L'ÉCRIT PAS
 *
 * `styles-pme.css` porte le dessin sous `[data-surface="pme"]
 * [data-ecran="chat"]`. Cet écran pose donc `data-ecran="chat"` sur sa racine
 * et n'emploie QUE les classes relevées dans cette feuille : `.pad` et
 * `.foot` (primitives communes), `.sig`, `.sig .ph`, `.esc`, `.esc.off`,
 * `.esc .av`, `.esc .bd`. Aucune classe utilitaire par-dessus : une seule
 * d'entre elles contredirait le dessin. Les deux seules utilitaires du
 * fichier sont sur la RACINE, et elles ne peignent rien — elles annulent le
 * `px-4 py-5` du layout, comme sur l'accueil.
 *
 * ================================================= CE QUI N'EST PAS RENDU, ET POURQUOI
 *
 * `.app`, `.rev`, `.top` du dessin ne sont pas rendus, et c'est délibéré.
 *
 *   `.rev` est la rangée « Basic · Solo · Team · Premium » de la maquette :
 *   une affordance de DÉMONSTRATION. L'abonnement ne s'affiche pas comme ça.
 *
 *   `.app` est le cadre — largeur maximale, fond, aires sûres — déjà tenu par
 *   le layout `pme.tsx`, comme sur l'accueil. Son `padding-top:4.75rem` ne
 *   réservait que la place de `.rev` et de `.top`.
 *
 *   `.top` est, dans la feuille, `position:fixed; top:2.375rem` — les 2.375rem
 *   sont l'épaisseur de `.rev`, qui n'existe pas dans l'application. Et le
 *   layout rend déjà `EntetePme` sur ce chemin. Rendre les deux empilerait
 *   deux en-têtes, dont une flottante au-dessus du fil, décalée de 38 px sans
 *   rien pour remplir le vide. Le barreau de retour est donc celui du layout
 *   et de la barre du bas, le temps que deux choses changent ensemble —
 *   aucune des deux n'étant de ce fichier : la règle `position:fixed` de
 *   `[data-ecran="chat"] .top` (comme `[data-ecran="manquants"] .top`, qui
 *   est dans le flux), et `pme.tsx`, qui doit alors cesser de rendre
 *   `EntetePme` sur `/pme/malica`.
 *
 * `.poser` — la barre « Posez votre question… » en tête de la liste — n'est
 * pas rendue non plus : elle n'aurait rien à ouvrir. `MalicaChat` rend son
 * propre composeur, en bas, et n'expose pas de quoi lui donner le focus. Une
 * barre qui invite et ne répond pas est pire que son absence.
 *
 * La LISTE des fils (`.th`, `.del`, `.undo`, `.tabs`, `.lbl`) n'est pas
 * rendue ici : `MalicaChat` porte la sienne, et il n'accepte aucun
 * identifiant de fil en entrée — une ligne de liste écrite ici n'aurait pas
 * pu ouvrir le fil sur lequel on tape. Le détail est au rapport.
 *
 * ========================================================== R3 — ET CE QUI EN DÉCOULE
 *
 * « Malica appelle, elle ne calcule pas. » Aucun chiffre n'est écrit par cet
 * écran, et il n'en déduit aucun : les seuls nombres qui peuvent apparaître
 * sont dans le texte que le Socle a rendu, à l'intérieur du fil. Les deux
 * lectures de ce fichier — le rôle et le contexte de conseil — ne rendent
 * aucun montant.
 *
 * Et R-CÂBLAGE : « n'invente aucun appel RPC ». `conseil.creer`, que le
 * câblage nomme pour « poser la question au cabinet », est au `contrat/rpc.json`
 * mais ABSENT de `ConseilRepository`. Le dépôt est un `Proxy` typé par le port :
 * `office().conseil.creer(...)` ne compile pas, et l'ajouter au port depuis un
 * écran serait écrire le contrat par le haut. La carte de suite est donc
 * rendue VERROUILLÉE — elle dit ce qu'elle ferait, elle ne disparaît pas.
 */
function PmeMalica() {
  const pme = usePme();

  /*
   * Qui je suis dans ce dossier. Même clé que `pme.piece.$pieceId` — une
   * seule lecture du rôle pour toute la navigation, et le même `staleTime` :
   * un rôle ne change pas entre deux écrans.
   */
  const acces = useQuery({
    queryKey: ["mon-acces", pme.tenantId],
    queryFn: () => office().acces.monAcces(pme.tenantId),
    staleTime: 10 * 60 * 1000,
  });

  /*
   * Y a-t-il un cabinet, et comment s'appelle-t-il.
   *
   * `conseil.contexte` est la lecture que le câblage nomme pour cet écran. Le
   * nom sert la carte de suite : le dirigeant connaît son cabinet par son nom,
   * et « votre comptable » est une périphrase. `seuil` et `appelantMembre` ne
   * sont pas lus ici : ils gouvernent ce que Malica retient, et c'est elle qui
   * en décide, pas l'écran.
   *
   * Pas de repli : chargement, échec et absence de mandat se disent
   * différemment plus bas. Un « aucun cabinet » affiché pendant un chargement
   * serait une affirmation.
   */
  const conseil = useQuery({
    queryKey: ["conseil-contexte", pme.tenantId],
    queryFn: () => office().conseil.contexte(pme.tenantId),
    staleTime: 10 * 60 * 1000,
  });

  const cabinetNom = conseil.data?.cabinetNom ?? null;
  const aUnCabinet = Boolean(conseil.data?.cabinetId);
  /*
   * Un siège ne transmet pas : il demande, et c'est le propriétaire qui
   * tranche — la même règle que pour ses pièces. Le rôle décide donc de la
   * phrase, pas seulement du droit : proposer « demander l'avis du cabinet »
   * à un siège lui offrirait un geste que la base lui refuse.
   */
  const siege = acces.data?.role === "collaborateur";

  return (
    /*
     * `data-ecran="chat"` : le marqueur qui fait descendre sur cet arbre les
     * règles du dessin. Les marges négatives annulent le `px-4 py-5` du
     * layout — `.pad` porte la sienne, et le dessin ne veut pas de double
     * gouttière.
     */
    <div data-ecran="chat" className="-mx-4 -my-5 flex min-h-0 flex-1 flex-col">
      <div className="pad">
        {/*
         * ------------------------------------------------- son visage, une fois
         *
         * « Son visage n'apparaît qu'une fois, en tête du fil. » C'est tout le
         * propos de `.sig` : Malica parle le plus, donc elle se montre le
         * moins — pas d'avatar répété à chaque bulle, pas d'étiquette « elle »
         * au-dessus de chaque réponse. Le cadrage (le `object-position:50% 34%`
         * qui remonte le regard) est dans la feuille ; l'image est livrée en
         * 620×620 et c'est le CSS qui la réduit.
         *
         * `alt=""` : le nom est juste à côté, en texte. Le répéter ferait
         * entendre « Malica Malica » à un lecteur d'écran.
         *
         * `MalicaAvatar` n'est pas employé ici : il porte la langue du
         * cabinet, et le dessin veut cette photo-ci, cadrée par `.sig .ph`.
         */}
        <div className="sig">
          <span className="ph">
            <img src={malicaLoin} alt="" width={620} height={620} />
          </span>
          <b>{TEXTES.malica}</b>
        </div>

        {/*
         * ------------------------------------------------------------ le fil
         *
         * Le composant, tel quel. `technique` reste fermé : « deepseek-reasoner
         * · 8609 jetons » n'a rien à faire devant un dirigeant de PME, et le
         * lui montrer transforme une conseillère en tableau de bord. C'est le
         * défaut du composant ; on ne le force pas, on le laisse.
         *
         * `placeholder` est la seule chose que le dessin peut encore lui
         * dicter : c'est la phrase de `.comp` dans la maquette.
         */}
        <MalicaChat tenantId={pme.tenantId} placeholder={TEXTES.composer} />

        {/*
         * ------------------------------------------------- la suite du fil
         *
         * « Un fil porte toujours sa suite. Le dernier état est une action,
         * jamais un cul-de-sac. » Ici, la suite est verrouillée, et une carte
         * verrouillée dit ce qu'elle ferait — exactement comme les cartes
         * `.lock` de l'accueil. Ce qui manque pour la déverrouiller est nommé
         * en tête de ce fichier : `conseil.creer`, au contrat, absent du port.
         *
         * Rien n'est rendu tant qu'on ne sait pas : pendant le chargement et
         * en cas d'échec, l'écran se tait plutôt que d'annoncer « aucun
         * cabinet » à un dossier qui en a un, ou d'offrir à un siège la carte
         * du propriétaire avant que son rôle soit revenu.
         */}
        {conseil.isPending || conseil.isError || acces.isPending ? null : (
          <div className="esc off">
            <span className="av">{siege ? "·" : initiales(cabinetNom)}</span>
            <span className="bd">
              <b>
                {siege
                  ? TEXTES.suiteTransmission
                  : aUnCabinet
                    ? cabinetNom
                      ? TEXTES.suiteAvis(cabinetNom)
                      : TEXTES.suiteAvisSansNom
                    : TEXTES.suiteSansCabinet}
              </b>
              <span>
                {siege || aUnCabinet ? TEXTES.suitePasEncore : TEXTES.suiteSansCabinetDetail}
              </span>
            </span>
          </div>
        )}

        {/*
         * Le pied, mot pour mot du dessin. Il ne dépend d'aucune lecture :
         * c'est la règle du produit, et elle vaut avant la première question.
         *
         * Le rôle ne change pas cette phrase — elle vaut pour le dirigeant
         * comme pour le siège.
         */}
        <p className="foot">{TEXTES.pied}</p>
      </div>
    </div>
  );
}

/**
 * Les initiales d'un cabinet, pour la pastille de `.esc .av`.
 *
 * Deux lettres au plus — c'est ce que la pastille de 30 px tient en 10 px de
 * corps. Sans nom, un point médian : il occupe la place sans rien affirmer, là
 * où un « ? » demanderait une réponse que personne n'a.
 */
function initiales(nom: string | null): string {
  if (!nom) return "·";
  const mots = nom
    .split(/[\s-]+/)
    .map((m) => m.trim())
    .filter((m) => m.length > 0);
  if (mots.length === 0) return "·";
  return mots
    .slice(0, 2)
    .map((m) => m.charAt(0).toLocaleUpperCase("fr"))
    .join("");
}
