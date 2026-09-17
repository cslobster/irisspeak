/**
 * Session lifecycle. Card generation and sentence inference used to live here too (Gemini-driven,
 * mirroring libs/py_core/py_core/system/moderator.py) but that whole flow is dead code as of the
 * on-device model switch — nothing in the shipped app calls it. Removed 2026-09-17; see git
 * history / CONTEXT.md if it's ever needed for reference.
 *
 * Public surface:
 *   startSession(session, dyad) → ParentGuideRecommendationResult (static initial guides, no LLM)
 *   endSession(session, dyad) → void (best-effort AI title for the history list)
 *   abortSession(session, dyad) → void
 *
 * Persistence: Postgres (Neon) — see db.ts for schema.
 */
import { nanoid } from 'nanoid';
import { sql, ensureSchema } from './db';
import { chat } from './gemini';
import { buildSessionTitlePrompt, dialogueToXml } from './prompts';
import { buildInitialGuides } from './staticData';
import type {
  DialogueMessage, Dyad, ParentGuideElement, ParentGuideRecommendationResult, TopicCategory,
} from './types';

function now(): number { return Date.now(); }

async function getCurrentTurn(sessionId: string): Promise<{ id: string; role: 'parent' | 'child'; ended_timestamp: number | null } | null> {
  const r = (await sql`
    SELECT id, role, ended_timestamp
    FROM dialogue_turn
    WHERE session_id = ${sessionId}
    ORDER BY started_timestamp DESC
    LIMIT 1
  `) as any[];
  return r[0] || null;
}

// The Neon HTTP driver pays a full network round trip per query (measured ~75-100ms warm,
// 200ms+ cold) with no pipelining, so firing dialogue_turn's insert and session's update
// concurrently below is a real, measured latency cut — they touch different rows so it's safe.
async function newTurn(sessionId: string, role: 'parent' | 'child'): Promise<{ id: string; role: 'parent' | 'child'; ended_timestamp: null }> {
  const id = nanoid();
  const ts = now();
  await Promise.all([
    sql`
      INSERT INTO dialogue_turn (id, session_id, role, started_timestamp)
      VALUES (${id}, ${sessionId}, ${role}, ${ts})
    `,
    sql`UPDATE session SET num_turns = num_turns + 1 WHERE id = ${sessionId}`,
  ]);
  return { id, role, ended_timestamp: null };
}

async function getDialogue(sessionId: string): Promise<DialogueMessage[]> {
  const rows = (await sql`
    SELECT role, content, content_type, timestamp, turn_id
    FROM dialogue_message
    WHERE session_id = ${sessionId}
    ORDER BY timestamp ASC
  `) as any[];
  return rows.map((r) => ({
    role: r.role,
    content: r.content_type === 'text' ? String(r.content) : r.content,
    turn_id: r.turn_id,
    timestamp: Number(r.timestamp),
  }));
}

// ---------- start session (initial parent guides) ----------
export async function startSession(sessionId: string, dyad: Dyad): Promise<{ turn_id: string; recommendation: ParentGuideRecommendationResult }> {
  await ensureSchema();
  const session = (await sql`SELECT * FROM session WHERE id = ${sessionId} LIMIT 1`) as any[];
  if (!session[0]) throw new Error('session not found');
  const sess = session[0];
  if (sess.dyad_id !== dyad.id) throw new Error('forbidden');

  // Already started — return current state instead of erroring out (same forgiving behavior the web client wants)
  if (sess.status !== 'initial') {
    const cur = await getCurrentTurn(sessionId);
    const lastGuide = (await sql`
      SELECT * FROM parent_guide_recommendation
      WHERE session_id = ${sessionId}
      ORDER BY timestamp DESC LIMIT 1
    `) as any[];
    if (lastGuide[0]) {
      return {
        turn_id: cur?.id || lastGuide[0].turn_id,
        recommendation: {
          id: lastGuide[0].id,
          timestamp: Number(lastGuide[0].timestamp),
          turn_id: lastGuide[0].turn_id,
          guides: lastGuide[0].guides as ParentGuideElement[],
        },
      };
    }
  }

  // Mark started + create the first parent turn
  await sql`UPDATE session SET status = 'started', started_timestamp = ${now()} WHERE id = ${sessionId}`;
  const turn = await newTurn(sessionId, 'parent');

  // Static initial guides (no LLM)
  const guides = buildInitialGuides(sess.topic_category as TopicCategory, dyad.child_name);

  const recId = nanoid();
  const ts = now();
  await sql`
    INSERT INTO parent_guide_recommendation (id, session_id, turn_id, guides, timestamp)
    VALUES (${recId}, ${sessionId}, ${turn.id}, ${JSON.stringify(guides)}, ${ts})
  `;
  await sql`UPDATE session SET status = 'conversation' WHERE id = ${sessionId}`;

  return {
    turn_id: turn.id,
    recommendation: { id: recId, timestamp: ts, turn_id: turn.id, guides },
  };
}

// ---------- session housekeeping ----------
export async function endSession(sessionId: string, dyad: Dyad): Promise<void> {
  await ensureSchema();

  // Best-effort AI caption for the history list — a failed/slow LLM call should never block
  // ending the session, so title stays null and the UI falls back to the topic label.
  let title: string | null = null;
  try {
    const dialogue = await getDialogue(sessionId);
    if (dialogue.length > 0) {
      const raw = await chat([
        { role: 'system', content: buildSessionTitlePrompt(dyad.child_name) },
        { role: 'user', content: dialogueToXml(dialogue) },
      ]);
      title = raw.replace(/^["'](.*)["']$/s, '$1').trim() || null;
    }
  } catch (e) {
    console.error('[session-title] generation failed:', e);
  }

  await sql`
    UPDATE session SET status = 'terminated', ended_timestamp = ${now()}, title = COALESCE(${title}, title)
    WHERE id = ${sessionId} AND dyad_id = ${dyad.id}
  `;
}

export async function abortSession(sessionId: string, dyad: Dyad): Promise<void> {
  await ensureSchema();
  await sql`DELETE FROM session WHERE id = ${sessionId} AND dyad_id = ${dyad.id}`;
}
