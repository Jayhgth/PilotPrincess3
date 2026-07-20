import { defineMiddleware } from "astro:middleware";

function supabaseConnectSources() {
  try {
    const origin = new URL(import.meta.env.PUBLIC_SUPABASE_URL).origin;
    return [origin, origin.replace(/^https:/, "wss:")];
  } catch {
    return [];
  }
}

const CONNECT_SOURCES = [
  "'self'",
  ...supabaseConnectSources(),
  ...(import.meta.env.DEV
    ? ["http://127.0.0.1:*", "ws://127.0.0.1:*", "http://localhost:*", "ws://localhost:*"]
    : [])
];

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https:",
  `connect-src ${CONNECT_SOURCES.join(" ")}`,
  "worker-src 'self' blob:"
].join("; ");

export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();
  const headers = response.headers;
  headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set("Origin-Agent-Cluster", "?1");
  headers.set("X-Permitted-Cross-Domain-Policies", "none");
  if (import.meta.env.PROD && context.url.protocol === "https:") {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  if (context.url.pathname.startsWith("/app") || context.url.pathname.startsWith("/api/") || context.url.pathname.startsWith("/auth/") || context.url.pathname.startsWith("/reset-password")) {
    headers.set("Cache-Control", "no-store");
  }
  return response;
});
