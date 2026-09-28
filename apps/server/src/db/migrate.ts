import type { Database } from "./database";

const migrations = [
  {
    version: 1,
    name: "accounts_sessions_projects",
    statements: [
      `CREATE TABLE IF NOT EXISTS users (
        id uuid PRIMARY KEY,
        email text NOT NULL UNIQUE CHECK (email = lower(email)),
        password_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS sessions (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash char(64) NOT NULL UNIQUE,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id)`,
      `CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at)`,
      `CREATE TABLE IF NOT EXISTS projects (
        id uuid PRIMARY KEY,
        owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
        canvas jsonb NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb,
        version integer NOT NULL DEFAULT 1 CHECK (version > 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS projects_owner_updated_idx
        ON projects(owner_id, updated_at DESC)`,
    ],
  },
] as const;

export async function migrate(database: Database) {
  await database.unsafe(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version integer PRIMARY KEY,
    name text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  await database.begin(async (transaction) => {
    await transaction`SELECT pg_advisory_xact_lock(1729461101)`;
    const applied = await transaction<{ version: number }[]>`
      SELECT version FROM schema_migrations
    `;
    const appliedVersions = new Set(applied.map(({ version }) => version));

    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) continue;
      for (const statement of migration.statements) {
        await transaction.unsafe(statement);
      }
      await transaction`
        INSERT INTO schema_migrations (version, name)
        VALUES (${migration.version}, ${migration.name})
      `;
    }
  });
}
