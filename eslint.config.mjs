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
    // Generated Cloudflare bundle: 36MB of transpiled output that ESLint
    // otherwise walks and runs out of memory on.
    ".open-next/**",
    ".wrangler/**",
    "cloudflare-env.d.ts",
  ]),
]);

export default eslintConfig;
