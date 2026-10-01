import { sql } from 'drizzle-orm';
import type { Db } from './index.ts';

export function getSetting(db: Db, key: string): string | null {
  const row = db.get<{ value: string }>(sql`select value from server_settings where key = ${key}`);
  return row?.value ?? null;
}

export function setSetting(db: Db, key: string, value: string) {
  db.run(sql`insert or replace into server_settings (key, value) values (${key}, ${value})`);
}

export function deleteSetting(db: Db, key: string) {
  db.run(sql`delete from server_settings where key = ${key}`);
}
