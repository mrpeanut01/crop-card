/// <reference types="@sveltejs/kit" />

declare global {
  namespace App {
    // Sub-task C will populate locals.user when admin sessions / app credentials land.
    interface Locals {}
    interface PageData {}
    interface Error {
      message: string;
    }
    interface Platform {}
  }
}

export {};
