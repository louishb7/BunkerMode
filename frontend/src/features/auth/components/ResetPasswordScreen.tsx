import React, { useEffect, useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import Brand from "../../../components/ui/Brand"
import Button from "../../../components/ui/Button"
import StatusNotice from "../../../components/ui/StatusNotice"
import { api } from "../../../services/bunkermodeApi"
import { getErrorMessage } from "../../../api/httpClient"
import { APP_ROUTES } from "../../../routes/routeConstants"
import { passwordRequirements } from "../authValidation"
import PasswordField from "./PasswordField"

export default function ResetPasswordScreen({ onReset }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [token, setToken] = useState(
    () => new URLSearchParams(location.hash.slice(1)).get("token") ?? ""
  )
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState("")
  const requirements = passwordRequirements(password)
  const validToken = /^[a-f0-9]{64}$/.test(token)
  useEffect(() => {
    // Retira o segredo da URL/histórico; permanece apenas no estado deste formulário.
    if (location.hash) navigate(location.pathname, { replace: true })
  }, [location.hash, location.pathname, navigate])

  async function submit(event) {
    event.preventDefault()
    if (!validToken || !requirements.letters || !requirements.number || loading) return
    setLoading(true)
    setError("")
    try {
      const result = await api.resetPassword({ token, password })
      if (result.ok) {
        setSuccess(true)
        setPassword("")
        setToken("")
        onReset()
      } else setError(getErrorMessage(result, "Não foi possível redefinir a senha."))
    } catch {
      setError("Não foi possível conectar à API.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="grid min-h-dvh items-center bg-canvas px-4 py-8 text-text-primary">
      <section
        className="mx-auto grid w-full max-w-md gap-6 rounded-[24px] border border-border bg-surface p-6 shadow-surface sm:p-10"
        aria-label="Redefinição de senha"
      >
        <Brand />
        <h1 className="m-0 text-2xl font-semibold tracking-tight">Criar nova senha</h1>
        {success ? (
          <StatusNotice
            status={{ type: "success", message: "Senha redefinida. Entre com sua nova senha." }}
          />
        ) : (
          <form className="grid gap-5" onSubmit={submit}>
            <PasswordField
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
                setError("")
              }}
              creation
              disabled={loading}
            />
            <StatusNotice
              status={{
                type: "error",
                message:
                  error ||
                  (!validToken
                    ? "Link inválido ou expirado. Solicite uma nova recuperação de senha."
                    : ""),
              }}
            />
            <Button
              type="submit"
              loading={loading}
              disabled={!validToken || !requirements.letters || !requirements.number}
            >
              Redefinir senha
            </Button>
          </form>
        )}
        <Link className="text-center text-sm text-text-secondary underline" to={APP_ROUTES.AUTH}>
          Voltar ao login
        </Link>
      </section>
    </main>
  )
}
