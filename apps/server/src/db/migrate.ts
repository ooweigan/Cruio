import { randomUUID } from "node:crypto";
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
  {
    version: 2,
    name: "project_workflows_and_works",
    statements: [
      `CREATE TABLE IF NOT EXISTS workflows (
        id uuid PRIMARY KEY,
        project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
        canvas jsonb NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb,
        version integer NOT NULL DEFAULT 1 CHECK (version > 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS workflows_project_updated_idx
        ON workflows(project_id, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS works (
        id uuid PRIMARY KEY,
        project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
        media_type text NOT NULL CHECK (media_type IN ('image', 'video')),
        preview_url text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS works_project_created_idx
        ON works(project_id, created_at DESC)`,
    ],
  },
  {
    version: 3,
    name: "independent_workflows_and_project_bindings",
    statements: [
      `ALTER TABLE workflows ADD COLUMN IF NOT EXISTS owner_id uuid`,
      `UPDATE workflows SET owner_id = projects.owner_id
        FROM projects WHERE workflows.project_id = projects.id AND workflows.owner_id IS NULL`,
      `ALTER TABLE workflows ALTER COLUMN owner_id SET NOT NULL`,
      `ALTER TABLE workflows ADD CONSTRAINT workflows_owner_id_fkey
        FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE`,
      `CREATE INDEX IF NOT EXISTS workflows_owner_updated_idx
        ON workflows(owner_id, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS workflow_versions (
        workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
        version integer NOT NULL CHECK (version > 0),
        canvas jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workflow_id, version)
      )`,
      `INSERT INTO workflow_versions (workflow_id, version, canvas, created_at)
        SELECT id, version, canvas, updated_at FROM workflows
        ON CONFLICT (workflow_id, version) DO NOTHING`,
      `CREATE TABLE IF NOT EXISTS project_workflow_bindings (
        project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
        workflow_version integer NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (project_id, workflow_id),
        FOREIGN KEY (workflow_id, workflow_version)
          REFERENCES workflow_versions(workflow_id, version)
      )`,
      `INSERT INTO project_workflow_bindings (project_id, workflow_id, workflow_version, created_at)
        SELECT project_id, id, version, created_at FROM workflows
        ON CONFLICT (project_id, workflow_id) DO NOTHING`,
      `ALTER TABLE workflows DROP COLUMN project_id`,
    ],
  },
  {
    version: 4,
    name: "workflow_owner_delete_cascade",
    statements: [
      `ALTER TABLE workflows DROP CONSTRAINT workflows_owner_id_fkey`,
      `ALTER TABLE workflows ADD CONSTRAINT workflows_owner_id_fkey
        FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE`,
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
      if (migration.version === 2) {
        const legacyProjects = await transaction<
          { id: string; canvas: unknown; version: number; createdAt: Date; updatedAt: Date }[]
        >`
          SELECT id, canvas, version, created_at AS "createdAt", updated_at AS "updatedAt"
          FROM projects
          WHERE NOT EXISTS (SELECT 1 FROM workflows WHERE workflows.project_id = projects.id)
        `;
        for (const project of legacyProjects) {
          await transaction`
            INSERT INTO workflows (id, project_id, name, canvas, version, created_at, updated_at)
            VALUES (
              ${randomUUID()}, ${project.id}, ${"默认工作流"},
              ${JSON.stringify(project.canvas)}::text::jsonb, ${project.version},
              ${project.createdAt}, ${project.updatedAt}
            )
          `;
        }
      }
      await transaction`
        INSERT INTO schema_migrations (version, name)
        VALUES (${migration.version}, ${migration.name})
      `;
    }
  });
}
