/**
 * Ce que le modèle écrit parfois dans son texte et qui n'est pas pour la
 * personne — relevé sur le vrai modèle, le 11 novembre 2026 :
 *
 *   - les marques de passage du conseil cité (« [S1] », « [S2] »), recopiées
 *     depuis le texte que l'outil lui a rendu ;
 *   - sa conclusion écrite en clair au lieu d'être un appel d'outil
 *     (« <conclure_reponse>… » ou « {"conseil": true, … } ») : elle nomme un
 *     outil et n'a rien à faire à l'écran.
 *
 * Le filtre travaille au fil du flux, avant la garde des chiffres : une marque
 * disparaît, et tout ce qui suit le début d'une conclusion en clair est coupé
 * jusqu'à la fin du tour. Une fin de morceau qui pourrait être le début d'une
 * marque attend le morceau suivant.
 *
 * Pur : aucun réseau, aucune base.
 */

const MARQUE = /\[S\d{1,3}\]/g;
const CONCLUSION = /<\/?\s*conclure_reponse|\{\s*"conseil"\s*:/;
/** La fin d'un morceau qui peut encore devenir une marque ou une conclusion. */
const DEBUT_POSSIBLE = /(?:\[S?\d{0,3}|<\/?\s*[a-z_]{0,17}|\{\s*(?:"[a-z]{0,7}"?\s*)?)$/;

export class FiltreDeMecanique {
  private attente = "";
  private coupe = false;

  /** Un morceau de texte du modèle ; rend ce qui peut continuer vers la garde. */
  passer(delta: string): string {
    if (this.coupe) return "";
    let texte = this.attente + delta;
    this.attente = "";
    const conclusion = CONCLUSION.exec(texte);
    if (conclusion) {
      this.coupe = true;
      return texte.slice(0, conclusion.index).replace(MARQUE, "").trimEnd();
    }
    const debut = DEBUT_POSSIBLE.exec(texte);
    if (debut && debut[0].length > 0) {
      this.attente = debut[0];
      texte = texte.slice(0, debut.index);
    }
    return texte.replace(MARQUE, "");
  }

  /** La fin d'un bloc de texte : ce qui attendait n'était pas une marque. */
  vider(): string {
    const reste = this.coupe ? "" : this.attente.replace(MARQUE, "");
    this.attente = "";
    return reste;
  }
}
