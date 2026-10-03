import React, { useEffect, useState } from "react"
import { X } from "lucide-react"
import { registerSW } from "virtual:pwa-register"
import { useApiAvailability } from "../../offline/useApiAvailability"
import { useOnlineStatus } from "../../offline/useOnlineStatus"
import { useAuth } from "../../context/AuthContext"
import OutboxNotice from "./OutboxNotice"

type InstallPrompt = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: string }>
}

let installPrompt: InstallPrompt | null = null
let inviteDismissed = false
let promptUsed = false

function standalone() {
  return (
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

function iosSafari() {
  const ua = navigator.userAgent
  return /iPhone|iPad|iPod/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)
}

export default function PwaBanners() {
  const availability = useApiAvailability()
  const online = useOnlineStatus()
  const auth = useAuth()
  const [installable, setInstallable] = useState(false)
  const [showInstructions, setShowInstructions] = useState(false)
  const [dismissed, setDismissed] = useState(inviteDismissed)
  const [needRefresh, setNeedRefresh] = useState(false)
  const [updateDismissed, setUpdateDismissed] = useState(false)
  const [updateSW, setUpdateSW] = useState<(() => Promise<void>) | null>(null)

  useEffect(() => {
    const update = registerSW({ onNeedRefresh: () => setNeedRefresh(true) })
    setUpdateSW(() => update)
    const onBeforeInstall = (event: Event) => {
      event.preventDefault()
      installPrompt = event as InstallPrompt
      setInstallable(true)
    }
    const onInstalled = () => {
      installPrompt = null
      setInstallable(false)
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstall)
    window.addEventListener("appinstalled", onInstalled)
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall)
      window.removeEventListener("appinstalled", onInstalled)
    }
  }, [])

  const showInstall = !standalone() && !dismissed && !promptUsed && (installable || iosSafari())
  return (
    <div className="relative z-20 bg-peripheral text-text-primary">
      <OutboxNotice />
      {!online && (
        <div className="border-b border-border px-4 py-1.5 text-center text-xs" role="status">
          Aguardando sincronização
        </div>
      )}
      {availability === "unavailable" && (
        <div className="border-b border-border px-4 py-1.5 text-center text-xs" role="status">
          API indisponível · alterações pessoais serão sincronizadas depois
        </div>
      )}
      {availability !== "unavailable" && auth.sessionMode === "local" && (
        <div className="border-b border-border px-4 py-1.5 text-center text-xs" role="status">
          Sessão local · aguardando validação da API
        </div>
      )}
      {needRefresh && !updateDismissed && (
        <div
          className="flex flex-wrap items-center justify-center gap-3 border-b border-border px-4 py-2 text-sm"
          role="status"
        >
          <span>Nova versão disponível</span>
          <button className="font-semibold text-accent underline" onClick={() => void updateSW?.()}>
            Atualizar
          </button>
          <button
            className="text-text-secondary underline"
            onClick={() => setUpdateDismissed(true)}
          >
            Depois
          </button>
        </div>
      )}
      {showInstall && (
        <div
          className="flex items-center gap-3 border-b border-border px-4 py-2.5 sm:px-6"
          role="region"
          aria-label="Instalação do BunkerMode"
        >
          <div className="min-w-0 flex-1 text-sm">
            <strong>Instale o BunkerMode</strong>
            <span className="ml-2 text-text-secondary">
              Acesse seu Bunker mais rápido pela tela inicial.
            </span>
          </div>
          <button
            className="shrink-0 rounded-control bg-action px-3 py-2 text-xs font-semibold text-on-action"
            onClick={async () => {
              if (iosSafari()) {
                setShowInstructions(true)
              } else if (installPrompt) {
                const prompt = installPrompt
                installPrompt = null
                promptUsed = true
                setInstallable(false)
                await prompt.prompt()
                await prompt.userChoice
              }
            }}
          >
            Instalar
          </button>
          <button
            aria-label="Fechar convite de instalação"
            className="grid size-9 shrink-0 place-items-center rounded-control text-text-secondary"
            onClick={() => {
              inviteDismissed = true
              setDismissed(true)
            }}
          >
            <X size={18} />
          </button>
        </div>
      )}
      {showInstall && showInstructions && (
        <p className="m-0 border-b border-border px-4 py-2 text-xs text-text-secondary">
          No Safari, toque em Compartilhar → Adicionar à Tela de Início → Abrir como App da Web
          (quando disponível) → Adicionar.
        </p>
      )}
    </div>
  )
}
