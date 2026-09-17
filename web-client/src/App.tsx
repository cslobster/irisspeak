import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { WelcomeScreen } from './screens/WelcomeScreen';
import { SessionScreen } from './screens/SessionScreen';
import { SessionEndScreen } from './screens/SessionEndScreen';
import { StarsScreen } from './screens/StarsScreen';
import { ProfileSettingsScreen } from './screens/ProfileSettingsScreen';
import { VocabularySettingsScreen } from './screens/VocabularySettingsScreen';
import { SignInScreen } from './screens/SignInScreen';
import { SignupWizardScreen } from './screens/SignupWizardScreen';
import { GoogleCallbackScreen } from './screens/GoogleCallbackScreen';
import { SetupScreen } from './screens/SetupScreen';
import { CreditsScreen } from './screens/CreditsScreen';
import { SettingsButton } from './components/SettingsButton';
import { SettingsCloseButton } from './components/SettingsCloseButton';
import { isSignedIn, needsSetup } from './api/remote';

// Same flow as irisspeak.com: sign in (or continue as guest) first, then the welcome page; the account,
// profile, custom words and conversations are shared with irisspeak.com's backend. Cards are chosen on the device.
function RequireAuth({ children }: { children: JSX.Element }) {
  const loc = useLocation();
  if (!isSignedIn()) return <Navigate to="/" replace state={{ from: loc }} />;
  if (needsSetup() && loc.pathname !== '/setup') return <Navigate to="/setup" replace />;   // first run: boy/girl, age, notes
  return children;
}
function RedirectIfAuthed({ children }: { children: JSX.Element }) {
  if (isSignedIn()) return <Navigate to="/home" replace />;
  return children;
}

export default function App() {
  return (
    <>
      <div className="fit-topright fixed z-50 flex items-center gap-3">
        <SettingsButton />
        <SettingsCloseButton />
      </div>
      <Routes>
        <Route path="/" element={<RedirectIfAuthed><SignInScreen /></RedirectIfAuthed>} />
        <Route path="/signup" element={<RedirectIfAuthed><SignupWizardScreen /></RedirectIfAuthed>} />
        <Route path="/google" element={<GoogleCallbackScreen />} />
        <Route path="/setup" element={<RequireAuth><SetupScreen /></RequireAuth>} />
        <Route path="/credits" element={<CreditsScreen />} />
        <Route path="/home" element={<RequireAuth><WelcomeScreen /></RequireAuth>} />
        <Route path="/session/:sessionId" element={<RequireAuth><SessionScreen /></RequireAuth>} />
        <Route path="/session-end/:sessionId" element={<RequireAuth><SessionEndScreen /></RequireAuth>} />
        <Route path="/stars" element={<RequireAuth><StarsScreen /></RequireAuth>} />
        <Route path="/vocabulary" element={<RequireAuth><VocabularySettingsScreen /></RequireAuth>} />
        <Route path="/profile" element={<RequireAuth><ProfileSettingsScreen /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
