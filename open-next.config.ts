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
export default defineCloudflareConfig();
