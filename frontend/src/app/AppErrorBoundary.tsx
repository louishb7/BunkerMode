import React from "react"

import { TOKEN_KEY, USER_KEY } from "../constants/session"
import Button from "../components/ui/Button"
import { clearUserData } from "../offline/snapshots"
import { clearOverview } from "../state/overviewCache"
import { clearFinanceSnapshots } from "../state/financeCache"
import { clearOrientationCache } from "../state/orientationCache"

type AppErrorBoundaryState = {
  error: Error | null
  errorInfo: React.ErrorInfo | null
}

export default class AppErrorBoundary extends React.Component<
  React.PropsWithChildren,
  AppErrorBoundaryState
> {
  constructor(props: React.PropsWithChildren) {
    super(props)
    this.state = { error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ error, errorInfo })
    console.error("Erro ao montar o frontend:", error, errorInfo)
  }

  clearLocalSession = async () => {
    try {
      const ownerId = JSON.parse(localStorage.getItem(USER_KEY) || "null")?.id
      if (Number.isSafeInteger(ownerId)) await clearUserData(ownerId)
    } catch {
      /* sessão local inválida */
    }
    clearOverview()
    clearFinanceSnapshots()
    clearOrientationCache()
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    sessionStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(USER_KEY)
    window.location.reload()
  }

  render() {
    if (this.state.error) {
      return (
        <main className="grid min-h-dvh place-items-center bg-app px-4 text-text-primary">
          <section className="w-full max-w-lg rounded-card border border-border bg-surface p-6 text-center shadow-sm">
            <h1 className="m-0 text-xl font-semibold normal-case">
              Não foi possível carregar a interface
            </h1>
            <p className="mt-2 mb-6 text-sm leading-6 text-text-secondary">
              Limpe a sessão local e tente novamente.
            </p>
            <Button variant="secondary" onClick={this.clearLocalSession}>
              Limpar sessão e recarregar
            </Button>
          </section>
        </main>
      )
    }

    return this.props.children
  }
}
