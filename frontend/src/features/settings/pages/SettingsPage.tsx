import React, { useEffect, useRef, useState } from "react"

import { Monitor, Sun, Moon, Palette, Boxes } from "lucide-react"
import { getThemePreference, setThemePreference } from "../../../theme/preference"
import PageHeader from "../../../components/ui/PageHeader"
import { getErrorMessage } from "../../../api/httpClient"
import StatusNotice from "../../../components/ui/StatusNotice"
import { emptyStatus } from "../../../constants/uiState"
import { getEnabledModules, MODULE_CATALOG } from "../../../modules/moduleCatalog"
import { api } from "../../../services/bunkermodeApi"
import OutboxNotice from "../../../components/system/OutboxNotice"

export default function SettingsPage({ onUnauthorized, onUpdateUser, token, user }) {
  const [theme, setTheme] = useState(getThemePreference)
  const [updatingKey, setUpdatingKey] = useState(null)
  const [status, setStatus] = useState(emptyStatus)
  const requestId = useRef(0)
  const enabledKeys = new Set(getEnabledModules(user).map((module) => module.key))

  useEffect(() => {
    setUpdatingKey(null)
    return () => {
      requestId.current += 1
    }
  }, [token])

  async function updateModule(moduleKey, enabled) {
    const enabledModules = MODULE_CATALOG.filter((module) =>
      module.key === moduleKey ? enabled : enabledKeys.has(module.key)
    ).map((module) => module.key)

    const currentRequest = requestId.current + 1
    requestId.current = currentRequest
    setUpdatingKey(moduleKey)
    setStatus(emptyStatus)
    const result = await api.updateEnabledModules(token, { enabled_modules: enabledModules })
    if (currentRequest !== requestId.current) {
      return
    }
    setUpdatingKey(null)

    if (onUnauthorized(result)) {
      return
    }
    if (!result.ok) {
      setStatus({
        type: "error",
        message: getErrorMessage(result, "Não foi possível atualizar seus módulos."),
      })
      return
    }

    onUpdateUser(result.data)
    setStatus({ type: "success", message: "Módulos atualizados." })
  }

  return (
    <section className="mx-auto grid max-w-[720px] gap-6">
      <PageHeader title="Configurações" />
      <section className="work-surface p-5 sm:p-6" aria-labelledby="appearance-title">
        <h2
          id="appearance-title"
          className="m-0 mb-5 flex items-center gap-3 text-base font-semibold"
        >
          <Palette size={19} aria-hidden="true" />
          Aparência
        </h2>
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="Tema">
          {(
            [
              { value: "system", label: "Sistema", Icon: Monitor },
              { value: "light", label: "Claro", Icon: Sun },
              { value: "dark", label: "Escuro", Icon: Moon },
            ] as const
          ).map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              aria-pressed={theme === value}
              onClick={() => {
                setTheme(value)
                setThemePreference(value)
              }}
              className={`flex min-h-20 flex-col items-center justify-center gap-2 rounded-xl border text-sm font-medium transition-colors motion-reduce:transition-none ${theme === value ? "border-selection-border bg-selection text-selection-text" : "border-border bg-surface-subtle text-text-secondary hover:border-border-strong"}`}
            >
              <Icon size={20} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </section>
      <section className="work-surface p-5 sm:p-6" aria-labelledby="modules-title">
        <h2 className="m-0 mb-4 flex items-center gap-3 text-base font-semibold" id="modules-title">
          <Boxes size={19} aria-hidden="true" />
          Módulos
        </h2>
        <StatusNotice status={status} />
        <div className="grid">
          {MODULE_CATALOG.map((module) => {
            const enabled = enabledKeys.has(module.key)
            return (
              <label
                key={module.key}
                className="flex min-h-20 cursor-pointer items-center justify-between gap-4 border-t border-border py-4 first:border-0"
              >
                <span className="text-sm font-semibold">{module.label}</span>
                <span className="flex items-center gap-3">
                  <span className="text-xs text-text-secondary">
                    {updatingKey === module.key ? "Salvando" : enabled ? "Ativo" : "Inativo"}
                  </span>
                  <input
                    checked={enabled}
                    className="size-5 accent-selection-border"
                    aria-label={module.label}
                    disabled={updatingKey !== null}
                    type="checkbox"
                    onChange={() => updateModule(module.key, !enabled)}
                  />
                </span>
              </label>
            )
          })}
        </div>
      </section>
      <OutboxNotice diagnostic />
    </section>
  )
}
