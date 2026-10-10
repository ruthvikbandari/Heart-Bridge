import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { Navigate, Route, Routes } from "react-router-dom"
import { Layout } from "./components/Layout"
import { Spinner } from "./components/ui"
import { useAuth } from "./lib/auth"
import { AdminPage, JournalPage, NotificationsPage, PrepPage, PrivacyPage, ProfilePage, SavedPage } from "./pages/Account"
import { AIChat } from "./pages/AIChat"
import { Appointments, DoctorDetail, Doctors } from "./pages/Care"
import { Communities, CommunityDetail } from "./pages/Communities"
import { Home } from "./pages/Home"
import { Messages } from "./pages/Messages"
import { Onboarding } from "./pages/Onboarding"
import { PostPage } from "./pages/PostPage"
import { ForgotPassword, Landing, SignIn, SignUp } from "./pages/Public"

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

function RequireAuth({ children, onboarding = false }: { children: ReactNode; onboarding?: boolean }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="grid min-h-screen place-items-center"><Spinner label="Opening HeartBridge" /></div>
  if (!user) return <Navigate to="/signin" replace />
  if (!onboarding && !user.onboarded) return <Navigate to="/onboarding" replace />
  if (onboarding && user.onboarded) return <Navigate to="/home" replace />
  return children
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/signin" element={<SignIn />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/onboarding" element={<RequireAuth onboarding><Onboarding /></RequireAuth>} />
        <Route element={<RequireAuth><Layout /></RequireAuth>}>
          <Route path="/home" element={<Home />} />
          <Route path="/companion" element={<AIChat />} />
          <Route path="/companion/:id" element={<AIChat />} />
          <Route path="/communities" element={<Communities />} />
          <Route path="/communities/:slug" element={<CommunityDetail />} />
          <Route path="/posts/:id" element={<PostPage />} />
          <Route path="/messages" element={<Messages />} />
          <Route path="/messages/:id" element={<Messages />} />
          <Route path="/doctors" element={<Doctors />} />
          <Route path="/doctors/:id" element={<DoctorDetail />} />
          <Route path="/appointments" element={<Appointments />} />
          <Route path="/appointments/:id" element={<Appointments />} />
          <Route path="/saved" element={<SavedPage />} />
          <Route path="/journal" element={<JournalPage />} />
          <Route path="/prep" element={<PrepPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/profile/:id" element={<ProfilePage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Route>
        <Route path="*" element={<div className="grid min-h-screen place-items-center"><p>That page does not exist. <a className="text-teal" href="/">Go home</a></p></div>} />
      </Routes>
    </QueryClientProvider>
  )
}
