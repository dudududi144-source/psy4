// src/lib/user-identity.ts
// Anonymous local user identity — no cloud authentication required.
//
// Generates a stable user ID per browser (stored in localStorage).
// The user can optionally set a display name.
// This ID is sent to API routes to scope learning state per-user.
//
// This is NOT authentication (anyone can use the app). It's identity scoping
// so different users on the same server don't share learning state.
//
// For cross-device sync, the user can export their user ID + data
// (future feature). No GitHub/email required.

const USER_ID_KEY = 'psy4-user-id-v1';
const USER_NAME_KEY = 'psy4-user-name-v1';

/**
 * Get or create a stable anonymous user ID for this browser.
 * Format: 'anon-' + 16 random hex chars.
 */
export function getOrCreateUserId(): string {
  if (typeof window === 'undefined') return 'anonymous';
  let id = localStorage.getItem(USER_ID_KEY);
  if (!id) {
    // Generate 16 random hex chars
    const random = Array.from(crypto.getRandomValues(new Uint8Array(8)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    id = `anon-${random}`;
    localStorage.setItem(USER_ID_KEY, id);
    console.log(`[UserId] created: ${id}`);
  }
  return id;
}

export function getUserId(): string {
  if (typeof window === 'undefined') return 'anonymous';
  return localStorage.getItem(USER_ID_KEY) || 'anonymous';
}

export function getUserName(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(USER_NAME_KEY);
}

export function setUserName(name: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(USER_NAME_KEY, name);
}

/**
 * Get the user identity headers for API requests.
 * Sends the user ID + optional name to scope learning state.
 */
export function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'X-User-Id': getUserId(),
  };
  const name = getUserName();
  if (name) headers['X-User-Name'] = name;
  return headers;
}
