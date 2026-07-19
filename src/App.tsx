import { Navigate, Route, Routes } from 'react-router-dom'
import { ThemeProvider } from './contexts/ThemeContext'
import { PresenceProvider } from './contexts/PresenceContext'
import { CallProvider } from './contexts/CallProvider'
import LoginPage from './pages/LoginPage'
import WelcomePage from './pages/WelcomePage'
import DashboardPage from './pages/DashboardPage'
import NewsFeedPage from './pages/NewsFeedPage'
import MessagesPage from './pages/MessagesPage'
import ChannelsPage from './pages/ChannelsPage'
import CreatePostPage from './pages/CreatePostPage'
import AdminPage from './pages/AdminPage'
import ProfilePage from './pages/ProfilePage'
import KioskPage from './pages/KioskPage'
import EmployeeDirectoryPage from './pages/EmployeeDirectoryPage'
import SettingsPage from './pages/SettingsPage'
import ProtectedRoute from './components/ProtectedRoute'

export default function App() {
  return (
    <ThemeProvider>
      <PresenceProvider>
        {/* CallProvider sits inside Theme/Presence but ABOVE <Routes>, so its
            realtime "calls" subscription survives every navigation — that's
            what makes a call ring no matter which page is open, instead of
            only while Messages happens to be mounted. Nothing else below
            this line changed from your original file. */}
        <CallProvider>
          <Routes>
            <Route path="/" element={<Navigate to="/kiosk" replace />} />
            <Route path="/kiosk" element={<KioskPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/welcome" element={<ProtectedRoute><WelcomePage /></ProtectedRoute>} />
            <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
            <Route path="/feed" element={<ProtectedRoute><NewsFeedPage /></ProtectedRoute>} />
            <Route path="/channels" element={<ProtectedRoute><ChannelsPage /></ProtectedRoute>} />
            <Route path="/channels/:channelId" element={<ProtectedRoute><ChannelsPage /></ProtectedRoute>} />
            <Route path="/messages" element={<ProtectedRoute><MessagesPage /></ProtectedRoute>} />
            <Route path="/messages/:userId" element={<ProtectedRoute><MessagesPage /></ProtectedRoute>} />
            <Route path="/directory" element={<ProtectedRoute><EmployeeDirectoryPage /></ProtectedRoute>} />
            <Route path="/profile/:id" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
            <Route path="/create-post" element={<ProtectedRoute roles={['hr','manager','admin']}><CreatePostPage /></ProtectedRoute>} />
            <Route path="/admin" element={<ProtectedRoute roles={['admin']}><AdminPage /></ProtectedRoute>} />
          </Routes>
        </CallProvider>
      </PresenceProvider>
    </ThemeProvider>
  )
}
