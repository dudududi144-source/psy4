// src/lib/auth.ts
// NextAuth.js v4 configuration with GitHub OAuth + Turso user storage.
//
// Users sign in with GitHub. On first login, we create a user record in Turso.
// On subsequent logins, we update last_login timestamp.
// The session contains the user id which API routes use to scope learning state.

import type { NextAuthOptions } from 'next-auth';
import GitHubProvider from 'next-auth/providers/github';
import { ensureSchema, tursoExecute } from './turso';

export const authOptions: NextAuthOptions = {
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID || process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID || '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET || process.env.NEXT_PUBLIC_GITHUB_CLIENT_SECRET || '',
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60,  // 30 days
  },
  callbacks: {
    async signIn({ user }) {
      // Create/update user in Turso on sign-in
      if (!user?.email) return true;
      try {
        await ensureSchema();
        const now = Date.now();
        // Upsert user — if exists, update last_login; if not, create
        await tursoExecute(
          `INSERT INTO users (id, email, name, image, created_at, last_login)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(email) DO UPDATE SET last_login = excluded.last_login, name = excluded.name, image = excluded.image`,
          [
            user.id || user.email!,
            user.email!,
            user.name || '',
            user.image || '',
            now,
            now,
          ]
        );
        console.log(`[Auth] user signed in: ${user.email}`);
      } catch (err) {
        console.error('[Auth] failed to upsert user:', err);
        // Don't block sign-in if DB fails — user can still use the app
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.uid = user.id || user.email;
        token.email = user.email;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token) {
        (session.user as any).id = token.uid;
        (session.user as any).email = token.email;
      }
      return session;
    },
  },
  pages: {
    signIn: '/',
    error: '/',
  },
};

/**
 * Get the current user's ID from a server-side context.
 * Returns 'anonymous' if not authenticated (for backward compatibility).
 */
export function getUserId(session: any): string {
  return session?.user?.id || session?.user?.email || 'anonymous';
}
