import { validateAuth } from "../authValidation"
import { useCallback, useEffect, useRef, useState } from "react"

import { getErrorMessage } from "../../../api/httpClient"
import { TOKEN_KEY, USER_KEY } from "../../../constants/session"
import { emptyStatus } from "../../../constants/uiState"
import { api } from "../../../services/bunkermodeApi"
import { clearOverview } from "../../../state/overviewCache"

const persistentStore = window.localStorage
const sessionStore = window.sessionStorage

function removeStoredSession() {
  persistentStore.removeItem(TOKEN_KEY)
  persistentStore.removeItem(USER_KEY)
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
    return JSON.parse(rawUser)
  } catch {
    removeStoredSession()
    return null
  }
}

export function useAuthSession() {
  const [token, setToken] = useState(() => persistentStore.getItem(TOKEN_KEY))
  const [user, setUser] = useState(readStoredUser)
  const [sessionValidated, setSessionValidated] = useState(
    () => !persistentStore.getItem(TOKEN_KEY)
  )
  const [booting, setBooting] = useState(() => Boolean(persistentStore.getItem(TOKEN_KEY)))
  const [authStatus, setAuthStatus] = useState(emptyStatus)
  const [authLoading, setAuthLoading] = useState(false)
  const sessionRequestId = useRef(0)
  const skipRestoreToken = useRef(null)

  const authenticated = Boolean(token && user && sessionValidated)

  const persistUser = useCallback((nextUser) => {
    persistentStore.setItem(USER_KEY, JSON.stringify(nextUser))
    setUser(nextUser)
  }, [])

  const updateCurrentUser = useCallback(
    (nextUser) => {
      persistUser(nextUser)
    },
    [persistUser]
  )

  const clearSession = useCallback(() => {
    sessionRequestId.current += 1
    clearOverview()
    removeStoredSession()
    setToken(null)
    setUser(null)
    setSessionValidated(true)
    setAuthStatus(emptyStatus)
    setAuthLoading(false)
    setBooting(false)
  }, [])

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
      const result = await api.getCurrentUser(storedToken)
      if (requestId !== sessionRequestId.current) {
        return false
      }

      setBooting(false)

      if (handleUnauthorized(result)) {
        return false
      }

      if (!result.ok) {
        setSessionValidated(false)
        setAuthStatus({
          type: "error",
          message: getErrorMessage(result, "Não foi possível validar a sessão. Tente novamente."),
        })
        return false
      }

      persistUser(result.data)
      setSessionValidated(true)
      setAuthStatus(emptyStatus)
      return true
    },
    [handleUnauthorized, persistUser]
  )

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
    skipRestoreToken.current = result.data.access_token
    setToken(result.data.access_token)
    persistUser(result.data.usuario)
    setSessionValidated(true)
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
    updateCurrentUser,
    user,
  }
}
