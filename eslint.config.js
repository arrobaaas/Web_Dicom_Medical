import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["js/vendor/**", "node_modules/**", "coverage/**"],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      // Parámetros que empiezan por "_" se ignoran a propósito (p. ej. callbacks).
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      eqeqeq: ["error", "always"],
      "prefer-const": "error",
    },
  },
  {
    files: ["tests/**/*.js", "*.config.js"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
];
