export default function Home() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 32, maxWidth: 720 }}>
      <h1>Iris Speak Backend (Next.js)</h1>
      <p>API base: <code>/api/v1</code></p>
      <ul>
        <li><code>HEAD /api/v1/ping</code> — health</li>
        <li><code>POST /api/v1/dyad/account/login</code> — body <code>{`{ "code": "12345" }`}</code></li>
        <li><code>GET  /api/v1/dyad/data/freetopics</code></li>
        <li><code>POST /api/v1/dyad/session/new</code> — body <code>{`{ "topic": { "category": "free" }, "timezone": "..." }`}</code></li>
        <li><code>POST /api/v1/dyad/session/[id]/start</code> — static initial parent guides</li>
        <li><code>POST /api/v1/dyad/session/[id]/device/turn</code> — mirror an on-device parent/child turn</li>
        <li><code>GET  /api/v1/dyad/session/[id]/message/all</code> — full transcript</li>
        <li><code>PUT  /api/v1/dyad/session/[id]/end</code></li>
      </ul>
      <p>Card generation and sentence inference run on-device in the web client — see the root README.</p>
    </main>
  );
}
