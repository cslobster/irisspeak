import { neon } from '@neondatabase/serverless';
import { capitalizeName } from './text';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set — copy .env.local.example and fill in.');
}

// Tagged-template SQL client. Usage:  await sql`SELECT * FROM dyad WHERE id = ${id}`
// cache: 'no-store' prevents Next.js Data Cache from serving stale DB reads across requests.
export const sql = neon(process.env.DATABASE_URL, { fetchOptions: { cache: 'no-store' } });

// First-call lazy init: ensure all tables exist. Idempotent.
//
// Cached on globalThis rather than a module-level variable: Next.js dev mode compiles each
// API route as its own module graph, so a plain `let` here would NOT be shared across routes —
// every route would re-run the full CREATE TABLE/ALTER TABLE sequence (dozens of sequential
// round trips to Neon) on its own first hit, making unrelated endpoints randomly slow.
// globalThis is the one thing Next dev actually shares across route bundles in the same process.
declare global {
  // eslint-disable-next-line no-var
  var __dbSchemaReady: Promise<void> | undefined;
}

// Inserts a dyad + login code + starter free topics, only if the alias doesn't already exist.
// Shared by the primary (env-configurable) test dyad and the hardcoded guest dyad below.
async function seedDyadIfMissing(opts: {
  alias: string; code: string; childName: string; childGender: string; locale: string;
}): Promise<void> {
  const existing = await sql`SELECT id FROM dyad WHERE alias = ${opts.alias} LIMIT 1`;
  if (existing.length > 0) return;

  const { nanoid } = await import('nanoid');
  const dyadId = nanoid();
  await sql`
    INSERT INTO dyad (id, alias, child_name, child_gender, locale)
    VALUES (${dyadId}, ${opts.alias}, ${opts.childName}, ${opts.childGender}, ${opts.locale})
  `;
  await sql`
    INSERT INTO dyad_login_code (code, dyad_id) VALUES (${opts.code}, ${dyadId})
    ON CONFLICT (code, dyad_id) DO NOTHING
  `;
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
  console.log(`[db] seeded dyad: alias=${opts.alias}, code=${opts.code}, child_name=${opts.childName}`);
}

export async function ensureSchema(): Promise<void> {
  if (globalThis.__dbSchemaReady) return globalThis.__dbSchemaReady;
  globalThis.__dbSchemaReady = (async () => {
    // Each `sql` call is its own network round trip (~75-100ms warm, 200ms+ cold — see
    // moderator.ts), and on a cold serverless instance this whole function runs before the
    // first request can proceed. Statements below are grouped into phases by their actual FK/
    // migration dependencies (a table must exist before you ALTER it, index it, or reference it
    // via FOREIGN KEY) and run in parallel within each phase via Promise.all, instead of one
    // long fully-sequential chain — cuts the cold-start round-trip count roughly in half.

    // ---------- Phase 1: root table everything else depends on ----------
    await sql`
      CREATE TABLE IF NOT EXISTS dyad (
        id            TEXT PRIMARY KEY,
        alias         TEXT UNIQUE NOT NULL,
        child_name    TEXT NOT NULL,
        child_gender  TEXT NOT NULL,
        locale        TEXT NOT NULL DEFAULT 'en',
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    // ---------- Phase 2: only depend on `dyad` existing ----------
    await Promise.all([
      // Personalization core (see CONTEXT.md's Profile Fact / Custom Vocabulary Word entries):
      // age/notes are the non-word-shaped profile context; status gates the self-serve signup
      // wizard behind admin approval — existing admin-created/seeded dyads default to 'active'
      // so they're unaffected.
      sql`ALTER TABLE dyad ADD COLUMN IF NOT EXISTS age INTEGER`,
      sql`ALTER TABLE dyad ADD COLUMN IF NOT EXISTS notes TEXT`,
      sql`ALTER TABLE dyad ADD COLUMN IF NOT EXISTS communication_style TEXT`,
      sql`ALTER TABLE dyad ADD COLUMN IF NOT EXISTS parent_email TEXT`,
      sql`ALTER TABLE dyad ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'`,
      sql`ALTER TABLE dyad DROP COLUMN IF EXISTS parent_type`,
      sql`
        CREATE TABLE IF NOT EXISTS dyad_login_code (
          code      TEXT NOT NULL,
          dyad_id   TEXT NOT NULL REFERENCES dyad(id) ON DELETE CASCADE,
          active    BOOLEAN NOT NULL DEFAULT TRUE,
          issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (code, dyad_id)
        )
      `,
      sql`
        CREATE TABLE IF NOT EXISTS free_topic (
          id                    TEXT PRIMARY KEY,
          dyad_id               TEXT NOT NULL REFERENCES dyad(id) ON DELETE CASCADE,
          subtopic              TEXT NOT NULL,
          subtopic_description  TEXT,
          created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `,
      // ---------- CUSTOM VOCABULARY WORD (per-dyad words not in the shared corpus) ----------
      // is_preference_pointer: true when `word` already exists in the shared corpus and this row
      // just marks it as this child's known favorite (e.g. "red") — no image of its own needed,
      // it resolves via the normal corpus lookup. False means a genuinely new word (a name, a
      // school) that needs image_data/emoji since no corpus image exists for it.
      // image_data is base64, stored directly (no blob storage provider set up) — null falls
      // through to the emoji fallback, itself nullable (both null just means no image yet).
      sql`
        CREATE TABLE IF NOT EXISTS dyad_custom_word (
          id                     TEXT PRIMARY KEY,
          dyad_id                TEXT NOT NULL REFERENCES dyad(id) ON DELETE CASCADE,
          word                   TEXT NOT NULL,
          category               TEXT NOT NULL,
          is_preference_pointer  BOOLEAN NOT NULL DEFAULT FALSE,
          image_data             TEXT,
          emoji                  TEXT,
          source                 TEXT NOT NULL DEFAULT 'parent',
          created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `,
      sql`
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
      `,
      sql`
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
      `,
    ]);

    // ---------- Phase 3: depend on a phase-2 table existing ----------
    await Promise.all([
      // Migration: if the old PK was only on `code`, upgrade it to composite (code, dyad_id)
      // so multiple users can share the same login code.
      sql`
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
      `,
      sql`CREATE INDEX IF NOT EXISTS idx_custom_word_dyad ON dyad_custom_word(dyad_id)`,
      sql`CREATE INDEX IF NOT EXISTS idx_session_dyad ON session(dyad_id, created_at DESC)`,
      sql`ALTER TABLE session ADD COLUMN IF NOT EXISTS rating INTEGER`,
      sql`ALTER TABLE session ADD COLUMN IF NOT EXISTS title TEXT`,
      sql`
        CREATE TABLE IF NOT EXISTS dialogue_turn (
          id                  TEXT PRIMARY KEY,
          session_id          TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
          role                TEXT NOT NULL,
          started_timestamp   BIGINT NOT NULL,
          ended_timestamp     BIGINT,
          created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `,
      sql`CREATE INDEX IF NOT EXISTS idx_event_dyad ON user_event(dyad_id, created_at DESC)`,
      sql`CREATE INDEX IF NOT EXISTS idx_event_screen ON user_event(screen, element)`,
    ]);

    // ---------- Phase 4: depend on `dialogue_turn` (phase 3) existing ----------
    await Promise.all([
      sql`CREATE INDEX IF NOT EXISTS idx_turn_session ON dialogue_turn(session_id, started_timestamp)`,
      sql`ALTER TABLE dialogue_turn ADD COLUMN IF NOT EXISTS inferred_sentence TEXT`,
      sql`
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
      `,
      sql`
        CREATE TABLE IF NOT EXISTS child_card_recommendation (
          id            TEXT PRIMARY KEY,
          session_id    TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
          turn_id       TEXT NOT NULL REFERENCES dialogue_turn(id) ON DELETE CASCADE,
          cards         JSONB NOT NULL,
          timestamp     BIGINT NOT NULL,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `,
      sql`
        CREATE TABLE IF NOT EXISTS parent_guide_recommendation (
          id            TEXT PRIMARY KEY,
          session_id    TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
          turn_id       TEXT NOT NULL REFERENCES dialogue_turn(id) ON DELETE CASCADE,
          guides        JSONB NOT NULL,
          timestamp     BIGINT NOT NULL,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `,
      sql`
        CREATE TABLE IF NOT EXISTS interim_card_selection (
          id          TEXT PRIMARY KEY,
          session_id  TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
          turn_id     TEXT NOT NULL REFERENCES dialogue_turn(id) ON DELETE CASCADE,
          cards       JSONB NOT NULL,         -- list of CardIdentity
          timestamp   BIGINT NOT NULL,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `,
    ]);

    // ---------- Phase 5: depend on `dialogue_message` / `interim_card_selection` (phase 4) ----------
    await Promise.all([
      sql`CREATE INDEX IF NOT EXISTS idx_message_session ON dialogue_message(session_id, timestamp)`,
      // Ranked, corpus-resolved candidate pool for the turn (topics/actions/folder decision) —
      // lets refreshChildCards page through pre-ranked candidates instead of re-calling the LLM
      // every time (see moderator.ts's generateChildCards).
      sql`ALTER TABLE child_card_recommendation ADD COLUMN IF NOT EXISTS pool JSONB`,
      // Migration: collapse any pre-existing duplicate rows per (session_id, turn_id) — the old
      // DELETE+INSERT update pattern could leave two rows behind under concurrent requests —
      // before adding the uniqueness constraint that lets card taps upsert atomically.
      sql`
        DELETE FROM interim_card_selection a USING interim_card_selection b
        WHERE a.session_id = b.session_id AND a.turn_id = b.turn_id
          AND (a.timestamp, a.id) < (b.timestamp, b.id)
      `,
    ]);

    // ---------- Phase 6: must run after the dedup DELETE (phase 5) completes ----------
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

    // ---------- SEED TEST DYAD ----------
    const code = process.env.TEST_LOGIN_CODE || '12345';
    const alias = process.env.TEST_DYAD_ALIAS || 'abcde';
    const childName = capitalizeName(process.env.TEST_CHILD_NAME || 'Sammy');
    const childGender = process.env.TEST_CHILD_GENDER || 'girl';
    const locale = process.env.TEST_LOCALE || 'en';

    // Rename legacy 'test' alias to the current configured alias on existing DBs
    if (!process.env.TEST_DYAD_ALIAS) {
      await sql`UPDATE dyad SET alias = ${alias} WHERE alias = 'test'`;
    }

    await seedDyadIfMissing({ alias, code, childName, childGender, locale });

    // ---------- SEED GUEST DYAD ----------
    // Backs the "Continue as Guest" link on the sign-in screen (SignInScreen.tsx) — a one-tap
    // way for anyone trying the app (reviewers, curious parents) to see it working without a
    // real invite/signup. Hardcoded credentials, not env-configurable like the primary test
    // dyad above, since the frontend button also hardcodes them.
    await seedDyadIfMissing({ alias: 'guest', code: '12345', childName: 'Guest', childGender: 'girl', locale: 'en' });
  })();
  return globalThis.__dbSchemaReady;
}
