import { Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import CreatePostPage from './pages/CreatePostPage'
import AdminPage from './pages/AdminPage'
import KioskPage from './pages/KioskPage'
import WelcomePage from './pages/WelcomePage'
import NewsFeedPage from './pages/NewsFeedPage'
import ProfilePage from './pages/ProfilePage'
import ProtectedRoute from './components/ProtectedRoute'

function App() {
  return (
    <Routes>
      {/* Root → kiosk (public display) */}
      <Route path="/" element={<Navigate to="/kiosk" replace />} />

      {/* Kiosk — no login required */}
      <Route path="/kiosk" element={<KioskPage />} />

      {/* Auth */}
      <Route path="/login" element={<LoginPage />} />

      {/* Protected */}
      <Route path="/welcome" element={<ProtectedRoute><WelcomePage /></ProtectedRoute>} />
      <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
      <Route path="/feed" element={<ProtectedRoute><NewsFeedPage /></ProtectedRoute>} />
      <Route path="/profile/:id" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
      <Route path="/create-post" element={<ProtectedRoute allowedRoles={['hr','manager','admin']}><CreatePostPage /></ProtectedRoute>} />
      <Route path="/admin" element={<ProtectedRoute allowedRoles={['admin']}><AdminPage /></ProtectedRoute>} />

      <Route path="*" element={<Navigate to="/kiosk" replace />} />
    </Routes>
  )
}

export default App