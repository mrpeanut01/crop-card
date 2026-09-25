import { error, type RequestHandler } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { canViewAvatar, getAvatar } from '$lib/db/userProfile';

export const GET: RequestHandler = (event) => {
  const viewer = requireUser(event);
  const subjectId = event.params.userId ?? '';
  if (!viewer.isSuperadmin && !canViewAvatar(viewer.id, subjectId)) {
    throw error(404, 'not found');
  }
  const avatar = getAvatar(subjectId);
  if (!avatar) throw error(404, 'not found');
  const versioned = event.url.searchParams.get('v') === String(avatar.updatedAt.getTime());
  return new Response(new Uint8Array(avatar.data), {
    headers: {
      'Content-Type': avatar.mime,
      'Content-Length': String(avatar.data.length),
      'Cache-Control': versioned ? 'private, max-age=31536000, immutable' : 'private, no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'"
    }
  });
};
