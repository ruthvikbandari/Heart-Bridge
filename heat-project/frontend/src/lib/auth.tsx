import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { api, setUnauthorizedHandler } from "./api"
import type { Me } from "./types"

type AuthValue = {
  user: Me | null
  loading: boolean
  refresh: () => Promise<void>
  login: (email: string, password: string) => Promise<Me>
  register: (email: string, password: string, displayName: string) => Promise<Me>
  logout: () => Promise<void>
  setUser: (user: Me | null) => void
}

const AuthContext = createContext<AuthValue | null>(null)

function applyMotion(user: Me | null) {
  const root = document.documentElement
  root.classList.toggle("reduce-motion", Boolean(user?.consents.reduced_motion))
  root.classList.toggle("low-bandwidth", Boolean(user?.consents.low_bandwidth))
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)

  async function refresh() {
    try {
      const me = await api<Me>("/api/me")
      setUser(me)
      applyMotion(me)
    } catch {
      setUser(null)
      applyMotion(null)
    }
  }

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null)
      applyMotion(null)
    })
    refresh().finally(() => setLoading(false))
  }, [])

  const value = useMemo<AuthValue>(
    () => ({
      user,
      loading,
      refresh,
      setUser: (next) => {
        setUser(next)
        applyMotion(next)
      },
      login: async (email, password) => {
        const me = await api<Me>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) })
        setUser(me)
        applyMotion(me)
        return me
      },
      register: async (email, password, displayName) => {
        const me = await api<Me>("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({ email, password, display_name: displayName }),
        })
        setUser(me)
        applyMotion(me)
        return me
      },
      logout: async () => {
        await api("/api/auth/logout", { method: "POST" })
        setUser(null)
        applyMotion(null)
      },
    }),
    [user, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error("AuthProvider is missing")
  return value
}
