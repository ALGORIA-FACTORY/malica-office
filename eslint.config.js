import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", ".output", ".vinxi", "android", ".stockage", "**/.tanstack"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      /*
       * Un contexte vit avec son hook (`useCabinet` à côté de `CabinetProvider`) :
       * c'est le même module, la même responsabilité. Le rechargement à chaud
       * y perd seulement la finesse d'un composant ; il ne casse rien.
       */
      "react-refresh/only-export-components": [
        "warn",
        {
          allowConstantExport: true,
          allowExportNames: ["useCabinet", "useMalicaPanel", "usePme", "useI18n", "localeRangee"],
        },
      ],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  /*
   * ================= UN IDENTIFIANT MACHINE NE S'AFFICHE PAS À UNE PERSONNE
   *
   * Le 4 octobre 2026, une PME a lu « ISSUER » sous la photo de sa facture, en
   * capitales anglaises. La cause tenait en une ligne de JSX :
   *
   *     <span className="num ms-auto text-[11px] uppercase …">{zoom.field}</span>
   *
   * `zoom.field` est le chemin machine dans l'extraction. Le traducteur de
   * chemins — `libelleDuChamp` — était écrit, testé, et utilisé par l'écran du
   * cabinet ; il n'était pas importé par celui de la PME.
   *
   * Le diagnostic a relevé que RIEN ne l'interdisait : les deux seules épreuves
   * d'i18n couvrent les sept statuts de la base et la sélection de pluriel, la
   * parité des clés est tenue par le compilateur, et `eslint.config.js` n'avait
   * aucun `no-restricted-syntax`. C'est la dette D42, et voici sa fermeture.
   *
   * La règle vise les deux propriétés pour lesquelles un traducteur existe —
   * `field` (par `libelleDuChamp`) et `status` / `statut` (par les clés
   * `pme.status.*`, déjà verrouillées par `statuts-traduits.test.ts`). Elle
   * n'attrape volontairement PAS `code` : certains codes sont du vocabulaire
   * que la personne reconnaît et attend, comme « TVA19 » sur une ligne de
   * facture. Interdire sans distinction aurait fait ajouter des dérogations
   * partout, et une règle qu'on contourne n'enseigne plus rien.
   */
  {
    files: ["apps/web/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          /*
           * Les ENFANTS affichés, pas les attributs : `value={form.status}`
           * sur un `<select>` est légitime, et la première version de cette
           * règle le refusait. Une règle qui crie à tort se fait désactiver.
           */
          selector:
            ":matches(JSXElement, JSXFragment) > JSXExpressionContainer > MemberExpression[property.name=/^(field|status|statut)$/]",
          message:
            "Un identifiant machine ne s'affiche pas à une personne : passez par libelleDuChamp(chemin, t) pour un champ, ou par la clé pme.status.* pour un statut. Une PME a lu « ISSUER » sous sa facture le 4 octobre 2026 (D42).",
        },
      ],
    },
  },
  eslintPluginPrettier,
);
