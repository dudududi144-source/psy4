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

// Accept both `libsql://` (Turso's canonical scheme) and `https://`
// (what fetch() actually supports). Auto-convert so users can paste
// the URL from the Turso CLI / dashboard verbatim into .env.
const RAW_TURSO_URL = process.env.TURSO_DATABASE_URL || '';
const TURSO_URL = RAW_TURSO_URL.replace(/^libsql:\/\//, 'https://');
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || '';

export function isTursoConfigured(): boolean {
  return TURSO_URL.length > 0 && TURSO_TOKEN.length > 0;
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
      'Authorization': `Bearer ${TURSO_TOKEN}`,
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
      'Authorization': `Bearer ${TURSO_TOKEN}`,
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
