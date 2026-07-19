import { Routes, Route, Navigate } from 'react-router-dom'
import { CallProvider } from './contexts/CallProvider'

// ── Pages we've built together in this project ──────────────────────────
import MessagesPage from './pages/MessagesPage'
import NewsFeedPage from './pages/NewsFeedPage'
import CreatePostPage from './pages/CreatePostPage'
import AdminPage from './pages/AdminPage'

// ── Pages referenced by navigate(...) calls throughout the app, but not
// shared with me directly in this conversation. Adjust these import paths
// (and filenames) to match whatever you actually called them — everything
// else in this file will keep working regardless. ──────────────────────
import LoginPage from './pages/LoginPage'
import WelcomePage from './pages/WelcomePage'
import DashboardPage from './pages/DashboardPage'
import ProfilePage from './pages/ProfilePage'
import KioskPage from './pages/KioskPage'

export default function App() {
  return (
    // CallProvider sits ABOVE the routes so its realtime "calls" subscription
    // survives every navigation — it's what makes a call ring no matter which
    // page you're currently on, instead of only while Messages is open.
    // NOTE: no <BrowserRouter> here — main.tsx already provides one. Having
    // two nested Routers is exactly what was causing the blank white screen.
    <CallProvider>
      <Routes>
        {/* Auth */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/welcome" element={<WelcomePage />} />

        {/* Core app */}
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/news-feed" element={<NewsFeedPage />} />
        <Route path="/create-post" element={<CreatePostPage />} />

        {/* Messages — :userId is optional; MessagesPage opens straight into
            a DM with that person when it's present (see useParams in the
            component), otherwise it just opens the inbox. */}
        <Route path="/messages" element={<MessagesPage />} />
        <Route path="/messages/:userId" element={<MessagesPage />} />

        {/* Admin (the page itself already redirects non-admins to /dashboard) */}
        <Route path="/admin" element={<AdminPage />} />

        {/* Profile */}
        <Route path="/profile/:userId" element={<ProfilePage />} />

        {/* Kiosk — full-screen display view, no nav chrome */}
        <Route path="/kiosk" element={<KioskPage />} />

        {/* Fallbacks */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </CallProvider>
  )
}
