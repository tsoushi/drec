import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = process.env.DREC_DB ?? "data/drec.db";

declare global {
  // Cache the connection across HMR reloads in dev so we don't reopen the file.
  // eslint-disable-next-line no-var
  var __drecDb: Database.Database | undefined;
}

// Ordered list of migrations. The DB's PRAGMA user_version tracks how many have
// been applied, so adding a new entry here is all that's needed to evolve the
// schema later.
const MIGRATIONS: Array<(db: Database.Database) => void> = [
  // v1 — initial schema
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS records (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        drug_name    TEXT    NOT NULL,
        product_name TEXT,
        amount       REAL,
        unit         TEXT,
        taken_at     TEXT    NOT NULL,
        note         TEXT,
        created_at   TEXT    NOT NULL,
        updated_at   TEXT    NOT NULL,
        deleted_at   TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_records_active ON records (deleted_at, taken_at);
    `);
  },
];

function migrate(db: Database.Database): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    const apply = MIGRATIONS[v];
    db.transaction(() => {
      apply(db);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

function createDb(): Database.Database {
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

export const db: Database.Database =
  globalThis.__drecDb ?? (globalThis.__drecDb = createDb());
