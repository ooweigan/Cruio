export const mediaMigration = {
  version: 5,
  name: "private_media",
  statements: [
    `CREATE TABLE IF NOT EXISTS media_assets (
      id uuid PRIMARY KEY,
      owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      file_name text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 255),
      media_type text NOT NULL,
      size integer NOT NULL CHECK (size > 0),
      source text NOT NULL CHECK (source IN ('self_created', 'licensed', 'third_party_authorized')),
      usage text NOT NULL CHECK (char_length(usage) BETWEEN 1 AND 200),
      authorization_declared boolean NOT NULL CHECK (authorization_declared),
      contains_real_person boolean NOT NULL,
      subject_is_adult boolean NOT NULL,
      status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
      created_at timestamptz NOT NULL DEFAULT now(),
      revoked_at timestamptz,
      CHECK (contains_real_person = false OR subject_is_adult = true),
      CHECK ((status = 'active' AND revoked_at IS NULL) OR (status = 'revoked' AND revoked_at IS NOT NULL))
    )`,
    `CREATE INDEX IF NOT EXISTS media_assets_owner_created_idx ON media_assets(owner_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS media_assets_owner_status_idx ON media_assets(owner_id, status)`,
  ],
} as const;
