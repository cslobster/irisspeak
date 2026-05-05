import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { SignInScreen } from './screens/SignInScreen';
import { HomeScreen } from './screens/HomeScreen';
import { FreeTopicScreen } from './screens/FreeTopicScreen';
import { SessionScreen } from './screens/SessionScreen';
import { SessionEndScreen } from './screens/SessionEndScreen';
import { StarsScreen } from './screens/StarsScreen';
import { useSelector } from './store';

function RequireAuth({ children }: { children: JSX.Element }) {
  const jwt = useSelector(s => s.auth.jwt);
  const loc = useLocation();
  if (!jwt) return <Navigate to="/" replace state={{ from: loc }} />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<SignInScreen />} />
      <Route path="/home" element={<RequireAuth><HomeScreen /></RequireAuth>} />
      <Route path="/free-topic" element={<RequireAuth><FreeTopicScreen /></RequireAuth>} />
      <Route path="/session/:sessionId" element={<RequireAuth><SessionScreen /></RequireAuth>} />
      <Route path="/session-end/:sessionId" element={<RequireAuth><SessionEndScreen /></RequireAuth>} />
      <Route path="/stars" element={<RequireAuth><StarsScreen /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
