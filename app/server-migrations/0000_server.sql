-- Tables that exist only on the sync server. Devices never have these.
CREATE TABLE device_tokens (
  device_id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
--> statement-breakpoint
CREATE TABLE pairing_codes (
  code_hash text PRIMARY KEY,
  label text,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
