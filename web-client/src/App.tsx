import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { SignInScreen } from './screens/SignInScreen';
import { WelcomeScreen } from './screens/WelcomeScreen';
import { SessionScreen } from './screens/SessionScreen';
import { SessionEndScreen } from './screens/SessionEndScreen';
import { StarsScreen } from './screens/StarsScreen';
import { MuteButton } from './components/MuteButton';
import { SettingsButton } from './components/SettingsButton';
import { useSelector } from './store';

function RequireAuth({ children }: { children: JSX.Element }) {
  const jwt = useSelector(s => s.auth.jwt);
  const loc = useLocation();
  if (!jwt) return <Navigate to="/" replace state={{ from: loc }} />;
  return children;
}

// Redirect already-authenticated users away from the login screen.
function RedirectIfAuthed({ children }: { children: JSX.Element }) {
  const jwt = useSelector(s => s.auth.jwt);
  if (jwt) return <Navigate to="/home" replace />;
  return children;
}

export default function App() {
  return (
    <>
      <div className="fixed top-5 right-5 z-50 flex items-center gap-3">
        <MuteButton />
        <SettingsButton />
      </div>
      <Routes>
        <Route path="/" element={<RedirectIfAuthed><SignInScreen /></RedirectIfAuthed>} />
        <Route path="/home" element={<RequireAuth><WelcomeScreen /></RequireAuth>} />
        <Route path="/session/:sessionId" element={<RequireAuth><SessionScreen /></RequireAuth>} />
        <Route path="/session-end/:sessionId" element={<RequireAuth><SessionEndScreen /></RequireAuth>} />
        <Route path="/stars" element={<RequireAuth><StarsScreen /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
