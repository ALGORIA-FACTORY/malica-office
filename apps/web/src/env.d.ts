/**
 * Les variables de compilation que le code lit par leur nom.
 *
 * Vite ne remplace `import.meta.env.X` par sa valeur que sous cette forme
 * pointée : `import.meta.env["X"]` reste une lecture dans un objet, que le
 * minificateur ne plie pas — et la branche que l'on voulait retirer du
 * paquet y reste. Déclarer la variable ici permet la forme pointée.
 */
interface ImportMetaEnv {
  /** `coque` dans le bundle embarqué par l'application Android ; absent sur le web. */
  readonly VITE_CIBLE?: string;
}
