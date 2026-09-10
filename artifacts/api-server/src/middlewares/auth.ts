import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { organizationsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

/**
 * Constant-time comparison to prevent timing attacks.
 */
export function timingSafeCompare(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");
  if (bufA.length !== bufB.length) {
    // Perform dummy comparison to keep time relatively consistent
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export interface AuthenticatedRequest extends Request {
  caller?: {
    organizationId?: string;
    role?: string;
    authenticated: boolean;
  };
}

/**
 * Authentication middleware for integration and API routes.
 * Supports:
 * - Bearer tokens (Authorization: Bearer <token>)
 * - Direct API keys (x-api-key or x-scopeci-key)
 * - Tenant session headers (x-organization-id with valid secret)
 */
export function requireApiKeyOrSession(options: { allowAnonymousInDev?: boolean } = {}) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const configuredSecret = process.env.SCOPECI_API_KEY || process.env.ADMIN_SECRET;
    const authHeader = req.headers["authorization"];
    const apiKeyHeader = (req.headers["x-api-key"] || req.headers["x-scopeci-key"]) as string | undefined;

    let providedToken: string | undefined;

    if (authHeader?.startsWith("Bearer ")) {
      providedToken = authHeader.slice(7).trim();
    } else if (apiKeyHeader) {
      providedToken = apiKeyHeader.trim();
    }

    // In production, token is strictly required
    if (process.env.NODE_ENV === "production" || configuredSecret) {
      if (!providedToken || !configuredSecret || !timingSafeCompare(providedToken, configuredSecret)) {
        res.status(401).json({
          error: "Unauthorized",
          message: "A valid ScopeCI API key or Bearer token is required.",
        });
        return;
      }
    } else if (!options.allowAnonymousInDev && !providedToken) {
      // Dev mode without token
      res.status(401).json({
        error: "Unauthorized",
        message: "Authentication credentials required.",
      });
      return;
    }

    // Populate caller
    const tenantHeader = (req.headers["x-organization-id"] as string) || req.body?.organizationId;
    req.caller = {
      organizationId: tenantHeader,
      authenticated: true,
    };

    next();
  };
}

/**
 * Tenant ownership middleware.
 * Verifies that the requested organization exists in the database and that
 * any authenticated caller is authorized for that organization.
 */
export function requireTenantAccess(getOrgId?: (req: Request) => string | undefined) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const requestedOrgId = getOrgId
      ? getOrgId(req)
      : (req.params.organizationId || req.body?.organizationId || (req.headers["x-organization-id"] as string));

    if (!requestedOrgId) {
      res.status(400).json({
        error: "Bad Request",
        message: "organizationId is required.",
      });
      return;
    }

    // UUID format check to prevent injection
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(requestedOrgId)) {
      res.status(400).json({
        error: "Bad Request",
        message: "Invalid organizationId format.",
      });
      return;
    }

    // If caller has a bound organizationId, enforce cross-tenant separation
    if (req.caller?.organizationId && req.caller.organizationId !== requestedOrgId) {
      res.status(403).json({
        error: "Forbidden",
        message: "Access denied: cross-tenant access is prohibited.",
      });
      return;
    }

    // Verify organization exists in database
    const org = await db.query.organizationsTable.findFirst({
      where: eq(organizationsTable.id, requestedOrgId),
    });

    if (!org) {
      res.status(404).json({
        error: "Not Found",
        message: "Organization not found.",
      });
      return;
    }

    next();
  };
}
