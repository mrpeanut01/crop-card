import type { Handle } from '@sveltejs/kit';
import { currentUser } from '$lib/server/auth';

export const handle: Handle = async ({ event, resolve }) => {
  const user = currentUser(event);
  if (user) event.locals.user = user;
  return resolve(event);
};
