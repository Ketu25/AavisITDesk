import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * No incremental cache override.
 *
 * The adapter's default template wires up an R2 bucket for ISR, but this app
 * has no incrementally-cached routes: the root layout reads the theme cookie
 * and every page sits behind authentication, so `next build` marks all 40
 * routes as server-rendered on demand. An R2 binding would only add a resource
 * that has to exist before every deploy.
 */
export default {
  ...defineCloudflareConfig(),

  /**
   * Build Next with `build:next`, not the package's `build` script.
   *
   * OpenNext shells out to the app's build command, and with npm it defaults
   * to `npm run build` (see @opennextjs/aws/dist/build/buildNextApp.js). Our
   * `build` script *is* `opennextjs-cloudflare build`, deliberately — Cloudflare
   * Workers Builds defaults its build command to `npm run build`, and pointing
   * that at plain `next build` produced no `.open-next/worker.js`, so the
   * deploy step failed on every push. Leaving this unset would make OpenNext
   * re-enter our `build` script and recurse forever.
   */
  buildCommand: "npm run build:next",
};
