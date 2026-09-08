import js from "@eslint/js"
import tseslint from "typescript-eslint"

export default [
  {
    ignores: [
      ".next/**",
      ".next-smoke/**",
      ".validation/**",
      "node_modules/**",
      "coverage/**",
      "playwright-report/**",
      "public/**",
      "ai_services/**",
    ],
  },
  js.configs.recommended,
  {
    rules: {
      "no-undef": "off",
    },
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,js,jsx}"],
    languageOptions: {
      globals: {
        React: "readonly",
        JSX: "readonly",
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        console: "readonly",
        process: "readonly",
        fetch: "readonly",
        Request: "readonly",
        Response: "readonly",
        crypto: "readonly",
        URL: "readonly",
        Image: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        alert: "readonly",
        confirm: "readonly",
        File: "readonly",
        FormData: "readonly",
        Headers: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "warn",
      "no-unused-vars": "off",
      "no-undef": "off",
    },
  },
]
