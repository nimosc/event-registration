import posthog from "posthog-js";

// PostHog analytics — initialized on every page load in the browser.
// No key configured (e.g. local dev without .env) → analytics silently off.
if (process.env.NEXT_PUBLIC_POSTHOG_KEY) {
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
    // Requests go through our own domain (/ingest rewrite in next.config.ts)
    // so ad-blockers don't drop the events.
    api_host: "/ingest",
    ui_host: process.env.NEXT_PUBLIC_POSTHOG_HOST?.replace(".i.posthog.com", ".posthog.com"),
    defaults: "2025-05-24",
    capture_exceptions: true,
  });
}
