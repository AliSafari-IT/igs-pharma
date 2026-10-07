-- Extensions required by later migrations (idempotent).
-- citext: case-insensitive unique email in identity.users (domain-model §1).
CREATE EXTENSION IF NOT EXISTS citext;
