import React, { useState } from "react"
import { ArrowRight, ListTodo, Compass } from "lucide-react"
import Brand from "../../../components/ui/Brand"
import Button from "../../../components/ui/Button"
import StatusNotice from "../../../components/ui/StatusNotice"
import { passwordRequirements, validateAuth } from "../authValidation"
import PasswordField from "./PasswordField"
import { api } from "../../../services/bunkermodeApi"
import { getErrorMessage } from "../../../api/httpClient"

const field =
  "min-h-12 w-full rounded-control border border-control-border bg-surface px-3 text-sm text-text-primary focus:border-focus-ring"
export default function AuthScreen({ loading, onLogin, onRegister, status }) {
  const [mode, setMode] = useState("login")
  const [error, setError] = useState("")
  const [form, setForm] = useState({ usuario: "", email: "", identificador: "", senha: "" })
  const isLogin = mode === "login"
  const isForgot = mode === "forgot"
  const [recoveryLoading, setRecoveryLoading] = useState(false)
  const [recoveryMessage, setRecoveryMessage] = useState("")
  const [recoveryEmail, setRecoveryEmail] = useState("")
  const recoverySucceeded = Boolean(recoveryMessage) && recoveryEmail === form.email
  const requirements = passwordRequirements(form.senha)
  function updateField(event) {
    if (event.target.name === "email" && event.target.value !== recoveryEmail) {
      setRecoveryMessage("")
      setRecoveryEmail("")
    }
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }))
    setError("")
  }
  async function submit(event) {
    event.preventDefault()
    if (loading || recoveryLoading || (isForgot && recoverySucceeded)) return
    if (isForgot) {
      const requestedEmail = form.email
      setRecoveryLoading(true)
      setError("")
      setRecoveryMessage("")
      setRecoveryEmail("")
      try {
        const result = await api.forgotPassword({ email: form.email.trim() })
        if (result.ok) {
          setRecoveryMessage(result.data.message)
          setRecoveryEmail(requestedEmail)
        } else setError(getErrorMessage(result, "Não foi possível solicitar a recuperação."))
      } catch {
        setError("Não foi possível conectar à API.")
      } finally {
        setRecoveryLoading(false)
      }
      return
    }
    const payload = {
      usuario: form.usuario.trim(),
      email: (isLogin ? form.identificador : form.email).trim(),
      senha: form.senha,
    }
    const message = validateAuth(payload, !isLogin)
    setError(message)
    if (!message) {
      if (isLogin) onLogin({ email: payload.email, senha: payload.senha })
      else onRegister(payload)
    }
  }
  return (
    <main className="grid min-h-dvh items-center bg-canvas px-4 py-8 text-text-primary sm:px-8">
      <section
        className="mx-auto grid w-full max-w-[960px] overflow-hidden rounded-[24px] border border-border bg-surface shadow-surface md:min-h-[620px] md:grid-cols-[0.9fr_1.1fr]"
        aria-label="Autenticação"
      >
        <div className="flex flex-col items-center justify-center gap-8 bg-peripheral px-6 py-8 md:py-16">
          <div className="hidden md:block">
            <Brand large />
          </div>
          <div className="md:hidden">
            <Brand />
          </div>
          <div className="hidden items-center gap-5 text-xs font-medium text-text-secondary md:flex">
            <span className="flex items-center gap-2">
              <ListTodo size={16} aria-hidden="true" />
              Tarefas
            </span>
            <span className="flex items-center gap-2">
              <Compass size={16} aria-hidden="true" />
              Objetivos
            </span>
          </div>
        </div>
        <div className="flex items-center px-6 py-8 sm:px-10 md:py-12">
          <form className="mx-auto grid w-full max-w-sm gap-5" onSubmit={submit}>
            <div className="mb-2">
              <h1 className="m-0 text-2xl font-semibold tracking-tight">
                {isForgot ? "Recuperar senha" : isLogin ? "Entrar no Bunker" : "Criar sua conta"}
              </h1>
              <p className="mt-2 mb-0 text-sm text-text-secondary">
                {isForgot
                  ? "Receba por e-mail um link para criar uma nova senha."
                  : isLogin
                    ? "Acesse seu espaço de trabalho."
                    : "Seus dados para acessar o BunkerMode."}
              </p>
            </div>
            {!isLogin && !isForgot && (
              <label className="grid gap-2 text-sm font-medium">
                Usuário
                <input
                  className={field}
                  name="usuario"
                  autoComplete="username"
                  required
                  minLength={3}
                  maxLength={32}
                  value={form.usuario}
                  onChange={updateField}
                />
              </label>
            )}
            <label className="grid gap-2 text-sm font-medium">
              {isLogin ? "E-mail ou usuário" : "E-mail"}
              <input
                className={field}
                name={isLogin ? "identificador" : "email"}
                type={isLogin ? "text" : "email"}
                autoComplete={isLogin ? "username" : "email"}
                required
                maxLength={254}
                value={isLogin ? form.identificador : form.email}
                onChange={updateField}
              />
            </label>
            {!isForgot && (
              <PasswordField
                key={mode}
                value={form.senha}
                onChange={updateField}
                creation={!isLogin}
              />
            )}
            {isLogin && (
              <Button
                variant="ghost"
                size="small"
                disabled={loading}
                onClick={() => {
                  setMode("forgot")
                  setError("")
                  setRecoveryMessage("")
                  setRecoveryEmail("")
                  setForm((current) => ({ ...current, senha: "" }))
                }}
              >
                Esqueci minha senha
              </Button>
            )}
            <StatusNotice
              status={
                error
                  ? { type: "error", message: error }
                  : isForgot && recoverySucceeded
                    ? { type: "success", message: recoveryMessage }
                    : status
              }
            />
            <Button
              className="w-full"
              loading={loading || recoveryLoading}
              type="submit"
              disabled={
                recoverySucceeded ||
                (!isLogin && !isForgot && (!requirements.letters || !requirements.number))
              }
            >
              {isForgot
                ? recoverySucceeded
                  ? "Instruções enviadas"
                  : "Enviar instruções"
                : isLogin
                  ? "Entrar"
                  : "Criar conta"}
              <ArrowRight size={17} aria-hidden="true" />
            </Button>
            <div className="flex flex-wrap items-center justify-center gap-x-1 text-xs text-text-secondary">
              {isForgot ? "" : isLogin ? "Ainda não tem conta?" : "Já tem conta?"}
              <Button
                size="small"
                variant="ghost"
                disabled={loading || recoveryLoading}
                onClick={() => {
                  setMode(isLogin ? "register" : "login")
                  setError("")
                  setForm((current) => ({ ...current, senha: "" }))
                }}
              >
                {isLogin ? "Criar conta" : "Entrar"}
              </Button>
            </div>
          </form>
        </div>
      </section>
    </main>
  )
}
