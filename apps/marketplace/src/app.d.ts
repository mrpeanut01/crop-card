/// <reference types="@sveltejs/kit" />

import type { AppCredential } from '$lib/server/appCreds';
import type { AdminSession } from '$lib/server/adminSession';

declare global {
  namespace App {
    interface Locals {
      /** Set when the request carried `Authorization: Bearer ccm_…`. */
      app?: AppCredential | null;
      /** Set when the request carried a valid marketplace.session cookie. */
      admin?: AdminSession | null;
      /** Which auth mechanism populated locals.app or locals.admin (used
       *  by the CSRF bridge — Bearer requests skip the same-origin check). */
      authVia?: 'bearer' | 'cookie' | null;
    }
    interface PageData {}
    interface Error {
      message: string;
      errId?: string;
    }
    interface Platform {}
  }
}

export {};
