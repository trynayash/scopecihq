import type { Request, Response, NextFunction } from "express";

/**
 * Standard OWASP Recommended Security Headers
 * Protects against MIME-sniffing, clickjacking, insecure transports, and cross-site scripting.
 */
export function securityHeaders() {
  return (_req: Request, res: Response, next: NextFunction): void => {
    // Prevent MIME type sniffing
    res.setHeader("X-Content-Type-Options", "nosniff");

    // Prevent clickjacking / framing
    res.setHeader("X-Frame-Options", "DENY");

    // Enforce HTTPS in supporting browsers
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");

    // Referrer policy
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

    // Permissions policy disabling sensitive browser features
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

    // Content Security Policy
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' https: data:; connect-src 'self' https:; frame-ancestors 'none';"
    );

    // Cross-origin policies
    res.setHeader("X-XSS-Protection", "0"); // Deprecated in modern browsers, disabled in favor of CSP

    next();
  };
}
