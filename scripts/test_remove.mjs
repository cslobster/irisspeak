// E2E test: sequential card removals
// Usage: node scripts/test_remove.mjs
const BASE = 'http://localhost:3000/api/v1';

async function req(method, path, body, jwt) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (jwt) opts.headers['Authorization'] = `Bearer ${jwt}`;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) { console.error(`${method} ${path} → ${res.status}`, data); process.exit(1); }
  return data;
}

async function main() {
  // 1. login
  const auth = await req('POST', '/dyad/account/login', { code: '12345' });
  const jwt = auth.jwt;
  console.log('✓ login');

  // 2. create session
  const sessionId = await req('POST', '/dyad/session/new', {
    topic: { category: 'free', subtopic: null, subtopic_description: null },
    timezone: 'America/Los_Angeles',
  }, jwt);
  console.log('✓ session created:', sessionId);

  // 3. start session
  const started = await req('POST', `/dyad/session/${sessionId}/start`, null, jwt);
  console.log('✓ session started (parent turn)');

  // 4. send parent message → get child card recommendation
  const parentResp = await req('POST', `/dyad/session/${sessionId}/message/parent/message/text`,
    { message: 'What do you want to do today?' }, jwt);
  const rec = parentResp.payload;
  console.log('✓ parent message sent, cards:', rec.cards.map(c => c.label));
  const cards = rec.cards.slice(0, 3);
  if (cards.length < 3) { console.error('Need at least 3 cards, got', cards.length); process.exit(1); }
  console.log('Using cards:', cards.map(c => c.label));

  // 4. add card 0
  const r0 = await req('POST', `/dyad/session/${sessionId}/message/child/add_card`,
    { id: cards[0].id, recommendation_id: rec.id }, jwt);
  console.log('add[0] interim:', r0.interim_cards.map(c => c.label));

  // 5. add card 1
  const r1 = await req('POST', `/dyad/session/${sessionId}/message/child/add_card`,
    { id: cards[1].id, recommendation_id: rec.id }, jwt);
  console.log('add[1] interim:', r1.interim_cards.map(c => c.label));

  // 6. add card 2
  const r2 = await req('POST', `/dyad/session/${sessionId}/message/child/add_card`,
    { id: cards[2].id, recommendation_id: rec.id }, jwt);
  console.log('add[2] interim:', r2.interim_cards.map(c => c.label));

  // 7. remove index 1
  const rm1 = await req('PUT', `/dyad/session/${sessionId}/message/child/pop_last_card`,
    { index: 1 }, jwt);
  console.log('remove[1] interim:', rm1.interim_cards.map(c => c.label));
  const expected1 = [cards[0].label, cards[2].label];
  if (JSON.stringify(rm1.interim_cards.map(c => c.label)) !== JSON.stringify(expected1)) {
    console.error('❌ Expected', expected1, 'got', rm1.interim_cards.map(c => c.label));
  } else {
    console.log('✓ remove[1] correct');
  }

  // 8. remove index 0
  const rm0 = await req('PUT', `/dyad/session/${sessionId}/message/child/pop_last_card`,
    { index: 0 }, jwt);
  console.log('remove[0] interim:', rm0.interim_cards.map(c => c.label));
  const expected0 = [cards[2].label];
  if (JSON.stringify(rm0.interim_cards.map(c => c.label)) !== JSON.stringify(expected0)) {
    console.error('❌ Expected', expected0, 'got', rm0.interim_cards.map(c => c.label));
  } else {
    console.log('✓ remove[0] correct');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
