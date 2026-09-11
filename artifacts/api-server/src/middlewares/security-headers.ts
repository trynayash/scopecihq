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
    // Google Fonts requires:
    //   style-src-elem  → https://fonts.googleapis.com  (stylesheet)
    //   font-src        → https://fonts.gstatic.com     (woff2 files)
    // All other external origins remain blocked.
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "img-src 'self' data: https:",
        "font-src 'self' https://fonts.gstatic.com data:",
        "connect-src 'self' https:",
        "frame-ancestors 'none'",
      ].join("; ") + ";"
    );

    // Cross-origin policies
    res.setHeader("X-XSS-Protection", "0"); // Deprecated in modern browsers, disabled in favor of CSP

    next();
  };
}
