/**
 * La rafale : combien de questions une personne pose dans la minute.
 *
 * Le quota du jour se compte en base, sur les questions rangées au fil
 * (`assistant_debit_exiger`). La rafale, elle, ne peut pas s'y compter : dix
 * appels lancés ensemble ne sont pas encore rangés quand le onzième arrive.
 * Elle se compte donc ici, en mémoire du serveur d'application, par personne.
 * La borne (questions par minute) vient de la base à chaque appel (R4) : ce
 * module ne porte aucun chiffre.
 *
 * Un seul processus sert l'API aujourd'hui (`infra/compose.yml`). Le jour où
 * il y en aura plusieurs, chacun comptera sa part : la borne réelle sera la
 * borne réglée multipliée par leur nombre — à déplacer alors en base.
 */

const FENETRE_MS = 60_000;
/** Au-delà de ce nombre de personnes suivies, on balaie celles qui n'ont plus rien dans la minute. */
const BALAYAGE = 5_000;

export class Rafale {
  private readonly parPersonne = new Map<string, number[]>();

  /** Admet la question et la compte, ou la refuse si la minute est pleine. */
  admettre(personne: string, parMinute: number, maintenant: number = Date.now()): boolean {
    const depuis = maintenant - FENETRE_MS;
    const recentes = (this.parPersonne.get(personne) ?? []).filter((t) => t > depuis);
    if (recentes.length >= parMinute) {
      this.parPersonne.set(personne, recentes);
      return false;
    }
    recentes.push(maintenant);
    this.parPersonne.set(personne, recentes);
    if (this.parPersonne.size > BALAYAGE) this.balayer(depuis);
    return true;
  }

  private balayer(depuis: number): void {
    for (const [personne, instants] of this.parPersonne) {
      if (!instants.some((t) => t > depuis)) this.parPersonne.delete(personne);
    }
  }
}
