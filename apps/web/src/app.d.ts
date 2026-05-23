// See https://kit.svelte.dev/docs/types#app

declare global {
  namespace App {
    // interface Error {}
    interface Locals {
      user?: import('$lib/server/auth').AuthenticatedUser;
      /** How the request was authenticated (Phase 24).
       *  - 'cookie': HMAC session cookie (the human-UI path)
       *  - 'bearer': Authorization: Bearer cck_… (external agent)
       *  Set by hooks.server.ts after auth resolution. */
      authVia?: 'cookie' | 'bearer';
      /** Set when authVia === 'bearer'. The api_tokens row id, used by
       *  aiGuard to key per-token rate limits in Sub-task D and by
       *  switch-owner to reject ownership change requests from agents. */
      tokenId?: string;
      /** Set when authVia === 'bearer' and the token's is_service_account
       *  is true. aiGuard reads this to decide whether to charge the
       *  human owner's daily quota or the token's own quota. */
      isServiceAccountToken?: boolean;
    }
    interface PageData {
      user?: {
        id: string;
        email: string;
        role: 'owner' | 'helper' | 'inspector' | 'custom-operator';
        activeOwnerId: string | null;
        isSuperadmin?: boolean;
        impersonating?: boolean;
      } | null;
    }
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
