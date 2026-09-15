import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { completeGoogleSignIn } from '../api/remote';
import { Spinner } from '../components/Spinner';

// #/google?jwt=…&alias=…&child_name=…[&new=1]  or  #/google?error=…  — where the API sends the browser
// after Google sign-in. New accounts go to the Profile screen first so the parent can set the child's name.
export function GoogleCallbackScreen() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const jwt = params.get('jwt');
    const err = params.get('error');
    if (!jwt) { setError(err || 'missing_token'); return; }
    completeGoogleSignIn(jwt, params.get('alias') || undefined, params.get('child_name') || undefined)
      .then(() => nav('/home', { replace: true }))   // a brand-new account is sent through /setup by RequireAuth
      .catch(() => setError('Network'));
  }, []);
  const msg = error === 'AccountPendingApproval' ? 'This account is waiting for approval.'
    : error === 'email_not_verified' ? 'Your Google email address is not verified.'
    : error === 'access_denied' ? 'Google sign-in was cancelled.'
    : error ? 'Google sign-in failed — please try again.' : null;
  return (
    <div className="relative min-h-screen overflow-hidden flex items-center justify-center px-6" style={{ background: '#f0ebe1' }}>
      <div className="bg-white rounded-3xl p-8 w-full max-w-sm text-center" style={{ boxSizing: 'border-box', border: '3px solid #000', borderBottomWidth: 8 }}>
        {msg ? (<>
          <p className="mb-5 text-sm font-semibold text-[#f09281] bg-[#f09281]/10 rounded-xl px-3 py-2">{msg}</p>
          <Link to="/" className="pill-btn bg-[#94c1c2] inline-block">Back to sign in</Link>
        </>) : (
          <div className="flex items-center justify-center gap-3 py-4"><Spinner size={20} strokeWidth={6} /><p className="text-base font-semibold text-slate-500">Signing in with Google…</p></div>
        )}
      </div>
    </div>
  );
}
