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
    `)
  }
  return _db
}
