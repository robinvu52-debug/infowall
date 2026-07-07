import { Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import CreatePostPage from './pages/CreatePostPage'
import AdminPage from './pages/AdminPage'
import KioskPage from './pages/KioskPage'
import WelcomePage from './pages/WelcomePage'
import NewsFeedPage from './pages/NewsFeedPage'
import ProfilePage from './pages/ProfilePage'
import MessagesPage from './pages/MessagesPage'
import ProtectedRoute from './components/ProtectedRoute'

function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/" element={<Navigate to="/kiosk" replace />} />
      <Route path="/kiosk" element={<KioskPage />} />
      <Route path="/login" element={<LoginPage />} />

      {/* All authenticated staff */}
      <Route path="/welcome"  element={<ProtectedRoute><WelcomePage /></ProtectedRoute>} />
      <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
      <Route path="/feed"     element={<ProtectedRoute><NewsFeedPage /></ProtectedRoute>} />
      <Route path="/messages" element={<ProtectedRoute><MessagesPage /></ProtectedRoute>} />
      <Route path="/messages/:userId" element={<ProtectedRoute><MessagesPage /></ProtectedRoute>} />
      <Route path="/profile/:id" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />

      {/* HR, Manager, Admin only — post creation */}
      <Route path="/create-post" element={
        <ProtectedRoute allowedRoles={['hr', 'manager', 'admin']}>
          <CreatePostPage />
        </ProtectedRoute>
      } />

      {/* Admin only */}
      <Route path="/admin" element={
        <ProtectedRoute allowedRoles={['admin']}>
          <AdminPage />
        </ProtectedRoute>
      } />

      <Route path="*" element={<Navigate to="/kiosk" replace />} />
    </Routes>
  )
}

export default App