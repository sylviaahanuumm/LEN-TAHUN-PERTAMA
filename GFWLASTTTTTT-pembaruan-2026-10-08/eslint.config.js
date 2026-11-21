import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", ".output", ".vinxi"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      // M-060: sintaks JavaScript terbaru (proyek memakai ??=, top-level await, dll., yang tidak dikenal ES2020).
      ecmaVersion: "latest",
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
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // M-062: variabel/import yang tidak terpakai dilaporkan sebagai peringatan (bukan dimatikan total). Nama berawalan
      // "_" sengaja dibiarkan, untuk parameter yang memang wajib ada tetapi tidak dipakai.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },
  {
    // M-061: kode yang berjalan di server (TanStack Start: *.server.ts, server.ts, start.ts, rute api) memakai variabel
    // global Node.js (process, Buffer, ...), jadi globals Node ditambahkan untuk file-file itu.
    files: ["**/*.server.{ts,tsx}", "src/server.ts", "src/start.ts", "src/routes/api/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  eslintPluginPrettier,
);
