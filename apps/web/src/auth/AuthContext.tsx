import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { api, setToken, getToken, type User } from '../api/client'

type AuthState = {
  user: User | null
  loading: boolean
  needsSetup: boolean
  login: (email: string, password: string) => Promise<void>
  setup: (email: string, password: string) => Promise<void>
  logout: () => void
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [needsSetup, setNeedsSetup] = useState(false)

  const refresh = useCallback(async () => {
    const status = await api.setupStatus()
    setNeedsSetup(status.needs_setup)
    if (status.needs_setup) {
      setUser(null)
      return
    }
    if (!getToken()) {
      setUser(null)
      return
    }
    try {
      const me = await api.me()
      setUser(me)
    } catch {
      setToken(null)
      setUser(null)
    }
  }, [])

  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [refresh])

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login(email, password)
    setToken(res.token)
    setUser(res.user)
    setNeedsSetup(false)
  }, [])

  const setup = useCallback(async (email: string, password: string) => {
    const res = await api.setup(email, password)
    setToken(res.token)
    setUser(res.user)
    setNeedsSetup(false)
  }, [])

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({ user, loading, needsSetup, login, setup, logout, refresh }),
    [user, loading, needsSetup, login, setup, logout, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
