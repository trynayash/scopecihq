import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { appSettingsTable } from "@workspace/db/schema";
import { decryptToken, encryptToken, type EncryptedPayload } from "../linear/crypto.js";
import { logger } from "../lib/logger.js";
import { normalisePrivateKey } from "./app-client.js";
import { API_HEADERS, gitHubApiUrl, gitHubRequest } from "./github-http.js";

/**
 * Where the GitHub App's credentials come from. Each one can be set in the
 * environment (GITHUB_APP_ID and friends, as in docs/github-app.md); anything
 * not set there comes from the App created on the admin page, which is stored
 * encrypted in `app_settings`.
 */

const KEY_ENV = "GITHUB_TOKEN_ENCRYPTION_KEY";
const APP_KEY = "github_app";
const SETUP_KEY = "github_app_setup";
const CACHE_MS = 30_000;
const SETUP_TTL_MS = 60 * 60 * 1000; // GitHub's manifest codes last an hour too

export interface GitHubAppSettings {
  appId?: string;
  slug?: string;
  clientId?: string;
  clientSecret?: string;
  privateKey?: string;
  webhookSecret?: string;
  /** Where the App's settings live on GitHub; only known for an App made on the admin page. */
  htmlUrl?: string;
  owner?: string;
  source: "environment" | "admin" | null;
  /**
   * An App made on the admin page is saved but can't be decrypted (most likely
   * GITHUB_TOKEN_ENCRYPTION_KEY changed). Restoring the key brings it back;
   * creating another App would make every customer install that one instead.
   */
  storedUnreadable?: { slug: string; owner: string; htmlUrl: string };
}

interface StoredApp {
  appId: string;
  slug: string;
  name: string;
  owner: string;
  htmlUrl: string;
  clientId: string;
  clientSecret: EncryptedPayload;
  privateKey: EncryptedPayload;
  webhookSecret: EncryptedPayload;
  createdAt: string;
}

type DecryptedApp = Omit<StoredApp, "clientSecret" | "privateKey" | "webhookSecret"> & {
  clientSecret: string;
  privateKey: string;
  webhookSecret: string;
};

type Cached = { at: number; app: DecryptedApp | null; unreadable?: GitHubAppSettings["storedUnreadable"] };

let cache: Cached | undefined;

/** Drops the cached App, so the next request reads what was just saved or removed. */
export function forgetGitHubAppSettings(): void {
  cache = undefined;
}

async function storedApp(): Promise<Cached> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache;
  const row = await db.query.appSettingsTable.findFirst({ where: eq(appSettingsTable.key, APP_KEY) });
  let app: DecryptedApp | null = null;
  let unreadable: GitHubAppSettings["storedUnreadable"];
  if (row) {
    const stored = row.valueJson as StoredApp;
    try {
      app = {
        ...stored,
        clientSecret: decryptToken(stored.clientSecret, KEY_ENV),
        privateKey: decryptToken(stored.privateKey, KEY_ENV),
        webhookSecret: decryptToken(stored.webhookSecret, KEY_ENV),
      };
    } catch (err) {
      // Most likely GITHUB_TOKEN_ENCRYPTION_KEY changed since the App was saved.
      unreadable = { slug: stored.slug ?? "", owner: stored.owner ?? "", htmlUrl: stored.htmlUrl ?? "" };
      logger.error(
        { err, slug: stored.slug },
        "The stored GitHub App can't be decrypted. Restore the GITHUB_TOKEN_ENCRYPTION_KEY it was saved with: a new App would need every customer to install it again",
      );
    }
  }
  cache = { at: Date.now(), app, unreadable };
  return cache;
}

export async function gitHubAppSettings(): Promise<GitHubAppSettings> {
  const env = process.env;
  let stored: DecryptedApp | null = null;
  let storedUnreadable: GitHubAppSettings["storedUnreadable"];
  try {
    ({ app: stored, unreadable: storedUnreadable } = await storedApp());
  } catch (err) {
    logger.warn({ err }, "Couldn't read the stored GitHub App");
  }
  return {
    appId: env.GITHUB_APP_ID || stored?.appId,
    slug: env.GITHUB_APP_SLUG || stored?.slug,
    clientId: env.GITHUB_CLIENT_ID || stored?.clientId,
    clientSecret: env.GITHUB_CLIENT_SECRET || stored?.clientSecret,
    privateKey: env.GITHUB_APP_PRIVATE_KEY ? normalisePrivateKey(env.GITHUB_APP_PRIVATE_KEY) : stored?.privateKey,
    webhookSecret: env.GITHUB_WEBHOOK_SECRET || stored?.webhookSecret,
    htmlUrl: stored?.htmlUrl,
    owner: stored?.owner,
    source: env.GITHUB_APP_ID ? "environment" : stored ? "admin" : null,
    storedUnreadable,
  };
}

/** Production keeps secrets only under a real key; elsewhere the test key will do. */
export function encryptionReady(): boolean {
  return process.env.NODE_ENV !== "production" || Boolean(process.env[KEY_ENV]);
}

/* ------------------------------------------------------------------ */
/* Creating the App from a manifest                                    */
/* ------------------------------------------------------------------ */

const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

/**
 * The App ScopeCI needs, in GitHub's manifest format: the same settings
 * docs/github-app.md lists for registering it by hand.
 */
export function appManifest(name: string, origin: string) {
  return {
    name,
    url: origin,
    description: "Checks each pull request against the client's signed scope and flags work that needs a change order.",
    public: true,
    hook_attributes: { url: `${origin}/api/webhooks/github`, active: true },
    redirect_url: `${origin}/api/setup/github-app/callback`,
    callback_urls: [`${origin}/api/auth/github/callback`],
    setup_url: `${origin}/app`,
    setup_on_update: true,
    request_oauth_on_install: false,
    default_events: ["pull_request"],
    default_permissions: { pull_requests: "write", checks: "write", contents: "read", metadata: "read" },
  };
}

/** Starts a setup: returns the one-time `state` GitHub hands back with the code. */
export async function beginAppSetup(): Promise<string> {
  const state = crypto.randomBytes(24).toString("base64url");
  const value = { stateHash: hash(state), expiresAt: Date.now() + SETUP_TTL_MS };
  await db
    .insert(appSettingsTable)
    .values({ key: SETUP_KEY, valueJson: value })
    .onConflictDoUpdate({ target: appSettingsTable.key, set: { valueJson: value, updatedAt: new Date() } });
  return state;
}

/**
 * True once for the state of the setup in progress; using it ends that setup.
 * Only the matching state removes it: the callback is public, and a made-up
 * state must not cancel an admin's setup halfway through on GitHub.
 */
export async function claimAppSetup(state: string): Promise<boolean> {
  const [row] = await db
    .delete(appSettingsTable)
    .where(and(eq(appSettingsTable.key, SETUP_KEY), sql`${appSettingsTable.valueJson}->>'stateHash' = ${hash(state)}`))
    .returning({ valueJson: appSettingsTable.valueJson });
  const pending = row?.valueJson as { expiresAt?: number } | undefined;
  return Boolean(pending?.expiresAt && pending.expiresAt >= Date.now());
}

/** Swaps the code GitHub sends back for the new App's credentials, and keeps them. */
export async function completeAppSetup(code: string): Promise<{ slug: string; htmlUrl: string }> {
  const { data } = await gitHubRequest<{
    id: number;
    slug: string;
    name: string;
    owner?: { login?: string };
    html_url: string;
    client_id: string;
    client_secret: string;
    webhook_secret: string;
    pem: string;
  }>(`${gitHubApiUrl()}/app-manifests/${encodeURIComponent(code)}/conversions`, {
    method: "POST",
    headers: API_HEADERS,
  });
  if (!data?.id || !data.pem || !data.webhook_secret || !data.client_secret) {
    throw new Error("GitHub's answer was missing the App's credentials");
  }

  const app: StoredApp = {
    appId: String(data.id),
    slug: data.slug,
    name: data.name,
    owner: data.owner?.login ?? "",
    htmlUrl: data.html_url,
    clientId: data.client_id,
    clientSecret: encryptToken(data.client_secret, "v1", KEY_ENV),
    privateKey: encryptToken(data.pem, "v1", KEY_ENV),
    webhookSecret: encryptToken(data.webhook_secret, "v1", KEY_ENV),
    createdAt: new Date().toISOString(),
  };
  await db
    .insert(appSettingsTable)
    .values({ key: APP_KEY, valueJson: app })
    .onConflictDoUpdate({ target: appSettingsTable.key, set: { valueJson: app, updatedAt: new Date() } });
  forgetGitHubAppSettings();
  return { slug: app.slug, htmlUrl: app.htmlUrl };
}

/** Forgets the App made on the admin page. It stays registered on GitHub until deleted there. */
export async function removeStoredApp(): Promise<boolean> {
  const removed = await db
    .delete(appSettingsTable)
    .where(eq(appSettingsTable.key, APP_KEY))
    .returning({ key: appSettingsTable.key });
  forgetGitHubAppSettings();
  return removed.length > 0;
}
