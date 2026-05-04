export default function Home() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 32, maxWidth: 720 }}>
      <h1>AACessTalk Backend (Next.js)</h1>
      <p>API base: <code>/api/v1</code></p>
      <ul>
        <li><code>HEAD /api/v1/ping</code> — health</li>
        <li><code>POST /api/v1/dyad/account/login</code> — body <code>{`{ "code": "12345" }`}</code></li>
        <li><code>GET  /api/v1/dyad/data/freetopics</code></li>
        <li><code>POST /api/v1/dyad/session</code> — body <code>{`{ "topic": { "category": "recall" }, "timezone": "..." }`}</code></li>
        <li><code>POST /api/v1/dyad/session/[id]/start</code></li>
        <li><code>POST /api/v1/dyad/session/[id]/message/parent/message/text</code></li>
        <li><code>POST /api/v1/dyad/session/[id]/message/child/add_card</code></li>
        <li><code>POST /api/v1/dyad/session/[id]/message/child/confirm_cards</code></li>
      </ul>
    </main>
  );
}
