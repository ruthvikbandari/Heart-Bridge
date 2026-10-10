import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Bookmark,
  CalendarDays,
  House,
  LogOut,
  Moon,
  MessagesSquare,
  NotebookPen,
  Shield,
  Sparkles,
  Stethoscope,
  Sun,
  Users,
} from "lucide-react"
import { useEffect, useState } from "react"
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom"
import { api } from "../lib/api"
import { useAuth } from "../lib/auth"
import type { Meta } from "../lib/types"

const links = [
  { to: "/home", label: "Home", icon: House },
  { to: "/companion", label: "AI Companion", icon: Sparkles },
  { to: "/communities", label: "Communities", icon: Users },
  { to: "/messages", label: "Messages", icon: MessagesSquare },
  { to: "/doctors", label: "Doctors", icon: Stethoscope },
  { to: "/appointments", label: "Appointments", icon: CalendarDays },
  { to: "/saved", label: "Saved", icon: Bookmark },
  { to: "/journal", label: "Journal", icon: NotebookPen },
  { to: "/prep", label: "Prep notes", icon: NotebookPen },
  { to: "/privacy", label: "Privacy", icon: Shield },
]

export function Layout() {
  const { user, logout } = useAuth()
  const location = useLocation()
  const isCompanion = location.pathname === "/companion" || location.pathname.startsWith("/companion/")
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [online, setOnline] = useState(navigator.onLine)
  const [socket, setSocket] = useState<"live" | "polling">("polling")
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try {
      return localStorage.getItem("heartbridge-theme") === "dark" ? "dark" : "light"
    } catch {
      return "light"
    }
  })
  const meta = useQuery({ queryKey: ["meta"], queryFn: () => api<Meta>("/api/meta") })
  const inbox = useQuery({
    queryKey: ["inbox"],
    queryFn: () => api<{ unread_messages: number; unread_notifications: number }>("/api/inbox/summary"),
    refetchInterval: 15000,
  })

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener("online", on)
    window.addEventListener("offline", off)
    return () => {
      window.removeEventListener("online", on)
      window.removeEventListener("offline", off)
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem("heartbridge-theme", theme)
    } catch {
      // Keep the selected theme for this page session when storage is unavailable.
    }
  }, [theme])

  useEffect(() => {
    let current: WebSocket | null = null
    let stopped = false
    let timer = 0
    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss" : "ws"
      current = new WebSocket(`${protocol}://${window.location.host}/api/ws`)
      current.onopen = () => setSocket("live")
      current.onmessage = () => {
        queryClient.invalidateQueries({ queryKey: ["inbox"] })
        queryClient.invalidateQueries({ queryKey: ["conversations"] })
        queryClient.invalidateQueries({ queryKey: ["notifications"] })
        queryClient.invalidateQueries({ queryKey: ["thread"] })
      }
      current.onclose = () => {
        setSocket("polling")
        if (!stopped) timer = window.setTimeout(connect, 4000)
      }
    }
    connect()
    return () => {
      stopped = true
      window.clearTimeout(timer)
      current?.close()
    }
  }, [queryClient])

  const primary = links.slice(0, 5)
  return (
    <div className={isCompanion ? "min-h-screen bg-[#0b0b0b] text-[#e8eaed]" : "min-h-screen bg-cream text-ink"}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-paper focus:px-3 focus:py-2">
        Skip to content
      </a>
      {!isCompanion && meta.data?.demo_banner ? (
        <div className="bg-navy px-4 py-2 text-center text-sm text-cream">
          Demo workspace. Members, posts, clinicians, and appointments are fictional. HeartBridge is not a clinic or an emergency service.
        </div>
      ) : null}
      {!isCompanion && !online ? <div className="bg-warn px-4 py-2 text-center text-sm text-white">You appear to be offline. Drafts stay in the box until you reconnect.</div> : null}
      <div className="flex w-full">
        {!isCompanion ? <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line bg-navy px-4 py-6 text-cream md:flex">
          <p className="font-serif text-3xl text-white">HeartBridge</p>
          <p className="mt-1 text-sm text-cream/70">A conversation, then a next step.</p>
          <nav className="mt-8 flex flex-1 flex-col gap-1" aria-label="Primary">
            {links.map((link) => (
              <NavLink key={link.to} to={link.to} className={({ isActive }) => `flex items-center gap-3 rounded-2xl px-3 py-2 text-sm ${isActive ? "bg-white/10 text-white" : "text-cream/80 hover:bg-white/5"}`}>
                <link.icon size={18} aria-hidden="true" />
                {link.label}
                {link.to === "/messages" && inbox.data?.unread_messages ? <span className="ml-auto rounded-full bg-teal px-2 text-xs">{inbox.data.unread_messages}</span> : null}
              </NavLink>
            ))}
            {user && (user.role === "admin" || user.role === "moderator") ? (
              <NavLink to="/admin" className={({ isActive }) => `rounded-2xl px-3 py-2 text-sm ${isActive ? "bg-white/10" : "text-cream/80"}`}>Moderation</NavLink>
            ) : null}
          </nav>
          <div className="space-y-2 text-sm">
            <p className="text-cream/70">{socket === "live" ? "Live updates on" : "Checking for updates"}</p>
            <NavLink to="/profile" className="block rounded-2xl px-3 py-2 hover:bg-white/5">{user?.profile.display_name}</NavLink>
            <button type="button" className="flex items-center gap-2 rounded-2xl px-3 py-2 hover:bg-white/5" onClick={() => setTheme((value) => value === "light" ? "dark" : "light")} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}>
              {theme === "light" ? <Moon size={16} aria-hidden="true" /> : <Sun size={16} aria-hidden="true" />}
              {theme === "light" ? "Dark mode" : "Light mode"}
            </button>
            <button
              type="button"
              className="flex items-center gap-2 px-3 py-2"
              onClick={() => logout().then(() => navigate("/"))}
            >
              <LogOut size={16} aria-hidden="true" /> Sign out
            </button>
          </div>
        </aside> : null}
        <div className={isCompanion ? "min-w-0 flex-1" : "min-w-0 flex-1 pb-32 md:pb-8"}>
          <main id="main" className={isCompanion ? "min-h-screen p-0" : "px-4 py-6 md:px-8"}>
            <Outlet />
          </main>
        </div>
      </div>
      {!isCompanion ? <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 border-t border-line bg-paper px-2 py-2 md:hidden" aria-label="Mobile">
        {primary.map((link) => (
          <NavLink key={link.to} to={link.to} className={({ isActive }) => `flex flex-col items-center gap-1 rounded-2xl px-1 py-1 text-[11px] ${isActive ? "text-teal" : "text-muted"}`}>
            <link.icon size={18} aria-hidden="true" />
            {link.label === "AI Companion" ? "Companion" : link.label}
          </NavLink>
        ))}
        <button type="button" className="flex flex-col items-center gap-1 rounded-2xl px-1 py-1 text-[11px] text-muted" onClick={() => setTheme((value) => value === "light" ? "dark" : "light")} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}>
          {theme === "light" ? <Moon size={18} aria-hidden="true" /> : <Sun size={18} aria-hidden="true" />}
          {theme === "light" ? "Dark" : "Light"}
        </button>
      </nav> : null}
    </div>
  )
}
