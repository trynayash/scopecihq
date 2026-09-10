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

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, server-to-server, webhooks)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin) || process.env.NODE_ENV !== "production") {
        return callback(null, true);
      }
      return callback(new Error(`CORS origin not allowed: ${origin}`));
    },
    credentials: true,
  })
);

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
  // client-side routing takes it from there. Anything else — an unmatched
  // /api/* route, a non-GET request — falls through to Express's own 404.
  app.use((req, res, next) => {
    if (req.method === "GET" && !req.path.startsWith("/api/")) {
      res.sendFile(path.join(publicDir, "index.html"));
      return;
    }
    next();
  });
} else {
  logger.warn({ publicDir }, "Frontend build not found; serving API only.");
}

export default app;
