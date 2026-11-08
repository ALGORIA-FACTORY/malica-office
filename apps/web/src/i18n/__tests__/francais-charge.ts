/**
 * Avant chaque fichier d'épreuves : le dictionnaire français, base et espaces.
 *
 * Il ne vit plus dans le paquet initial (`i18n/dictionnaires.ts`) : le
 * navigateur l'attend avant l'hydratation, un espace avant son premier écran,
 * le serveur avant sa première page. Les épreuves montent leurs composants
 * sans rien de tout cela ; elles l'attendent ici, comme le ferait
 * l'application.
 */
import { chargerLesEspaces } from "../dictionnaires";

await chargerLesEspaces("fr");
