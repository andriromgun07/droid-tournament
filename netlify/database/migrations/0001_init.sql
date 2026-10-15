-- Daftar pemain yang pernah ikut (untuk saran nama + gender di layar setup)
CREATE TABLE players (
  id           SERIAL PRIMARY KEY,
  name         TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  gender       CHAR(1)     NOT NULL DEFAULT 'M' CHECK (gender IN ('M', 'F')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX players_name_lower_idx ON players (lower(name));

-- Satu baris per turnamen. Seluruh ronde & hasil disimpan sebagai JSONB.
CREATE TABLE tournaments (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL DEFAULT '',
  mode       TEXT        NOT NULL CHECK (mode IN ('single', 'double')),
  scoring    TEXT        NOT NULL CHECK (scoring IN ('simple', 'score')),
  courts     SMALLINT    NOT NULL CHECK (courts BETWEEN 1 AND 6),
  status     TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished')),
  state      JSONB       NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX tournaments_updated_idx ON tournaments (updated_at DESC);
