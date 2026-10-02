import { validateAuth } from "../authValidation"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  ensurePersistentSession,
  getErrorMessage,
  hasRefreshSession,
  revokePersistentSession,
} from "../../../api/httpClient"

import { REFRESH_KEY, TOKEN_KEY, USER_KEY } from "../../../constants/session"
import { emptyStatus } from "../../../constants/uiState"
import { api } from "../../../services/bunkermodeApi"
import { clearOverview } from "../../../state/overviewCache"
import { clearFinanceSnapshots } from "../../../state/financeCache"
import { clearOrientationCache } from "../../../state/orientationCache"
import { allowUserData, clearUserData } from "../../../offline/snapshots"
import {
  getApiAvailability,
  subscribeApiAvailability,
  subscribeApiRetry,
  subscribeApiSuccess,
} from "../../../offline/apiAvailability"
import { focusStorageKey, durationStorageKey } from "../../tasks/focusSession"

const persistentStore = window.localStorage
const sessionStore = window.sessionStorage

function removeStoredSession() {
  persistentStore.removeItem(TOKEN_KEY)
  persistentStore.removeItem(USER_KEY)
  persistentStore.removeItem(REFRESH_KEY)
  sessionStore.removeItem(TOKEN_KEY)
  sessionStore.removeItem(USER_KEY)
}

function migrateSessionStorage() {
  const sessionToken = sessionStore.getItem(TOKEN_KEY)
  const sessionUser = sessionStore.getItem(USER_KEY)

  if (sessionToken && !persistentStore.getItem(TOKEN_KEY)) {
    persistentStore.setItem(TOKEN_KEY, sessionToken)
  }

  if (sessionUser && !persistentStore.getItem(USER_KEY)) {
    persistentStore.setItem(USER_KEY, sessionUser)
  }

  sessionStore.removeItem(TOKEN_KEY)
  sessionStore.removeItem(USER_KEY)
}

migrateSessionStorage()

function readStoredUser() {
  const rawUser = persistentStore.getItem(USER_KEY)
  if (!rawUser) {
    return null
  }

  try {
    const parsed = JSON.parse(rawUser)
    if (
      !Number.isSafeInteger(parsed?.id) ||
      parsed.id <= 0 ||
      typeof parsed.usuario !== "string" ||
      (parsed.enabled_modules !== undefined && !Array.isArray(parsed.enabled_modules))
    ) {
      removeStoredSession()
      return null
    }
    allowUserData(parsed.id)
    return parsed
  } catch {
    removeStoredSession()
    return null
  }
}

export function useAuthSession() {
  const [token, setToken] = useState(() => {
    if (!readStoredUser()) {
      removeStoredSession()
      return null
    }
    return persistentStore.getItem(TOKEN_KEY) || (hasRefreshSession() ? "pending" : null)
  })
  const [user, setUser] = useState(readStoredUser)
  const [sessionValidated, setSessionValidated] = useState(
    () => !persistentStore.getItem(TOKEN_KEY) && !hasRefreshSession()
  )
  const [sessionMode, setSessionMode] = useState<"online" | "local" | "none">("none")
  const [booting, setBooting] = useState(() =>
    Boolean(persistentStore.getItem(TOKEN_KEY) || hasRefreshSession())
  )
  const [authStatus, setAuthStatus] = useState(emptyStatus)
  const [authLoading, setAuthLoading] = useState(false)
  const sessionRequestId = useRef(0)
  const revalidating = useRef(false)
  const skipRestoreToken = useRef(null)

  const authenticated = Boolean(token && user && sessionValidated)

  const persistUser = useCallback((nextUser) => {
    allowUserData(nextUser.id)
    persistentStore.setItem(USER_KEY, JSON.stringify(nextUser))
    setUser(nextUser)
  }, [])

  const updateCurrentUser = useCallback(
    (nextUser) => {
      persistUser(nextUser)
    },
    [persistUser]
  )

  const clearSession = useCallback(
    (revoke = false) => {
      const revocation = revoke ? revokePersistentSession() : Promise.resolve()
      sessionRequestId.current += 1
      const ownerId = user?.id ?? readStoredUser()?.id
      const cleanup = ownerId ? clearUserData(ownerId) : Promise.resolve()
      if (ownerId) {
        persistentStore.removeItem(focusStorageKey(ownerId))
        persistentStore.removeItem(durationStorageKey(ownerId))
      }
      clearOverview()
      clearFinanceSnapshots()
      clearOrientationCache()
      removeStoredSession()
      setToken(null)
      setUser(null)
      setSessionValidated(true)
      setSessionMode("none")
      setAuthStatus(emptyStatus)
      setAuthLoading(false)
      setBooting(false)
      return Promise.all([cleanup, revocation])
    },
    [user?.id]
  )

  const handleUnauthorized = useCallback(
    (result) => {
      if (result?.status === 401) {
        clearSession()
        setAuthStatus({ type: "error", message: "Sessão expirada. Faça login novamente." })
        return true
      }
      return false
    },
    [clearSession]
  )

  const restoreSession = useCallback(
    async (storedToken, requestId) => {
      revalidating.current = true
      const result = await api.getCurrentUser(storedToken)
      revalidating.current = false
      if (requestId !== sessionRequestId.current) {
        return false
      }

      setBooting(false)

      if (handleUnauthorized(result)) {
        return false
      }

      if (!result.ok) {
        setSessionValidated(true)
        setSessionMode("local")
        setAuthStatus(emptyStatus)
        return false
      }

      const previousOwner = readStoredUser()?.id
      if (previousOwner && previousOwner !== result.data.id) {
        void clearUserData(previousOwner)
        clearOverview()
        clearFinanceSnapshots()
        clearOrientationCache()
      }

      persistUser(result.data)
      void ensurePersistentSession().catch(() => {})
      setSessionValidated(true)
      setSessionMode("online")
      setAuthStatus(emptyStatus)
      return true
    },
    [handleUnauthorized, persistUser]
  )

  useEffect(() => {
    const updateToken = () => {
      const next = persistentStore.getItem(TOKEN_KEY)
      skipRestoreToken.current = next
      setToken(next)
    }
    window.addEventListener("bunkermode-token-refreshed", updateToken)
    return () => window.removeEventListener("bunkermode-token-refreshed", updateToken)
  }, [])

  useEffect(() => {
    if (!token) {
      setBooting(false)
      setSessionValidated(true)
      return
    }

    if (skipRestoreToken.current === token) {
      skipRestoreToken.current = null
      setBooting(false)
      setSessionValidated(true)
      setSessionMode("online")
      return
    }

    const requestId = sessionRequestId.current + 1
    sessionRequestId.current = requestId
    setBooting(true)
    setSessionValidated(false)
    void restoreSession(token, requestId)

    return () => {
      if (sessionRequestId.current === requestId) {
        sessionRequestId.current += 1
      }
    }
  }, [restoreSession, token])

  useEffect(() => {
    if (!token || !user || !sessionValidated || sessionMode !== "local") return
    const retry = () => {
      if (getApiAvailability() === "unavailable" || revalidating.current) return
      const requestId = ++sessionRequestId.current
      void restoreSession(token, requestId)
    }
    const onAvailability = () => {
      if (getApiAvailability() === "available") retry()
    }
    const stopAvailability = subscribeApiAvailability(onAvailability)
    const stopRetry = subscribeApiRetry(() => {
      if (revalidating.current) return
      const requestId = ++sessionRequestId.current
      void restoreSession(token, requestId)
    })
    const stopSuccess = subscribeApiSuccess(retry)
    return () => {
      stopAvailability()
      stopRetry()
      stopSuccess()
    }
  }, [token, user, sessionValidated, sessionMode, restoreSession])

  async function login(payload) {
    const validation = validateAuth(payload, false)
    if (validation) {
      setAuthStatus({ type: "error", message: validation })
      return
    }

    if (!payload.email || !payload.senha) {
      setAuthStatus({ type: "error", message: "Preencha e-mail ou usuário e senha." })
      return
    }

    const requestId = sessionRequestId.current + 1
    sessionRequestId.current = requestId
    setAuthLoading(true)
    setAuthStatus(emptyStatus)
    const result = await api.login(payload)
    if (requestId !== sessionRequestId.current) {
      return
    }
    setAuthLoading(false)

    if (!result.ok) {
      setAuthStatus({
        type: "error",
        message: getErrorMessage(result, "Não foi possível entrar no bunker."),
      })
      return
    }

    persistentStore.setItem(TOKEN_KEY, result.data.access_token)
    if (typeof result.data.refresh_token === "string")
      persistentStore.setItem(REFRESH_KEY, result.data.refresh_token)
    skipRestoreToken.current = result.data.access_token
    setToken(result.data.access_token)
    persistUser(result.data.usuario)
    setSessionValidated(true)
    setSessionMode("online")
    setBooting(false)
  }

  async function register(payload) {
    const validation = validateAuth(payload, true)
    if (validation) {
      setAuthStatus({ type: "error", message: validation })
      return
    }

    if (!payload.usuario || !payload.email || !payload.senha) {
      setAuthStatus({ type: "error", message: "Preencha usuário, e-mail e senha." })
      return
    }

    setAuthLoading(true)
    setAuthStatus(emptyStatus)
    const result = await api.register(payload)
    setAuthLoading(false)

    if (!result.ok) {
      setAuthStatus({
        type: "error",
        message: getErrorMessage(result, "Não foi possível criar a conta."),
      })
      return
    }

    setAuthStatus({ type: "success", message: "Conta criada. Entre no bunker para continuar." })
  }

  return {
    authenticated,
    authLoading,
    authStatus,
    booting,
    clearSession,
    handleUnauthorized,
    login,
    register,
    token,
    sessionMode,
    updateCurrentUser,
    user,
  }
}
