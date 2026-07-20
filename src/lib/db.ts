import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set — copy .env.local.example and fill in.');
}

// Tagged-template SQL client. Usage:  await sql`SELECT * FROM dyad WHERE id = ${id}`
// cache: 'no-store' prevents Next.js Data Cache from serving stale DB reads across requests.
export const sql = neon(process.env.DATABASE_URL, { fetchOptions: { cache: 'no-store' } });

// First-call lazy init: ensure all tables exist. Idempotent.
let _ready: Promise<void> | null = null;

export async function ensureSchema(): Promise<void> {
  if (_ready) return _ready;
  _ready = (async () => {
    // ---------- USER (DYAD) ----------
    await sql`
      CREATE TABLE IF NOT EXISTS dyad (
        id            TEXT PRIMARY KEY,
        alias         TEXT UNIQUE NOT NULL,
        child_name    TEXT NOT NULL,
        child_gender  TEXT NOT NULL,
        parent_type   TEXT NOT NULL,
        locale        TEXT NOT NULL DEFAULT 'en',
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS dyad_login_code (
        code      TEXT NOT NULL,
        dyad_id   TEXT NOT NULL REFERENCES dyad(id) ON DELETE CASCADE,
        active    BOOLEAN NOT NULL DEFAULT TRUE,
        issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (code, dyad_id)
      )
    `;
    // Migration: if the old PK was only on `code`, upgrade it to composite (code, dyad_id)
    // so multiple users can share the same login code.
    await sql`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint c
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
          WHERE c.conrelid = 'dyad_login_code'::regclass
            AND c.contype = 'p'
            AND a.attname = 'dyad_id'
        ) THEN
          ALTER TABLE dyad_login_code DROP CONSTRAINT IF EXISTS dyad_login_code_pkey;
          ALTER TABLE dyad_login_code ADD PRIMARY KEY (code, dyad_id);
        END IF;
      END $$
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS free_topic (
        id                    TEXT PRIMARY KEY,
        dyad_id               TEXT NOT NULL REFERENCES dyad(id) ON DELETE CASCADE,
        subtopic              TEXT NOT NULL,
        subtopic_description  TEXT,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    // ---------- SESSION (one full conversation) ----------
    await sql`
      CREATE TABLE IF NOT EXISTS session (
        id                     TEXT PRIMARY KEY,
        dyad_id                TEXT NOT NULL REFERENCES dyad(id) ON DELETE CASCADE,
        topic_category         TEXT NOT NULL,
        subtopic               TEXT,
        subtopic_description   TEXT,
        local_timezone         TEXT,
        status                 TEXT NOT NULL DEFAULT 'initial',
        started_timestamp      BIGINT,
        ended_timestamp        BIGINT,
        num_turns              INTEGER NOT NULL DEFAULT 0,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_session_dyad ON session(dyad_id, created_at DESC)`;
    await sql`ALTER TABLE session ADD COLUMN IF NOT EXISTS rating INTEGER`;

    // ---------- DIALOGUE TURN (parent or child) ----------
    await sql`
      CREATE TABLE IF NOT EXISTS dialogue_turn (
        id                  TEXT PRIMARY KEY,
        session_id          TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
        role                TEXT NOT NULL,
        started_timestamp   BIGINT NOT NULL,
        ended_timestamp     BIGINT,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_turn_session ON dialogue_turn(session_id, started_timestamp)`;
    await sql`ALTER TABLE dialogue_turn ADD COLUMN IF NOT EXISTS inferred_sentence TEXT`;

    // ---------- DIALOGUE MESSAGE (parent text/audio, or child confirmed cards) ----------
    await sql`
      CREATE TABLE IF NOT EXISTS dialogue_message (
        id            TEXT PRIMARY KEY,
        session_id    TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
        turn_id       TEXT NOT NULL REFERENCES dialogue_turn(id) ON DELETE CASCADE,
        role          TEXT NOT NULL,
        content_type  TEXT NOT NULL,        -- 'text' | 'cards'
        content       JSONB NOT NULL,        -- string or CardInfo[]
        timestamp     BIGINT NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_message_session ON dialogue_message(session_id, timestamp)`;

    // ---------- LLM RECOMMENDATIONS (cards / guides) ----------
    await sql`
      CREATE TABLE IF NOT EXISTS child_card_recommendation (
        id            TEXT PRIMARY KEY,
        session_id    TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
        turn_id       TEXT NOT NULL REFERENCES dialogue_turn(id) ON DELETE CASCADE,
        cards         JSONB NOT NULL,
        timestamp     BIGINT NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS parent_guide_recommendation (
        id            TEXT PRIMARY KEY,
        session_id    TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
        turn_id       TEXT NOT NULL REFERENCES dialogue_turn(id) ON DELETE CASCADE,
        guides        JSONB NOT NULL,
        timestamp     BIGINT NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS interim_card_selection (
        id          TEXT PRIMARY KEY,
        session_id  TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
        turn_id     TEXT NOT NULL REFERENCES dialogue_turn(id) ON DELETE CASCADE,
        cards       JSONB NOT NULL,         -- list of CardIdentity
        timestamp   BIGINT NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    // Migration: collapse any pre-existing duplicate rows per (session_id, turn_id) — the old
    // DELETE+INSERT update pattern could leave two rows behind under concurrent requests —
    // before adding the uniqueness constraint that lets card taps upsert atomically.
    await sql`
      DELETE FROM interim_card_selection a USING interim_card_selection b
      WHERE a.session_id = b.session_id AND a.turn_id = b.turn_id
        AND (a.timestamp, a.id) < (b.timestamp, b.id)
    `;
    await sql`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'interim_card_selection_session_turn_key'
        ) THEN
          ALTER TABLE interim_card_selection
            ADD CONSTRAINT interim_card_selection_session_turn_key UNIQUE (session_id, turn_id);
        END IF;
      END $$
    `;

    // ---------- USER ANALYTICS EVENTS ----------
    await sql`
      CREATE TABLE IF NOT EXISTS user_event (
        id          TEXT PRIMARY KEY,
        dyad_id     TEXT NOT NULL REFERENCES dyad(id) ON DELETE CASCADE,
        session_id  TEXT,
        screen      TEXT NOT NULL,
        element     TEXT NOT NULL,
        event_type  TEXT NOT NULL DEFAULT 'tap',
        metadata    JSONB,
        ts          BIGINT NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_event_dyad ON user_event(dyad_id, created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_event_screen ON user_event(screen, element)`;

    // ---------- SEED TEST DYAD ----------
    const code = process.env.TEST_LOGIN_CODE || '12345';
    const alias = process.env.TEST_DYAD_ALIAS || 'abcde';
    const childName = process.env.TEST_CHILD_NAME || 'Sammy';
    const childGender = process.env.TEST_CHILD_GENDER || 'girl';
    const parentType = process.env.TEST_PARENT_TYPE || 'mother';
    const locale = process.env.TEST_LOCALE || 'en';

    // Rename legacy 'test' alias to the current configured alias on existing DBs
    if (!process.env.TEST_DYAD_ALIAS) {
      await sql`UPDATE dyad SET alias = ${alias} WHERE alias = 'test'`;
    }

    const existing = await sql`SELECT id FROM dyad WHERE alias = ${alias} LIMIT 1`;
    if (existing.length === 0) {
      const { nanoid } = await import('nanoid');
      const dyadId = nanoid();
      await sql`
        INSERT INTO dyad (id, alias, child_name, child_gender, parent_type, locale)
        VALUES (${dyadId}, ${alias}, ${childName}, ${childGender}, ${parentType}, ${locale})
      `;
      await sql`
        INSERT INTO dyad_login_code (code, dyad_id) VALUES (${code}, ${dyadId})
        ON CONFLICT (code, dyad_id) DO NOTHING
      `;
      // Default free topics
      const topics = [
        { sub: 'Bluey', desc: "About Bluey, the child's favorite animated TV show." },
        { sub: 'Dinosaurs', desc: 'About dinosaurs that the child likes.' },
        { sub: 'Lego', desc: 'About Lego toy brick series that the child likes.' },
      ];
      for (const t of topics) {
        await sql`
          INSERT INTO free_topic (id, dyad_id, subtopic, subtopic_description)
          VALUES (${nanoid()}, ${dyadId}, ${t.sub}, ${t.desc})
        `;
      }
      console.log(`[db] seeded test dyad: alias=${alias}, code=${code}, child_name=${childName}`);
    }
  })();
  return _ready;
}
