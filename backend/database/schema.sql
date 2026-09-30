-- PeerView PostgreSQL schema (target for Phase 2 to 4).
-- No raw passwords, pairing codes, tokens or private keys are ever stored.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          citext UNIQUE NOT NULL,
  display_name   text NOT NULL,
  password_hash  text NOT NULL,              -- Argon2id encoded string
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE devices (
  id                 uuid PRIMARY KEY,       -- generated on the phone, stored in Keychain/Keystore
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_name        text NOT NULL,
  device_type        text NOT NULL,          -- model, e.g. "Pixel 8"
  operating_system   text NOT NULL CHECK (operating_system IN ('ios', 'android')),
  os_version         text NOT NULL,
  device_public_key  text NOT NULL,          -- P-256 public key (SPKI, base64)
  push_token         text,                   -- FCM / APNs token, may rotate
  last_seen          timestamptz,
  disabled_at        timestamptz,            -- device signed out or wiped
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX devices_user_idx ON devices(user_id);

CREATE TYPE trust_status AS ENUM ('pending', 'trusted', 'once', 'revoked');

-- A directed relationship: controller may view (and maybe control) host.
CREATE TABLE trusted_devices (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_device_id        uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  controller_device_id  uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  authorization_status  trust_status NOT NULL,
  can_view              boolean NOT NULL DEFAULT true,
  can_control           boolean NOT NULL DEFAULT false,
  auto_connect          boolean NOT NULL DEFAULT false,
  host_label            text,                -- Host's custom name for the controller
  controller_label      text,                -- Controller's custom name for the host
  host_pinned_key       text NOT NULL,       -- key each side pinned at pairing time
  controller_pinned_key text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  last_connected        timestamptz,
  revoked_at            timestamptz,
  CHECK (host_device_id <> controller_device_id)
);
-- Only one live relationship per direction.
CREATE UNIQUE INDEX trusted_pair_live_idx
  ON trusted_devices(host_device_id, controller_device_id)
  WHERE authorization_status IN ('pending', 'trusted', 'once');

CREATE TABLE pairing_codes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_device_id  uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  code_hash       bytea NOT NULL,            -- HMAC-SHA256(server_secret, code)
  nonce_hash      bytea NOT NULL,            -- HMAC-SHA256(server_secret, nonce)
  failed_attempts int NOT NULL DEFAULT 0,    -- burned after 5
  expires_at      timestamptz NOT NULL,      -- 5 minutes
  used_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pairing_codes_lookup_idx ON pairing_codes(code_hash) WHERE used_at IS NULL;

CREATE TABLE pairing_requests (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pairing_code_id       uuid NOT NULL REFERENCES pairing_codes(id) ON DELETE CASCADE,
  controller_device_id  uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  requested_control     boolean NOT NULL DEFAULT false,
  network_hint          text,                -- coarse only, e.g. "Different network, Wi-Fi"
  decision              text CHECK (decision IN ('once', 'trust', 'deny')),
  decided_at            timestamptz,
  expires_at            timestamptz NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE refresh_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id    uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  family_id    uuid NOT NULL,                -- reuse of a rotated token revokes the family
  token_hash   bytea NOT NULL UNIQUE,        -- SHA-256 of the opaque token
  expires_at   timestamptz NOT NULL,
  rotated_at   timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens(family_id);

CREATE TABLE sessions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trusted_device_id     uuid NOT NULL REFERENCES trusted_devices(id) ON DELETE CASCADE,
  host_device_id        uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  controller_device_id  uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  control_enabled       boolean NOT NULL DEFAULT false,
  status                text NOT NULL CHECK (status IN ('negotiating', 'active', 'recovering', 'ended')),
  started_at            timestamptz NOT NULL DEFAULT now(),
  ended_at              timestamptz,
  end_reason            text,                -- stopped_by_host, stopped_by_controller, network_lost, revoked
  used_relay            boolean              -- for diagnostics only
);
CREATE INDEX sessions_host_idx ON sessions(host_device_id, started_at DESC);
CREATE INDEX sessions_controller_idx ON sessions(controller_device_id, started_at DESC);

CREATE TABLE audit_events (
  id          bigserial PRIMARY KEY,
  user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
  device_id   uuid REFERENCES devices(id) ON DELETE SET NULL,
  peer_id     uuid REFERENCES devices(id) ON DELETE SET NULL,
  event       text NOT NULL,                 -- pairing_requested, approved, denied, connected, revoked, login...
  metadata    jsonb NOT NULL DEFAULT '{}',   -- never contains secrets
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_user_idx ON audit_events(user_id, created_at DESC);
