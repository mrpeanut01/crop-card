import { redirect, type ServerLoad } from '@sveltejs/kit';

export const load: ServerLoad = () => {
  throw redirect(308, '/inventory/pesticide/add');
};
