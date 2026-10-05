import { describe, expect, it } from 'vitest';
import { assignRefusal, taskClosedRefusal } from './taskAssign';

describe('task assignment refusals follow the locale', () => {
  it('stays English without a locale', async () => {
    expect((await assignRefusal().json()).error).toBe('Ask the owner.');
    expect((await taskClosedRefusal().json()).error).toBe(
      'This job is already closed, so who did it stays as it was.'
    );
  });

  it('answers in Spanish for a Spanish request', async () => {
    const owner = await assignRefusal('es').json();
    expect(owner).toMatchObject({ code: 'OWNER_ONLY', askOwner: true });
    expect(owner.error).toBe('Pregúntale al propietario.');
    const closed = taskClosedRefusal('es');
    expect(closed.status).toBe(409);
    expect((await closed.json()).error).toMatch(/ya está cerrada/);
  });
});
