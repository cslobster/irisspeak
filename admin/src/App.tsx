import { useState, useEffect } from 'react';
import { LoginScreen } from './components/LoginScreen';
import { Dashboard } from './components/Dashboard';
import { hasToken, clearToken } from './api';

export default function App() {
  const [authed, setAuthed] = useState(hasToken());

  useEffect(() => {
    const id = setInterval(() => {
      if (!hasToken()) setAuthed(false);
    }, 5000);
    return () => clearInterval(id);
  }, []);

  function onLogin() { setAuthed(true); }
  function onLogout() { clearToken(); setAuthed(false); }

  if (!authed) return <LoginScreen onLogin={onLogin} />;
  return <Dashboard onLogout={onLogout} />;
}
