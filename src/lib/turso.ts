// src/lib/turso.ts
// Turso (libSQL) client — cloud database for cross-session learning persistence.
//
// Uses Turso's HTTP pipeline API directly (fetch-based) instead of the
// @libsql/client package. The package caused server crashes in the
// Next.js 16 dev environment (likely WebSocket/streaming issues).
// The HTTP API is simpler and more reliable for server-side use.
//
// The token + URL are server-side only (never exposed to the client).
// API routes use this client to proxy learning data.
//
// AUTO-MINT DATABASE TOKEN:
// The user only needs to provide an ORG-level API token (the kind you get
// from `turso api tokens create` or the Turso dashboard). On first use,
// this module detects it's an org token (JWT payload has `org_id` but no
// `id`) and uses the Turso Platform API to mint a database-scoped token
// (POST /v1/organizations/{slug}/databases/{name}/auth/tokens). The
// database token is cached for the lifetime of the process. This means
// the user NEVER has to run `turso db tokens create` in the CLI — the
// project handles it end-to-end.

// Accept both `libsql://` (Turso's canonical scheme) and `https://`
// (what fetch() actually supports). Auto-convert so users can paste
// the URL from the Turso CLI / dashboard verbatim into .env.
const RAW_TURSO_URL = process.env.TURSO_DATABASE_URL || '';
const TURSO_URL = RAW_TURSO_URL.replace(/^libsql:\/\//, 'https://');
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || '';
// Optional: org slug + database name. If not set, they're auto-derived
// from the database hostname (forge-db-{slug}-{region}.turso.io).
const TURSO_ORG_SLUG = process.env.TURSO_ORG_SLUG || '';
const TURSO_DB_NAME = process.env.TURSO_DB_NAME || '';

export function isTursoConfigured(): boolean {
  return TURSO_URL.length > 0 && TURSO_TOKEN.length > 0;
}

// ── JWT inspection (no external dep — just base64 decode the payload) ──
function decodeJwtPayload(jwt: string): Record<string, any> | null {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    let payload = parts[1];
    // base64url → base64 (pad with '=' to length multiple of 4)
    payload = payload.replace(/-/g, '+').replace(/_/g, '/');
    while (payload.length % 4) payload += '=';
    const json = Buffer.from(payload, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Returns true if the JWT looks like an ORG-level API token
 * (has `org_id`, lacks `id`/database-scoped claims).
 */
function isOrgToken(jwt: string): boolean {
  const p = decodeJwtPayload(jwt);
  if (!p) return false;
  return !!p.org_id && !p.id;
}

/**
 * Derive (orgSlug, dbName) from the database hostname.
 * Hostname format: `{dbName}-{orgSlug}-{region}.turso.io`
 * Examples: `forge-db-dudududi144-source.aws-eu-west-1.turso.io`
 *
 * Note: dbName AND orgSlug can both contain hyphens, so we can't reliably
 * split them from the hostname alone. This function returns a best-guess
 * (used only as a hint). The authoritative source is `discoverOrgAndDb()`
 * which calls the Turso platform API to list databases and match by hostname.
 */
function deriveOrgAndDbFromHostname(hostname: string): { orgSlug: string; dbName: string } | null {
  const m = hostname.match(/^([a-z0-9-]+)\.turso\.io$/i);
  if (!m) return null;
  const parts = m[1].split('-');
  if (parts.length < 3) return null;
  // Region is always the last segment group matching a known pattern
  // (aws-*, gcp-*, fly-*, for-*). Find where the region starts.
  const regionStart = parts.findIndex((p, i) =>
    i >= 1 && ['aws', 'gcp', 'fly', 'for', 'azure'].includes(p) && i < parts.length - 1
  );
  if (regionStart < 2) return null;
  // dbName is parts[0..regionStart-orgSlug-end], orgSlug is between dbName and region.
  // We can't know the split point without API help — default to dbName=parts[0],
  // orgSlug=rest-minus-region. discoverOrgAndDb() will override with the truth.
  const dbName = parts[0];
  const orgSlug = parts.slice(1, regionStart).join('-');
  return { orgSlug, dbName };
}

/**
 * Authoritative discovery: use the org token to call the Turso platform API
 * and find the database whose hostname matches TURSO_DATABASE_URL. Returns
 * the actual (orgSlug, dbName) pair.
 *
 * Falls back to hostname parsing if the API call fails.
 */
async function discoverOrgAndDb(): Promise<{ orgSlug: string; dbName: string }> {
  // 1. Try env vars first (user can always override)
  if (TURSO_ORG_SLUG && TURSO_DB_NAME) {
    return { orgSlug: TURSO_ORG_SLUG, dbName: TURSO_DB_NAME };
  }

  // 2. Try the platform API: list orgs, then list databases, match by hostname
  try {
    // List orgs → get the slug
    const orgsResp = await fetch('https://api.turso.tech/v1/organizations', {
      headers: { 'Authorization': `Bearer ${TURSO_TOKEN}` },
    });
    if (orgsResp.ok) {
      const orgs = await orgsResp.json();
      const orgList = Array.isArray(orgs) ? orgs : (orgs.organizations || []);
      // Find the org whose databases include one matching our hostname
      const targetHostname = (() => {
        try { return new URL(TURSO_URL).hostname; } catch { return ''; }
      })();

      for (const org of orgList) {
        const slug = org.slug || org.name;
        if (!slug) continue;
        // List databases for this org
        const dbResp = await fetch(`https://api.turso.tech/v1/databases`, {
          headers: { 'Authorization': `Bearer ${TURSO_TOKEN}` },
        });
        if (!dbResp.ok) continue;
        const dbData = await dbResp.json();
        const dbList = dbData.databases || dbData || [];
        for (const db of dbList) {
          const dbHostname = db.Hostname || db.hostname;
          if (dbHostname && targetHostname && dbHostname === targetHostname) {
            return { orgSlug: slug, dbName: db.Name || db.name };
          }
        }
      }
    }
  } catch (err) {
    console.warn('[Turso] discoverOrgAndDb: platform API failed:', err);
  }

  // 3. Fallback: parse from hostname (best-guess — may not work for
  // databases with hyphens in their name)
  if (TURSO_URL) {
    try {
      const u = new URL(TURSO_URL);
      const derived = deriveOrgAndDbFromHostname(u.hostname);
      if (derived) return derived;
    } catch { /* ignore */ }
  }

  throw new Error('Turso: could not determine orgSlug + dbName. Set TURSO_ORG_SLUG + TURSO_DB_NAME in .env.');
}

let cachedDbToken: string | null = null;
let mintingPromise: Promise<string> | null = null;

/**
 * Mint a database-scoped token from an org-level API token via the
 * Turso Platform API.
 *
 * Endpoint (per https://docs.turso.tech/api-reference/databases/create-token):
 *   POST https://api.turso.tech/v1/organizations/{orgSlug}/databases/{dbName}/auth/tokens
 *   ?authorization=full-access
 *   Header: Authorization: Bearer <orgToken>
 *   Body: empty
 *   Response: {"jwt": "<databaseToken>"}
 */
async function mintDatabaseToken(orgToken: string, orgSlug: string, dbName: string): Promise<string> {
  const url = `https://api.turso.tech/v1/organizations/${encodeURIComponent(orgSlug)}/databases/${encodeURIComponent(dbName)}/auth/tokens?authorization=full-access`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${orgToken}`,
      'Content-Length': '0',
    },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Turso mint failed (HTTP ${resp.status}): ${text}`);
  }
  const data = await resp.json();
  if (!data.jwt || typeof data.jwt !== 'string') {
    throw new Error(`Turso mint returned no jwt: ${JSON.stringify(data)}`);
  }
  return data.jwt;
}

/**
 * Resolve the actual database token to use for libsql API calls.
 * If TURSO_AUTH_TOKEN is already a database token, return it directly.
 * If it's an org token, mint a database token (cached for process lifetime).
 *
 * Minting is single-flight: if multiple concurrent callers ask for a token
 * while a mint is in-flight, they all share the same Promise.
 */
async function resolveDatabaseToken(): Promise<string> {
  // Fast path: cached
  if (cachedDbToken) return cachedDbToken;

  // If TURSO_TOKEN isn't an org token, just use it directly
  // (it's already a database-scoped token)
  if (!isOrgToken(TURSO_TOKEN)) return TURSO_TOKEN;

  // It IS an org token — mint a database token.
  // Single-flight: reuse in-flight mint promise.
  if (mintingPromise) return mintingPromise;

  mintingPromise = (async () => {
    try {
      const { orgSlug, dbName } = await discoverOrgAndDb();
      console.log(`[Turso] org token detected — minting database token for ${orgSlug}/${dbName}`);
      const dbToken = await mintDatabaseToken(TURSO_TOKEN, orgSlug, dbName);
      cachedDbToken = dbToken;
      console.log(`[Turso] ✓ database token minted + cached (length ${dbToken.length})`);
      return dbToken;
    } finally {
      mintingPromise = null;
    }
  })();
  return mintingPromise;
}

export interface TursoValue {
  type: 'integer' | 'float' | 'text' | 'blob' | 'null';
  value: string | null;
}

export interface TursoRow {
  [columnName: string]: string | number | null;
}

export interface TursoResult {
  columns: string[];
  rows: TursoRow[];
  affectedRowCount: number;
  rowsRead: number;
}

/**
 * Convert a JS value to Turso's tagged arg format.
 * Turso v2 pipeline API expects:
 * - integer: {"type":"integer","value":"42"} (value as string OK)
 * - float:   {"type":"float","value":0.5}    (value MUST be a JSON number)
 * - text:    {"type":"text","value":"hello"}  (value as string)
 * - null:    {"type":"null"}
 */
function toTursoArg(v: string | number | null): any {
  if (v === null || v === undefined) {
    return { type: 'null' };
  }
  if (typeof v === 'number') {
    if (Number.isInteger(v)) {
      return { type: 'integer', value: String(v) };
    }
    return { type: 'float', value: v };  // MUST be a JSON number, not a string
  }
  // string
  return { type: 'text', value: String(v) };
}

/**
 * Execute a SQL statement via Turso's HTTP pipeline API.
 * Returns the result rows (parsed from Turso's column-value format).
 */
export async function tursoExecute(sql: string, args: (string | number | null)[] = []): Promise<TursoResult> {
  if (!isTursoConfigured()) {
    throw new Error('Turso not configured');
  }
  // Resolve the actual database token — if TURSO_AUTH_TOKEN is an org
  // token, this auto-mints a database-scoped token (cached for process life).
  const authToken = await resolveDatabaseToken();
  const body: any = {
    requests: [
      {
        type: 'execute',
        stmt: { sql, args: args.map(toTursoArg) },
      },
      {
        type: 'close',
      },
    ],
  };
  const resp = await fetch(`${TURSO_URL}/v2/pipeline`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Turso HTTP ${resp.status}: ${text}`);
  }
  const data = await resp.json();
  const executeResult = data.results?.[0]?.response?.result;
  if (!executeResult) {
    return { columns: [], rows: [], affectedRowCount: 0, rowsRead: 0 };
  }
  const columns = (executeResult.cols || []).map((c: any) => c.name);
  const rawRows = executeResult.rows || [];
  const rows: TursoRow[] = rawRows.map((rawRow: any[]) => {
    const row: TursoRow = {};
    for (let i = 0; i < columns.length; i++) {
      const cell = rawRow[i];
      if (!cell || cell.type === 'null') {
        row[columns[i]] = null;
      } else if (cell.type === 'integer' || cell.type === 'float') {
        row[columns[i]] = Number(cell.value);
      } else {
        row[columns[i]] = cell.value;
      }
    }
    return row;
  });
  return {
    columns,
    rows,
    affectedRowCount: executeResult.affected_row_count || 0,
    rowsRead: executeResult.rows_read || 0,
  };
}

/**
 * Execute multiple statements in a single pipeline (batch).
 * More efficient for multi-statement operations.
 */
export async function tursoBatch(statements: Array<{ sql: string; args?: (string | number | null)[] }>): Promise<TursoResult[]> {
  if (!isTursoConfigured()) {
    throw new Error('Turso not configured');
  }
  // Resolve the actual database token — auto-mints an org→db token if needed.
  const authToken = await resolveDatabaseToken();
  const requests: Array<{ type: 'execute'; stmt: { sql: string; args: any[] } } | { type: 'close' }> =
    statements.map(s => ({
      type: 'execute' as const,
      stmt: { sql: s.sql, args: (s.args || []).map(toTursoArg) },
    }));
  requests.push({ type: 'close' as const });
  const bodyStr = JSON.stringify({ requests });
  const resp = await fetch(`${TURSO_URL}/v2/pipeline`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    body: bodyStr,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Turso HTTP ${resp.status}: ${text}`);
  }
  const data = await resp.json();
  const results: TursoResult[] = [];
  for (const r of data.results || []) {
    if (r.type === 'ok' && r.response?.type === 'execute') {
      const er = r.response.result;
      const columns = (er.cols || []).map((c: any) => c.name);
      const rawRows = er.rows || [];
      const rows: TursoRow[] = rawRows.map((rawRow: any[]) => {
        const row: TursoRow = {};
        for (let i = 0; i < columns.length; i++) {
          const cell = rawRow[i];
          if (!cell || cell.type === 'null') row[columns[i]] = null;
          else if (cell.type === 'integer' || cell.type === 'float') row[columns[i]] = Number(cell.value);
          else row[columns[i]] = cell.value;
        }
        return row;
      });
      results.push({ columns, rows, affectedRowCount: er.affected_row_count || 0, rowsRead: er.rows_read || 0 });
    } else {
      results.push({ columns: [], rows: [], affectedRowCount: 0, rowsRead: 0 });
    }
  }
  return results;
}

let schemaInitialized = false;

/**
 * Initialize the schema. Safe to call multiple times (CREATE TABLE IF NOT EXISTS).
 */
export async function initTursoSchema(): Promise<boolean> {
  if (!isTursoConfigured()) return false;
  if (schemaInitialized) return true;
  try {
    await tursoBatch([
      { sql: `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT,
        image TEXT,
        created_at INTEGER NOT NULL,
        last_login INTEGER
      )` },
      { sql: `CREATE TABLE IF NOT EXISTS learning_params (
        cc INTEGER NOT NULL,
        value REAL NOT NULL,
        reward REAL NOT NULL,
        updated_at INTEGER NOT NULL,
        user_id TEXT,
        PRIMARY KEY (cc, COALESCE(user_id, 'anonymous'))
      )` },
      { sql: `CREATE TABLE IF NOT EXISTS pattern_memory (
        fingerprint TEXT NOT NULL,
        reward REAL NOT NULL,
        hits INTEGER NOT NULL DEFAULT 1,
        last_used REAL NOT NULL,
        created_at INTEGER NOT NULL,
        user_id TEXT,
        PRIMARY KEY (fingerprint, COALESCE(user_id, 'anonymous'))
      )` },
      { sql: `CREATE TABLE IF NOT EXISTS convergence_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        value REAL NOT NULL,
        measured_at INTEGER NOT NULL,
        user_id TEXT
      )` },
      { sql: `CREATE TABLE IF NOT EXISTS radio_telemetry (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stream_name TEXT NOT NULL,
        bpm REAL NOT NULL,
        warmth REAL NOT NULL,
        brightness REAL NOT NULL,
        loudness REAL NOT NULL,
        smoothness REAL NOT NULL,
        style TEXT NOT NULL,
        in_breakdown INTEGER NOT NULL DEFAULT 0,
        measured_at INTEGER NOT NULL,
        user_id TEXT
      )` },
      { sql: `CREATE INDEX IF NOT EXISTS idx_pattern_reward ON pattern_memory(reward DESC)` },
      { sql: `CREATE INDEX IF NOT EXISTS idx_convergence_time ON convergence_history(measured_at DESC)` },
      { sql: `CREATE INDEX IF NOT EXISTS idx_radio_telemetry_time ON radio_telemetry(measured_at DESC)` },
      { sql: `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)` },
      { sql: `CREATE INDEX IF NOT EXISTS idx_learning_params_user ON learning_params(user_id)` },
      { sql: `CREATE INDEX IF NOT EXISTS idx_pattern_memory_user ON pattern_memory(user_id)` },
    ]);
    schemaInitialized = true;
    console.log('[Turso] schema initialized ✓ (users + per-user learning)');
    return true;
  } catch (err) {
    console.error('[Turso] schema init failed:', err);
    return false;
  }
}

export async function ensureSchema(): Promise<boolean> {
  if (schemaInitialized) return true;
  return await initTursoSchema();
}
