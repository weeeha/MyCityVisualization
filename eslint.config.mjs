import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Gitignored, vendored/generated local content — never project source
    // (see .gitignore: "Large local datasets ... never commit").
    "data/**",
  ]),
  {
    files: ['src/shell/**/*.{ts,tsx}', 'src/map/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          // '*' catches a bare barrel import (e.g. '@/src/layers/air'),
          // '**' catches deeper paths (e.g. '@/src/layers/air/fetchPayload').
          // registry.ts and types.ts are the sanctioned crossing points and
          // are re-permitted via negation (gitignore-style, evaluated in
          // order — see the `ignore` package no-restricted-imports uses).
          group: [
            '@/src/layers/*', '@/src/layers/**',
            '!@/src/layers/registry', '!@/src/layers/types',
            '../layers/*', '../layers/**',
            '!../layers/registry', '!../layers/types',
            './layers/*', './layers/**',
            '!./layers/registry', '!./layers/types',
          ],
          message:
            'shell and map must not import specific layers — use registry.ts or types.ts. ' +
            'See spec §3: deleting a layer folder must not break the app.',
        }],
      }],
    },
  },
]);

export default eslintConfig;
