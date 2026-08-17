import * as SQLite from 'expo-sqlite'

let _db: SQLite.SQLiteDatabase | null = null

export function getDb(): SQLite.SQLiteDatabase {
  if (!_db) {
    _db = SQLite.openDatabaseSync('cafeteria_offline.db')
    _db.execSync(`
      CREATE TABLE IF NOT EXISTS sync_queue (
        id          TEXT    PRIMARY KEY,
        operation   TEXT    NOT NULL,
        payload     TEXT    NOT NULL,
        created_at  INTEGER NOT NULL,
        attempts    INTEGER DEFAULT 0,
        last_error  TEXT,
        synced      INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS offline_orders (
        local_id   TEXT    PRIMARY KEY,
        data       TEXT    NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cache_products (
        id   TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cache_categories (
        id   TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cache_tables (
        id   TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cache_orders (
        id       TEXT    PRIMARY KEY,
        data     TEXT    NOT NULL,
        is_local INTEGER NOT NULL DEFAULT 0
      );
    `)
  }
  return _db
}
