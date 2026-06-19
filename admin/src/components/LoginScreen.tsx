import { useState } from 'react';
import { adminApi, saveToken } from '../api';

export function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!pw.trim() || loading) return;
    setLoading(true);
    setError('');
    try {
      const { token } = await adminApi.login(pw.trim());
      saveToken(token);
      onLogin();
    } catch (e: any) {
      setError(e.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center p-6">
      <div className="bg-white rounded-3xl shadow-2xl p-10 w-full max-w-sm">
        <h1 className="text-3xl font-extrabold text-slate-800 mb-1">AACessTalk</h1>
        <p className="text-slate-500 text-sm font-semibold mb-8">Admin Portal</p>

        {error && (
          <p className="mb-4 text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2 font-semibold">{error}</p>
        )}

        <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
          Admin Password
        </label>
        <input
          type="password"
          autoFocus
          value={pw}
          onChange={e => setPw(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder="Enter admin password"
          className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-base mb-5 focus:outline-none focus:border-indigo-400 transition"
        />
        <button
          onClick={submit}
          disabled={!pw.trim() || loading}
          className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-base transition"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </div>
    </div>
  );
}
