import { randomUUID } from "node:crypto";
import type { Database } from "./database";
import { mediaMigration } from "./mediaMigration";

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
  mediaMigration,
  {
    version: 6,
    name: "generation_and_credits",
    statements: [
      `CREATE TABLE IF NOT EXISTS generation_models (
        id uuid PRIMARY KEY,
        provider_id text NOT NULL,
        provider_label text NOT NULL,
        channel_kind text NOT NULL CHECK (channel_kind IN ('official', 'compatible')),
        region text NOT NULL,
        protocol text NOT NULL CHECK (protocol IN ('openai_images', 'volcengine_ark_video')),
        endpoint text NOT NULL,
        credential_env text NOT NULL,
        model_id text NOT NULL,
        model_version text NOT NULL,
        operation text NOT NULL CHECK (operation IN ('image.generate', 'video.generate')),
        capabilities jsonb NOT NULL,
        cost_reference jsonb NOT NULL,
        credit_price bigint CHECK (credit_price > 0),
        verified_at timestamptz NOT NULL,
        published boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (provider_id, model_id, model_version, operation)
      )`,
      `CREATE TABLE IF NOT EXISTS credit_accounts (
        user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        balance bigint NOT NULL DEFAULT 0,
        reserved bigint NOT NULL DEFAULT 0 CHECK (reserved >= 0),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS credit_ledger (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        task_id uuid,
        quote_id uuid,
        entry_type text NOT NULL CHECK (entry_type IN ('opening', 'reserve', 'settle', 'release', 'topup', 'refund', 'reversal')),
        amount bigint NOT NULL,
        balance_after bigint NOT NULL,
        reserved_after bigint NOT NULL DEFAULT 0 CHECK (reserved_after >= 0),
        reference text,
        reason text NOT NULL,
        reverses_id uuid REFERENCES credit_ledger(id),
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS credit_ledger_user_created_idx ON credit_ledger(user_id, created_at DESC)`,
      `CREATE TABLE IF NOT EXISTS generation_quotes (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        model_id uuid NOT NULL REFERENCES generation_models(id),
        operation text NOT NULL,
        credits bigint NOT NULL CHECK (credits > 0),
        plan jsonb NOT NULL,
        snapshot jsonb NOT NULL,
        expires_at timestamptz NOT NULL,
        confirmed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS generation_quotes_user_created_idx ON generation_quotes(user_id, created_at DESC)`,
      `CREATE TABLE IF NOT EXISTS generation_tasks (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        quote_id uuid NOT NULL UNIQUE REFERENCES generation_quotes(id),
        idempotency_key text NOT NULL,
        status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'unknown', 'delivered')),
        snapshot jsonb NOT NULL,
        result_summary jsonb NOT NULL DEFAULT '[]'::jsonb,
        safe_error text,
        provider_task_id text,
        provider_status text,
        submitted_at timestamptz,
        last_checked_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (user_id, idempotency_key)
      )`,
      `CREATE INDEX IF NOT EXISTS generation_tasks_user_created_idx ON generation_tasks(user_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS generation_tasks_recovery_idx ON generation_tasks(status, updated_at)`,
      `ALTER TABLE credit_ledger ADD CONSTRAINT credit_ledger_task_id_fkey
        FOREIGN KEY (task_id) REFERENCES generation_tasks(id) ON DELETE SET NULL`,
      `ALTER TABLE credit_ledger ADD CONSTRAINT credit_ledger_quote_id_fkey
        FOREIGN KEY (quote_id) REFERENCES generation_quotes(id) ON DELETE SET NULL`,
      `CREATE TABLE IF NOT EXISTS generation_results (
        id uuid PRIMARY KEY,
        task_id uuid NOT NULL REFERENCES generation_tasks(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        media_type text NOT NULL CHECK (media_type IN ('image', 'video')),
        mime_type text NOT NULL,
        storage_key uuid NOT NULL UNIQUE,
        size bigint NOT NULL CHECK (size > 0),
        sha256 char(64) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS generation_result_works (
        result_id uuid PRIMARY KEY REFERENCES generation_results(id),
        work_id uuid NOT NULL REFERENCES works(id),
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS generation_result_adoptions (
        id uuid PRIMARY KEY,
        result_id uuid NOT NULL REFERENCES generation_results(id),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        workflow_id uuid REFERENCES workflows(id) ON DELETE CASCADE,
        workflow_version integer,
        node_id text NOT NULL,
        node_version integer NOT NULL CHECK (node_version > 0),
        adoption_version integer NOT NULL CHECK (adoption_version > 0),
        idempotency_key text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (user_id, idempotency_key)
      )`,
      `CREATE INDEX IF NOT EXISTS generation_result_adoptions_target_idx
        ON generation_result_adoptions(project_id, workflow_id, node_id, adoption_version DESC)`,
    ],
  },
  {
    version: 7,
    name: "generation_schema_completion",
    statements: [
      `ALTER TABLE generation_models ADD COLUMN IF NOT EXISTS credit_price bigint CHECK (credit_price > 0)`,
      `ALTER TABLE credit_ledger ADD COLUMN IF NOT EXISTS reserved_after bigint NOT NULL DEFAULT 0 CHECK (reserved_after >= 0)`,
      `CREATE TABLE IF NOT EXISTS generation_result_adoptions (
        id uuid PRIMARY KEY,
        result_id uuid NOT NULL REFERENCES generation_results(id),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        workflow_id uuid REFERENCES workflows(id) ON DELETE CASCADE,
        workflow_version integer,
        node_id text NOT NULL,
        node_version integer NOT NULL CHECK (node_version > 0),
        adoption_version integer NOT NULL CHECK (adoption_version > 0),
        idempotency_key text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (user_id, idempotency_key)
      )`,
      `CREATE INDEX IF NOT EXISTS generation_result_adoptions_target_idx
        ON generation_result_adoptions(project_id, workflow_id, node_id, adoption_version DESC)`,
    ],
  },
  {
    version: 8,
    name: "generation_worker_lifecycle",
    statements: [
      `ALTER TABLE generation_tasks ADD COLUMN IF NOT EXISTS worker_claim_token uuid`,
      `ALTER TABLE generation_tasks ADD COLUMN IF NOT EXISTS worker_claimed_until timestamptz`,
      `ALTER TABLE generation_tasks ADD COLUMN IF NOT EXISTS submission_started_at timestamptz`,
      `ALTER TABLE generation_tasks ADD COLUMN IF NOT EXISTS provider_request_id text`,
      `ALTER TABLE generation_tasks ADD COLUMN IF NOT EXISTS provider_usage jsonb`,
      `ALTER TABLE credit_ledger ADD COLUMN IF NOT EXISTS reserved_delta bigint NOT NULL DEFAULT 0`,
      `UPDATE credit_ledger AS ledger SET reserved_delta = quotes.credits
        FROM generation_tasks AS tasks JOIN generation_quotes AS quotes ON quotes.id = tasks.quote_id
        WHERE ledger.task_id = tasks.id AND ledger.entry_type = 'reserve' AND ledger.reserved_delta = 0`,
      `CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_task_settle_release_idx
        ON credit_ledger(task_id, entry_type) WHERE entry_type IN ('settle', 'release')`,
      `CREATE TABLE IF NOT EXISTS generation_task_attempts (
        id uuid PRIMARY KEY,
        task_id uuid NOT NULL REFERENCES generation_tasks(id) ON DELETE CASCADE,
        attempt_number integer NOT NULL CHECK (attempt_number > 0),
        phase text NOT NULL CHECK (phase IN ('submitting', 'accepted', 'polling', 'delivering', 'unknown', 'failed', 'delivered')),
        provider_task_id text,
        provider_status text,
        provider_request_id text,
        safe_error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (task_id, attempt_number)
      )`,
      `CREATE INDEX IF NOT EXISTS generation_task_attempts_task_idx
        ON generation_task_attempts(task_id, attempt_number DESC)`,
    ],
  },
  {
    version: 9,
    name: "generation_adoption_replay_snapshot",
    statements: [
      `ALTER TABLE generation_result_adoptions ADD COLUMN IF NOT EXISTS request_version integer`,
      `ALTER TABLE generation_result_adoptions ADD COLUMN IF NOT EXISTS committed_version integer`,
      `ALTER TABLE generation_result_adoptions ADD COLUMN IF NOT EXISTS formal_output jsonb NOT NULL DEFAULT '{}'::jsonb`,
    ],
  },
  {
    version: 10,
    name: "operations_roles_and_manual_credits",
    statements: [
      `CREATE TABLE IF NOT EXISTS staff_role_grants (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id),
        role text NOT NULL CHECK (role IN ('admin', 'creditOperator', 'modelOperator', 'support')),
        scope_kind text NOT NULL CHECK (scope_kind IN ('global', 'user')),
        scope_user_id uuid REFERENCES users(id),
        expires_at timestamptz NOT NULL,
        reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
        granted_by uuid REFERENCES users(id),
        revoked_at timestamptz,
        revoked_by uuid REFERENCES users(id),
        revoke_reason text,
        created_at timestamptz NOT NULL DEFAULT now(),
        CHECK ((scope_kind = 'global' AND scope_user_id IS NULL) OR (scope_kind = 'user' AND scope_user_id IS NOT NULL)),
        CHECK ((revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revoke_reason IS NOT NULL))
      )`,
      `CREATE INDEX IF NOT EXISTS staff_role_grants_user_role_idx ON staff_role_grants(user_id, role, expires_at)`,
      `ALTER TABLE credit_ledger ADD COLUMN IF NOT EXISTS channel text`,
      `ALTER TABLE credit_ledger ADD COLUMN IF NOT EXISTS external_reference text`,
      `ALTER TABLE credit_ledger ADD COLUMN IF NOT EXISTS operated_by uuid REFERENCES users(id)`,
      `ALTER TABLE credit_ledger ADD COLUMN IF NOT EXISTS idempotency_key text`,
      `ALTER TABLE credit_ledger ADD COLUMN IF NOT EXISTS public_reason text`,
      `ALTER TABLE credit_ledger ADD COLUMN IF NOT EXISTS related_entry_id uuid REFERENCES credit_ledger(id)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_operator_idempotency_idx ON credit_ledger(operated_by, idempotency_key) WHERE idempotency_key IS NOT NULL`,
      `CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_external_reference_idx ON credit_ledger(entry_type, channel, external_reference) WHERE entry_type IN ('topup', 'refund') AND external_reference IS NOT NULL`,
      `CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_reversal_source_idx ON credit_ledger(related_entry_id) WHERE entry_type = 'reversal'`,
      `CREATE TABLE IF NOT EXISTS credit_evidence (
        entry_id uuid PRIMARY KEY REFERENCES credit_ledger(id),
        file_name text NOT NULL,
        content_type text NOT NULL,
        storage_path text NOT NULL UNIQUE,
        sha256 char(64) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS credit_evidence_access (
        id uuid PRIMARY KEY,
        entry_id uuid NOT NULL REFERENCES credit_evidence(entry_id),
        operator_id uuid NOT NULL REFERENCES users(id),
        purpose text NOT NULL CHECK (char_length(purpose) BETWEEN 1 AND 500),
        accessed_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS credit_operation_previews (
        id uuid PRIMARY KEY,
        token_hash char(64) NOT NULL UNIQUE,
        operator_id uuid NOT NULL REFERENCES users(id),
        target_user_id uuid NOT NULL REFERENCES users(id),
        operation text NOT NULL CHECK (operation IN ('topup', 'refund', 'reversal')),
        amount bigint,
        related_entry_id uuid REFERENCES credit_ledger(id),
        channel text,
        external_reference text,
        file_name text,
        content_type text,
        temp_path text,
        balance_snapshot bigint NOT NULL,
        reserved_snapshot bigint NOT NULL,
        expires_at timestamptz NOT NULL,
        consumed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS credit_operation_previews_expiry_idx ON credit_operation_previews(expires_at)`,
    ],
  },
  {
    version: 11,
    name: "works_soft_delete",
    statements: [
      `ALTER TABLE works ADD COLUMN IF NOT EXISTS deleted_at timestamptz`,
      `CREATE INDEX IF NOT EXISTS works_project_active_created_idx ON works(project_id, created_at DESC) WHERE deleted_at IS NULL`,
    ],
  },
  {
    version: 12,
    name: "generation_task_operations_events",
    statements: [
      `CREATE TABLE IF NOT EXISTS generation_task_events (
        id uuid PRIMARY KEY,
        task_id uuid NOT NULL REFERENCES generation_tasks(id) ON DELETE CASCADE,
        actor_id uuid NOT NULL REFERENCES users(id),
        actor_role text NOT NULL,
        event_type text NOT NULL,
        visibility text NOT NULL CHECK (visibility IN ('user', 'operator')),
        idempotency_key text NOT NULL,
        details jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (task_id, actor_id, idempotency_key)
      )`,
      `CREATE INDEX IF NOT EXISTS generation_task_events_task_created_idx ON generation_task_events(task_id, created_at)`,
    ],
  },
  {
    version: 13,
    name: "email_verification_and_password_recovery",
    statements: [
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz`,
      `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_agent text`,
      `CREATE TABLE IF NOT EXISTS auth_tokens (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        purpose text NOT NULL CHECK (purpose IN ('emailVerification', 'passwordReset')),
        token_hash char(64) NOT NULL UNIQUE,
        expires_at timestamptz NOT NULL,
        consumed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS auth_tokens_user_purpose_expiry_idx ON auth_tokens(user_id, purpose, expires_at)`,
      `CREATE INDEX IF NOT EXISTS auth_tokens_expiry_idx ON auth_tokens(expires_at)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS auth_tokens_one_active_purpose_idx
        ON auth_tokens(user_id, purpose) WHERE consumed_at IS NULL`,
      `CREATE TABLE IF NOT EXISTS auth_security_events (
        id uuid PRIMARY KEY,
        actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        subject_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        event_type text NOT NULL CHECK (event_type IN ('emailVerification', 'passwordReset', 'sessionRevokeOne', 'sessionRevokeOthers')),
        outcome text NOT NULL CHECK (outcome IN ('success', 'invalid', 'notEligible', 'denied')),
        details jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS auth_security_events_subject_created_idx ON auth_security_events(subject_user_id, created_at DESC)`,
    ],
  },
  {
    version: 14,
    name: "notifications_and_support_tickets",
    statements: [
      `CREATE TABLE IF NOT EXISTS notification_read_receipts (
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        event_id text NOT NULL,
        read_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, event_id)
      )`,
      `CREATE TABLE IF NOT EXISTS support_tickets (
        id uuid PRIMARY KEY,
        number text NOT NULL UNIQUE,
        owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        category text NOT NULL CHECK (category IN ('generation', 'credits', 'access', 'other')),
        subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 160),
        description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 4000),
        status text NOT NULL CHECK (status IN ('new', 'processing', 'waitingUser', 'waitingBusiness', 'waitingExternal', 'solutionPending', 'closed', 'withdrawn', 'duplicate', 'safetyEscalated')),
        assigned_role text CHECK (assigned_role IN ('support', 'modelOperator', 'creditOperator')),
        assigned_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        related_task_id uuid REFERENCES generation_tasks(id) ON DELETE SET NULL,
        related_ledger_id uuid REFERENCES credit_ledger(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        closed_at timestamptz
      )`,
      `CREATE INDEX IF NOT EXISTS support_tickets_owner_created_idx ON support_tickets(owner_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS support_tickets_queue_idx ON support_tickets(assigned_role, assigned_user_id, status, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS support_ticket_messages (
        id uuid PRIMARY KEY,
        ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
        author_id uuid REFERENCES users(id) ON DELETE SET NULL,
        author_role text NOT NULL CHECK (author_role IN ('user', 'support', 'modelOperator', 'creditOperator')),
        audience text NOT NULL CHECK (audience IN ('user', 'internal')),
        body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS support_ticket_messages_ticket_created_idx ON support_ticket_messages(ticket_id, created_at)`,
      `CREATE TABLE IF NOT EXISTS support_ticket_events (
        id uuid PRIMARY KEY,
        ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
        actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
        actor_role text NOT NULL,
        event_type text NOT NULL,
        details jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS support_ticket_events_ticket_created_idx ON support_ticket_events(ticket_id, created_at)`,
    ],
  },
  {
    version: 15,
    name: "immutable_generation_model_config_versions",
    statements: [
      `ALTER TABLE generation_models DROP CONSTRAINT IF EXISTS generation_models_provider_id_model_id_model_version_operat_key`,
      `ALTER TABLE generation_models ADD COLUMN IF NOT EXISTS adapter_version text NOT NULL DEFAULT 'v1'`,
      `ALTER TABLE generation_models ADD COLUMN IF NOT EXISTS config_version integer NOT NULL DEFAULT 1 CHECK (config_version > 0)`,
      `ALTER TABLE generation_models ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT true`,
      `CREATE UNIQUE INDEX IF NOT EXISTS generation_models_revision_idx
        ON generation_models(provider_id, model_id, model_version, operation, config_version)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS generation_models_current_idx
        ON generation_models(provider_id, model_id, model_version, operation) WHERE is_current = true`,
      `CREATE INDEX IF NOT EXISTS generation_models_current_published_idx
        ON generation_models(operation, provider_label, model_id) WHERE is_current = true AND published = true`,
    ],
  },
  {
    version: 16,
    name: "generation_governance_and_model_operations",
    statements: [
      `ALTER TABLE staff_role_grants DROP CONSTRAINT IF EXISTS staff_role_grants_role_check`,
      `ALTER TABLE staff_role_grants ADD CONSTRAINT staff_role_grants_role_check
        CHECK (role IN ('admin', 'creditOperator', 'modelOperator', 'support', 'privacyOperator'))`,
      `CREATE TABLE IF NOT EXISTS generation_market_profiles (
        market_code text PRIMARY KEY CHECK (market_code ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{1,31}$'),
        display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
        service_role text NOT NULL CHECK (char_length(service_role) BETWEEN 1 AND 160),
        market_version integer NOT NULL DEFAULT 1 CHECK (market_version > 0),
        is_default boolean NOT NULL DEFAULT false,
        created_by uuid NOT NULL REFERENCES users(id),
        updated_by uuid NOT NULL REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS generation_market_profiles_default_idx
        ON generation_market_profiles(is_default) WHERE is_default = true`,
      `CREATE TABLE IF NOT EXISTS generation_model_market_reviews (
        id uuid PRIMARY KEY,
        model_revision_id uuid NOT NULL REFERENCES generation_models(id),
        market_code text NOT NULL REFERENCES generation_market_profiles(market_code),
        market_version integer NOT NULL CHECK (market_version > 0),
        review_version integer NOT NULL CHECK (review_version > 0),
        status text NOT NULL CHECK (status IN ('inReview', 'verified', 'restricted')),
        responsible_name text NOT NULL CHECK (char_length(responsible_name) BETWEEN 1 AND 120),
        responsible_role text NOT NULL CHECK (char_length(responsible_role) BETWEEN 1 AND 160),
        checks jsonb NOT NULL CHECK (jsonb_typeof(checks) = 'object'),
        allowed_inputs text[] NOT NULL DEFAULT '{}',
        evidence_refs jsonb NOT NULL CHECK (jsonb_typeof(evidence_refs) = 'array'),
        conclusion text NOT NULL CHECK (char_length(conclusion) BETWEEN 1 AND 2000),
        is_current boolean NOT NULL DEFAULT true,
        copied_from uuid REFERENCES generation_model_market_reviews(id),
        created_by uuid NOT NULL REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(model_revision_id, market_code, review_version)
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS generation_model_market_reviews_current_idx
        ON generation_model_market_reviews(model_revision_id, market_code) WHERE is_current = true`,
      `CREATE INDEX IF NOT EXISTS generation_model_market_reviews_market_idx
        ON generation_model_market_reviews(market_code, status, created_at DESC)`,
      `CREATE TABLE IF NOT EXISTS generation_model_management_events (
        id uuid PRIMARY KEY,
        actor_id uuid NOT NULL REFERENCES users(id),
        event_type text NOT NULL CHECK (event_type IN ('marketUpsert', 'revisionCreated', 'reviewRecorded', 'published', 'paused')),
        model_revision_id uuid REFERENCES generation_models(id),
        market_code text REFERENCES generation_market_profiles(market_code),
        details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS generation_model_management_events_created_idx
        ON generation_model_management_events(created_at DESC)`,
    ],
  },
  {
    version: 17,
    name: "privacy_request_cases",
    statements: [
      `CREATE TABLE IF NOT EXISTS privacy_requests (
        id uuid PRIMARY KEY,
        number text NOT NULL UNIQUE,
        owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        category text NOT NULL CHECK (category IN ('access', 'copy', 'correction', 'supplement', 'deletion', 'restriction', 'explanation', 'accountClosure')),
        status text NOT NULL CHECK (status IN ('received', 'identityReview', 'awaitingUser', 'processing', 'partiallyCompleted', 'completed', 'partiallyRefused', 'appealReview', 'closed')),
        subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 160),
        description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 4000),
        idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        closed_at timestamptz,
        UNIQUE(owner_id, idempotency_key)
      )`,
      `CREATE INDEX IF NOT EXISTS privacy_requests_owner_updated_idx ON privacy_requests(owner_id, updated_at DESC)`,
      `CREATE INDEX IF NOT EXISTS privacy_requests_status_updated_idx ON privacy_requests(status, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS privacy_request_objects (
        id uuid PRIMARY KEY,
        request_id uuid NOT NULL REFERENCES privacy_requests(id) ON DELETE CASCADE,
        object_type text NOT NULL CHECK (object_type IN ('account', 'asset', 'task', 'work', 'ledger', 'credential', 'supportTicket', 'externalMapping')),
        source_id uuid,
        requested_action text NOT NULL CHECK (requested_action IN ('access', 'copy', 'correction', 'supplement', 'deletion', 'restriction', 'explanation', 'accountClosure')),
        status text NOT NULL CHECK (status IN ('pending', 'processing', 'awaitingUser', 'completed', 'restricted', 'softDeleted', 'retained', 'refused', 'partial')),
        reason_code text,
        user_reason text NOT NULL DEFAULT '' CHECK (char_length(user_reason) <= 1000),
        internal_reason text NOT NULL DEFAULT '' CHECK (char_length(internal_reason) <= 2000),
        evidence_ref text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS privacy_request_objects_request_idx ON privacy_request_objects(request_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS privacy_request_objects_source_idx ON privacy_request_objects(object_type, source_id)`,
      `CREATE TABLE IF NOT EXISTS privacy_request_events (
        id uuid PRIMARY KEY,
        request_id uuid NOT NULL REFERENCES privacy_requests(id) ON DELETE CASCADE,
        object_id uuid REFERENCES privacy_request_objects(id) ON DELETE SET NULL,
        actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        actor_role text NOT NULL CHECK (actor_role IN ('user', 'privacyOperator')),
        event_type text NOT NULL,
        visibility text NOT NULL CHECK (visibility IN ('user', 'operator')),
        idempotency_key text,
        details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS privacy_request_events_idempotency_idx
        ON privacy_request_events(request_id, actor_id, idempotency_key) WHERE idempotency_key IS NOT NULL`,
      `CREATE INDEX IF NOT EXISTS privacy_request_events_request_idx ON privacy_request_events(request_id, created_at)`,
    ],
  },
  {
    version: 18,
    name: "script_library",
    statements: [
      `CREATE TABLE IF NOT EXISTS scripts (
        id uuid PRIMARY KEY,
        owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
        description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
        latest_version integer NOT NULL DEFAULT 1 CHECK (latest_version > 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS scripts_owner_updated_idx ON scripts(owner_id, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS script_versions (
        script_id uuid NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
        version integer NOT NULL CHECK (version > 0),
        document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (script_id, version)
      )`,
      `CREATE TABLE IF NOT EXISTS script_publications (
        script_id uuid NOT NULL,
        version integer NOT NULL,
        publisher_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        published_at timestamptz NOT NULL DEFAULT now(),
        withdrawn_at timestamptz,
        PRIMARY KEY (script_id, version),
        FOREIGN KEY (script_id, version) REFERENCES script_versions(script_id, version) ON DELETE CASCADE
      )`,
      `CREATE INDEX IF NOT EXISTS script_publications_active_idx
        ON script_publications(published_at DESC) WHERE withdrawn_at IS NULL`,
    ],
  },
  {
    version: 19,
    name: "shot_list_library",
    statements: [
      `CREATE TABLE IF NOT EXISTS shot_lists (
        id uuid PRIMARY KEY,
        owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
        description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
        latest_version integer NOT NULL DEFAULT 1 CHECK (latest_version > 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS shot_lists_owner_updated_idx ON shot_lists(owner_id, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS shot_list_versions (
        shot_list_id uuid NOT NULL REFERENCES shot_lists(id) ON DELETE CASCADE,
        version integer NOT NULL CHECK (version > 0),
        document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (shot_list_id, version)
      )`,
    ],
  },
  {
    version: 20,
    name: "script_library_removal",
    statements: ["ALTER TABLE scripts ADD COLUMN IF NOT EXISTS deleted_at timestamptz"],
  },
  {
    version: 21,
    name: "administrative_user_status",
    statements: [
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_at timestamptz",
      "ALTER TABLE auth_security_events DROP CONSTRAINT IF EXISTS auth_security_events_event_type_check",
      `ALTER TABLE auth_security_events ADD CONSTRAINT auth_security_events_event_type_check
        CHECK (event_type IN ('emailVerification', 'passwordReset', 'sessionRevokeOne', 'sessionRevokeOthers', 'userDisabled', 'userEnabled'))`,
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
