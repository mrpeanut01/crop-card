import { eq } from 'drizzle-orm';
import { db } from './client';
import { appSettings } from './schema';

export function getSetting(key: string): string | undefined {
  return db.select().from(appSettings).where(eq(appSettings.key, key)).get()?.value ?? undefined;
}

export function setSetting(key: string, value: string): void {
  db.insert(appSettings)
    .values({ key, value, updatedAt: new Date(Date.now()) })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date(Date.now()) } })
    .run();
}

export function deleteSetting(key: string): void {
  db.delete(appSettings).where(eq(appSettings.key, key)).run();
}
