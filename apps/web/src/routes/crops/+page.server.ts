import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
  const blockId = url.searchParams.get('blockId');
  throw redirect(308, blockId ? `/plan?block=${encodeURIComponent(blockId)}` : '/plan');
};
