import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

import { securityHeaders } from "./middlewares/security-headers";

const app: Express = express();

// Render and Vercel each put one proxy in front of the app. Trusting exactly
// that hop makes `req.ip` the address the proxy saw, rather than whatever the
// client wrote into X-Forwarded-For (which would let anyone dodge the rate
// limiter by sending a fresh header per request). Set TRUST_PROXY_HOPS if the
// deployment adds another proxy, such as a CDN in front of Render.
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS ?? 1));

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

// Unknown API paths answer in JSON, like every other API response, instead of
// Express's HTML "Cannot GET" page.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found." });
});

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

/** Postgres and network codes that mean the database is unreachable or busy, not that the query was wrong. */
const DATABASE_UNAVAILABLE = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "57P01", // admin shutdown
  "57P02", // crash shutdown
  "57P03", // cannot connect now
  "53300", // too many connections
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  // A database TLS setup that doesn't verify (see DATABASE_CA_CERT).
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

function databaseUnavailable(err: any): boolean {
  for (let e = err, depth = 0; e && depth < 4; e = e.cause, depth++) {
    if (DATABASE_UNAVAILABLE.has(e.code)) return true;
    if (typeof e.message === "string" && /Connection terminated|timeout exceeded when trying to connect/i.test(e.message)) return true;
  }
  return false;
}

/**
 * Last-resort error handler. Without it, a malformed JSON body or a rejected
 * CORS origin reaches Express's default handler, which answers 500 with an
 * HTML page (and a stack trace outside production). Outages the person can
 * do nothing about but wait (the database, GitHub) say so, with a 503 or 502
 * and a time to try again, instead of a bare "something went wrong".
 */
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: "Request body is not valid JSON." });
    return;
  }
  if (err?.type === "entity.too.large") {
    res.status(413).json({ error: "Request body is too large." });
    return;
  }
  if (typeof err?.message === "string" && err.message.startsWith("CORS origin not allowed")) {
    res.status(403).json({ error: "Origin not allowed." });
    return;
  }
  // GitHub first: its network failures carry the same codes as the database's.
  if (err?.name === "GitHubApiError") {
    (req.log ?? logger).warn({ err }, "GitHub request failed");
    if (err.rateLimited) {
      if (err.retryAfter) res.setHeader("Retry-After", String(err.retryAfter));
      res.status(503).json({ error: "GitHub is limiting requests right now. Try again in a minute." });
    } else if (err.status === 403) {
      res.status(502).json({ error: "GitHub refused the request. Check the ScopeCI App's access to this repository on GitHub, then try again." });
    } else {
      res.status(502).json({ error: "GitHub didn't answer properly. Try again in a minute." });
    }
    return;
  }
  if (databaseUnavailable(err)) {
    (req.log ?? logger).error({ err }, "Database unavailable");
    res.setHeader("Retry-After", "30");
    res.status(503).json({ error: "ScopeCI can't reach its database right now. Try again in a minute." });
    return;
  }
  // Express couldn't decode a path parameter: a mangled link such as /api/invites/abc%zz.
  if (err instanceof URIError) {
    (req.log ?? logger).warn({ err }, "Malformed request path");
    res.status(400).json({ error: "That link isn't valid. Check it and try again." });
    return;
  }
  // The client's own mistake, as Express and body-parser report it: an unsupported
  // charset or encoding (415), an aborted or short body (400). Only errors marked
  // `expose`, so a status some library put on its own error is never passed on.
  const status = err?.status ?? err?.statusCode;
  if (err?.expose === true && Number.isInteger(status) && status >= 400 && status < 500) {
    (req.log ?? logger).warn({ err }, "Rejected request");
    const message =
      status === 415
        ? "Send the request as JSON in UTF-8."
        : status === 404
          ? "Not found."
          : "The request couldn't be read. Check it and try again.";
    res.status(status).json({ error: message });
    return;
  }
  (req.log ?? logger).error({ err }, "Unhandled request error");
  res.status(500).json({ error: "Something went wrong on our side. Try again in a moment." });
});

export default app;
