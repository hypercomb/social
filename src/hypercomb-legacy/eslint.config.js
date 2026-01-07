import tseslint from "@typescript-eslint/eslint-plugin";
import parser from "@typescript-eslint/parser";
import unusedImports from "eslint-plugin-unused-imports";

export default [
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser
    },
    plugins: {
      "@typescript-eslint": tseslint,
      "unused-imports": unusedImports
    },
    rules: {
      // enforce no semicolons at end of statements
      semi: ["error", "never"],

      // catch accidental double semicolons (;;)
      "no-extra-semi": "error",

      // remove unused imports automatically
      "unused-imports/no-unused-imports": "error",

      // auto-fix unused vars/args → _ctx, _td, etc.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          vars: "all",
          args: "after-used",
          ignoreRestSiblings: true,
          argsIgnorePattern: "^_"
        }
      ]
    }
  }
]
