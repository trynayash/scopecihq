import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

import { securityHeaders } from "./middlewares/security-headers";

const app: Express = express();

// OWASP Security Headers (HSTS, CSP, X-Frame-Options, X-Content-Type-Options)
app.use(securityHeaders());

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Restricted CORS Allowlist
const allowedOrigins: string[] = [
  "http://localhost:3000",
  "http://localhost:5000",
  "http://localhost:5173",
  "http://localhost:5174",
];

if (process.env.APP_BASE_URL) {
  try {
    allowedOrigins.push(new URL(process.env.APP_BASE_URL).origin);
  } catch {}
}
if (process.env.NEXT_PUBLIC_MARKETING_URL) {
  try {
    allowedOrigins.push(new URL(process.env.NEXT_PUBLIC_MARKETING_URL).origin);
  } catch {}
}

// Per-request wrapper so we can reflect same-origin asset loads. Vite tags
// production module scripts with `crossorigin`, so the browser sends Origin
// even for same-origin /assets/* requests — without this, those 500 when
// APP_BASE_URL isn't on the allowlist and the SPA stays a blank page.
app.use((req, res, next) => {
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (curl, server-to-server, webhooks)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin) || process.env.NODE_ENV !== "production") {
        return callback(null, true);
      }

      try {
        const originHost = new URL(origin).host;
        const requestHost = req.headers.host?.split(",")[0]?.trim();
        if (requestHost && originHost === requestHost) {
          return callback(null, true);
        }
      } catch {
        // fall through
      }

      return callback(new Error(`CORS origin not allowed: ${origin}`));
    },
    credentials: true,
  })(req, res, next);
});

app.use(
  express.json({
    limit: "1mb",
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

app.use("/api", router);

/**
 * Serves the built SPA (artifacts/scopeci/dist/public) from the same origin
 * as the API, so the site's relative `fetch("/api/...")` calls work with no
 * CORS or reverse-proxy configuration — one process, one deploy, one URL.
 *
 * `import.meta.url` is resolved at runtime, so this points at wherever the
 * bundled dist/index.mjs actually sits, not the pre-bundle source location.
 * Only enabled when a build is present, so the API still runs standalone in
 * local dev without requiring the frontend to be built first.
 */
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(currentDir, "..", "..", "scopeci", "dist", "public");

if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));

  // SPA fallback: a GET that isn't an API route or a real static file (e.g. a
  // direct visit to /privacy, or a hard refresh) resolves to index.html, and
  // client-side routing takes it from there.
  //
  // Requests that look like static assets (paths with a file extension, e.g.
  // /assets/index-CRuTf4yf.css) are NOT caught here. If express.static()
  // didn't find them, they must 404 — serving index.html with Content-Type
  // text/html for a missing .css file causes the MIME-type error the browser
  // reports. Anything else — an unmatched /api/* route, a non-GET request —
  // also falls through to Express's own 404.
  app.use((req, res, next) => {
    if (req.method === "GET" && !req.path.startsWith("/api/")) {
      // If the path has a file extension (e.g. .js, .css, .png, .woff2),
      // it's a static asset miss — let it 404 with the correct status code.
      const hasExtension = /\.\w{2,10}$/.test(req.path);
      if (hasExtension) {
        next();
        return;
      }
      res.sendFile(path.join(publicDir, "index.html"));
      return;
    }
    next();
  });
} else {
  logger.warn({ publicDir }, "Frontend build not found; serving API only.");
}

export default app;
