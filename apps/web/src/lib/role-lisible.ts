/** Le rôle d'une personne dans un dossier de PME, dit en mots ; un rôle inconnu garde son code. */
import type { MessageKey } from "@/i18n";

export function roleLisible(code: string, t: (k: MessageKey) => string): string {
  if (code === "dirigeant") return t("pme.membres.role.dirigeant");
  if (code === "collaborateur") return t("pme.membres.role.collaborateur");
  if (code === "comptable") return t("pme.membres.role.comptable");
  return code;
}
