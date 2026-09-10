import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

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
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
