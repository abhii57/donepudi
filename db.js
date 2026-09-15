import initSqlJs from 'sql.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import bcrypt from 'bcryptjs';

const databaseFile = join(process.cwd(), 'data', 'pulsewire.sqlite');
let database;

function persist() {
  mkdirSync(dirname(databaseFile), { recursive: true });
  writeFileSync(databaseFile, Buffer.from(database.export()));
}

export const pool = {
  async query(sql, params = []) {
    const statement = sql.replace(/NOW\(\)/g, 'CURRENT_TIMESTAMP');

    const isRead =
      /^\s*(SELECT|WITH)/i.test(statement) ||
      /\sRETURNING\s/i.test(statement);

    if (isRead) {
      const result = database.exec(statement, params);
      const first = result[0];

      const rows = first
        ? first.values.map(values =>
            Object.fromEntries(
              first.columns.map((column, index) => [
                column,
                values[index]
              ])
            )
          )
        : [];

      if (!/^\s*(SELECT|WITH)/i.test(statement)) {
        persist();
      }

      return {
        rows,
        rowCount: rows.length
      };
    }

    database.run(statement, params);
    const rowCount = database.getRowsModified();

    persist();

    return {
      rows: [],
      rowCount
    };
  }
};

export async function initializeDatabase() {
  const SQL = await initSqlJs();

  database = existsSync(databaseFile)
    ? new SQL.Database(readFileSync(databaseFile))
    : new SQL.Database();

  database.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      mobile TEXT UNIQUE,
      mobile_verified INTEGER NOT NULL DEFAULT 0,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'reader',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      excerpt TEXT NOT NULL,
      body TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'General',
      image_url TEXT,
      author_id INTEGER REFERENCES users(id),
      published_at TEXT DEFAULT CURRENT_TIMESTAMP,
      is_breaking INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      photo_url TEXT,
      note TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS help_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      work TEXT NOT NULL,
      mobile TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS likes (
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      article_id INTEGER REFERENCES articles(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, article_id)
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id INTEGER REFERENCES articles(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );


    CREATE TABLE IF NOT EXISTS tournaments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      venue TEXT,
      start_date TEXT,
      end_date TEXT,
      live_url TEXT,
      live_status INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tournament_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      team_a TEXT NOT NULL,
      team_b TEXT NOT NULL,
      match_date TEXT,
      venue TEXT,
      score_a TEXT,
      score_b TEXT,
      status TEXT NOT NULL DEFAULT 'Upcoming',
      live_url TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  /*
   * DATABASE MIGRATION
   *
   * Existing Donepudi databases may already have a users table
   * without the new mobile fields.
   */
  try {
    database.run('ALTER TABLE users ADD COLUMN mobile TEXT');
  } catch {}

  try {
    database.run(
      'ALTER TABLE users ADD COLUMN mobile_verified INTEGER NOT NULL DEFAULT 0'
    );
  } catch {}

  /*
   * ADMIN ACCOUNT
   *
   * The admin email and password are NOT stored in this source code.
   * They must be supplied through environment variables.
   */
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    throw new Error(
      'ADMIN_EMAIL and ADMIN_PASSWORD must be configured.'
    );
  }

  /*
   * Find the existing admin account by role.
   * This preserves the existing admin user while updating
   * the credentials from Render environment variables.
   */
  const { rows: [admin] } = await pool.query(
    "SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1"
  );

  const adminHash = await bcrypt.hash(adminPassword, 10);

  if (admin) {
    await pool.query(
      'UPDATE users SET email = $1, password_hash = $2, name = $3, role = $4 WHERE id = $5',
      [
        adminEmail.toLowerCase(),
        adminHash,
        'Donepudi Admin',
        'admin',
        admin.id
      ]
    );
  } else {
    await pool.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'admin')",
      [
        'Donepudi Admin',
        adminEmail.toLowerCase(),
        adminHash
      ]
    );
  }

  persist();
}