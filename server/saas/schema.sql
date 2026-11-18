-- Apply with npm run db:migrate. This schema does not expose the local HQ server.
CREATE TABLE IF NOT EXISTS saas_users (
  id UUID PRIMARY KEY,
  github_user_id BIGINT NOT NULL UNIQUE,
  github_login TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS saas_github_installations (
  id BIGINT NOT NULL,
  user_id UUID NOT NULL REFERENCES saas_users(id) ON DELETE CASCADE,
  account_login TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);
CREATE TABLE IF NOT EXISTS saas_projects (
  id UUID PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES saas_users(id) ON DELETE CASCADE,
  installation_id BIGINT NOT NULL,
  github_repository_id BIGINT NOT NULL,
  repository_full_name TEXT NOT NULL,
  name TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  plan JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (owner_id, installation_id) REFERENCES saas_github_installations(user_id, id),
  UNIQUE (owner_id, github_repository_id)
);
CREATE INDEX IF NOT EXISTS saas_projects_owner_idx ON saas_projects(owner_id);
CREATE TABLE IF NOT EXISTS saas_secrets (
  project_id UUID NOT NULL REFERENCES saas_projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, name)
);
CREATE TABLE IF NOT EXISTS saas_user_credentials (
  user_id UUID PRIMARY KEY REFERENCES saas_users(id) ON DELETE CASCADE,
  github_token TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS saas_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES saas_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS saas_sessions_expiry_idx ON saas_sessions(expires_at);
ALTER TABLE saas_user_credentials ADD COLUMN IF NOT EXISTS github_refresh_token TEXT;
ALTER TABLE saas_user_credentials ADD COLUMN IF NOT EXISTS github_expires_at TIMESTAMPTZ;
ALTER TABLE saas_projects ADD COLUMN IF NOT EXISTS local_autostart BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE saas_projects ADD COLUMN IF NOT EXISTS config_updated_at TIMESTAMPTZ;
ALTER TABLE saas_projects ADD COLUMN IF NOT EXISTS plan_updated_at TIMESTAMPTZ;
