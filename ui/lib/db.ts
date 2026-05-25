/**
 * Direct Postgres user provisioning for SSO sign-in.
 * Runs server-side in the NextAuth signIn callback — no dependency on the
 * FastAPI backend being up at sign-in time.
 */
import postgres from "postgres";

let _sql: ReturnType<typeof postgres> | null = null;

export function getDb() {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL not set");
    _sql = postgres(url, { max: 3, idle_timeout: 30 });
  }
  return _sql;
}

export interface SsoProfile {
  azure_oid?: string;
  email: string;
  display_name: string;
}

/**
 * Upsert the user row on every SSO sign-in.
 * Conflicts on EMAIL (always unique) so pre-created admin users get their
 * azure_oid updated automatically on first Azure AD login.
 * For non-Azure providers email is the only identifier — azure_oid stays null.
 */
export async function provisionSsoUser(profile: SsoProfile): Promise<void> {
  const sql = getDb();
  if (profile.azure_oid) {
    await sql`
      INSERT INTO users (email, display_name, azure_oid, is_active, is_admin)
      VALUES (
        ${profile.email},
        ${profile.display_name},
        ${profile.azure_oid},
        true,
        NOT EXISTS (SELECT 1 FROM users)
      )
      ON CONFLICT (email) DO UPDATE
        SET display_name = EXCLUDED.display_name,
            azure_oid    = EXCLUDED.azure_oid
    `;
  } else {
    await sql`
      INSERT INTO users (email, display_name, is_active, is_admin)
      VALUES (
        ${profile.email},
        ${profile.display_name},
        true,
        NOT EXISTS (SELECT 1 FROM users)
      )
      ON CONFLICT (email) DO UPDATE
        SET display_name = EXCLUDED.display_name
    `;
  }
}

export interface DbUser {
  id: string;
  email: string;
  display_name: string;
  azure_oid: string | null;
  is_admin: boolean;
  is_active: boolean;
  password_hash?: string | null;
}

/** Look up a user by azure_oid or email (fallback). */
export async function getUserByOid(
  azure_oid: string,
  email?: string,
): Promise<DbUser | null> {
  const sql = getDb();
  if (email) {
    const rows = await sql<DbUser[]>`
      SELECT id, email, display_name, azure_oid, is_admin, is_active
      FROM users
      WHERE azure_oid = ${azure_oid} OR email = ${email}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }
  const rows = await sql<DbUser[]>`
    SELECT id, email, display_name, azure_oid, is_admin, is_active
    FROM users
    WHERE azure_oid = ${azure_oid}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/** Look up a credentials user by email (includes password_hash). */
export async function getUserByEmailWithPassword(
  email: string,
): Promise<DbUser | null> {
  const sql = getDb();
  const rows = await sql<DbUser[]>`
    SELECT id, email, display_name, azure_oid, is_admin, is_active, password_hash
    FROM users
    WHERE email = ${email} AND password_hash IS NOT NULL
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export interface SSOSetting {
  provider: string;
  enabled: boolean;
}

/** Fetch SSO provider settings from DB for login page / signIn callback. */
export async function getSSOSettings(): Promise<SSOSetting[]> {
  const sql = getDb();
  try {
    const rows = await sql<SSOSetting[]>`
      SELECT provider, enabled FROM sso_provider_settings ORDER BY provider
    `;
    return rows;
  } catch {
    // Table may not exist yet during initial setup — return defaults
    return [
      { provider: "azure-ad", enabled: true },
      { provider: "github", enabled: false },
      { provider: "google", enabled: false },
      { provider: "oidc", enabled: false },
      { provider: "credentials", enabled: false },
    ];
  }
}

/** Check whether a specific SSO provider is enabled in DB. */
export async function isSSOProviderEnabled(provider: string): Promise<boolean> {
  const settings = await getSSOSettings();
  return settings.find((s) => s.provider === provider)?.enabled ?? false;
}

export interface ProviderModel {
  model_name: string;
  display_name: string;
  provider_name: string;
  provider_type: string;
}

/** All enabled models across all enabled providers, ordered by provider then model name. */
export async function getProviderModels(): Promise<ProviderModel[]> {
  const sql = getDb();
  const rows = await sql<ProviderModel[]>`
    SELECT
      pm.model_name,
      COALESCE(pm.display_name, pm.model_name) AS display_name,
      p.name   AS provider_name,
      p.provider_type
    FROM provider_models pm
    JOIN providers p ON pm.provider_id = p.id
    WHERE pm.is_enabled = true AND p.is_enabled = true
    ORDER BY p.created_at ASC, pm.model_name ASC
  `;
  return rows;
}

export interface ProviderConfig {
  base_url: string;
  api_key: string | null;
}

/** Look up the provider that owns a given model_name (first enabled match). */
export async function getProviderForModel(
  modelName: string,
): Promise<ProviderConfig | null> {
  const sql = getDb();
  const rows = await sql<ProviderConfig[]>`
    SELECT p.base_url, p.api_key
    FROM provider_models pm
    JOIN providers p ON pm.provider_id = p.id
    WHERE pm.model_name = ${modelName}
      AND pm.is_enabled = true
      AND p.is_enabled = true
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function getProviders(): Promise<
  Array<{
    id: string;
    name: string;
    provider_type: string;
    base_url: string;
    health_status: string;
    default_model: string;
  }>
> {
  const sql = getDb();
  const rows = await sql`
    SELECT 
      p.id::text,
      p.name,
      p.provider_type,
      p.base_url,
      p.health_status,
      COALESCE((
        SELECT pm.model_name 
        FROM provider_models pm 
        WHERE pm.provider_id = p.id 
        LIMIT 1
      ), '') AS default_model
    FROM providers p
    WHERE p.is_enabled = true
    ORDER BY p.created_at ASC
  `;
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    provider_type: String(r.provider_type),
    base_url: String(r.base_url),
    health_status: String(r.health_status ?? "unknown"),
    default_model: String(r.default_model ?? ""),
  }));
}

/** List all users — used by admin page to bypass FastAPI JWT auth. */
export async function getUsers(limit = 200): Promise<DbUser[]> {
  const sql = getDb();
  const rows = await sql<DbUser[]>`
    SELECT id::text, email, display_name, azure_oid, is_admin, is_active
    FROM users
    ORDER BY created_at ASC
    LIMIT ${limit}
  `;
  return rows;
}
