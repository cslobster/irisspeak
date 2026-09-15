// "Sign in with Google" — same look on irisspeak.org and irisspeak.com. A plain link: the API does the
// OAuth dance server-side and sends the browser back with a dyad JWT (see api/remote.ts googleSignInUrl).
export function GoogleButton({ href, disabled }: { href: string; disabled?: boolean }) {
  return (
    <a href={disabled ? undefined : href} aria-disabled={disabled}
      className="flex items-center justify-center gap-3 w-full rounded-xl px-4 py-3 text-base font-bold text-slate-700 bg-white border-2 border-slate-200 hover:border-slate-400 transition"
      style={{ opacity: disabled ? 0.4 : 1, pointerEvents: disabled ? 'none' : 'auto' }}>
      <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/>
        <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z"/>
        <path fill="#FBBC05" d="M10.5 28.6c-.5-1.5-.8-3-.8-4.6s.3-3.1.8-4.6l-7.9-6.1C.9 16.6 0 20.2 0 24s.9 7.4 2.6 10.7l7.9-6.1z"/>
        <path fill="#34A853" d="M24 48c6.3 0 11.7-2.1 15.6-5.7l-7.7-6c-2.1 1.4-4.8 2.3-7.9 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/>
      </svg>
      Sign in with Google
    </a>
  );
}
