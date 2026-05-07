// See https://kit.svelte.dev/docs/types#app

declare global {
  namespace App {
    // interface Error {}
    interface Locals {
      user?: import('$lib/server/auth').AuthenticatedUser;
    }
    interface PageData {
      user?: { id: string; email: string; role: 'owner' | 'helper' } | null;
    }
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
