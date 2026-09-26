import { afterEach, describe, expect, it } from 'vitest';
import { authSecret } from './session';

const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
});

describe('authSecret', () => {
  it('refuses the public dev fallback in production', () => {
    delete process.env.AUTH_SECRET;
    process.env.NODE_ENV = 'production';
    expect(() => authSecret()).toThrow(/AUTH_SECRET/);
  });

  it('uses the configured secret', () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTH_SECRET = 'configured';
    expect(authSecret()).toBe('configured');
  });

  it('falls back outside production', () => {
    delete process.env.AUTH_SECRET;
    process.env.NODE_ENV = 'test';
    expect(authSecret()).toBe('dev-only-not-secret-change-in-prod');
  });
});
