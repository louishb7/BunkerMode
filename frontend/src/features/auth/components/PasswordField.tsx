import React, { useId, useState } from "react"
import { Check, Circle, Eye, EyeOff } from "lucide-react"
import Button from "../../../components/ui/Button"
import { passwordRequirements } from "../authValidation"

export default function PasswordField({ value, onChange, creation = false, disabled = false }) {
  const [visible, setVisible] = useState(false)
  const id = useId()
  const requirements = passwordRequirements(value)
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {creation ? "Nova senha" : "Senha"}
      </label>
      <div className="relative">
        <input
          id={id}
          name="senha"
          type={visible ? "text" : "password"}
          required
          disabled={disabled}
          className="min-h-12 w-full rounded-control border border-control-border bg-surface pr-14 pl-3 text-sm text-text-primary focus:border-focus-ring"
          autoComplete={creation ? "new-password" : "current-password"}
          aria-describedby={creation ? `${id}-requirements` : undefined}
          value={value}
          onChange={onChange}
        />
        <Button
          size="icon"
          variant="ghost"
          className="absolute top-0.5 right-1"
          aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
          aria-controls={id}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
        </Button>
      </div>
      {creation && (
        <ul
          id={`${id}-requirements`}
          className="m-0 grid list-none gap-1 p-0 text-xs text-text-secondary"
          aria-live="polite"
        >
          {[
            ["5 ou mais letras", requirements.letters],
            ["1 ou mais números", requirements.number],
          ].map(([label, met]) => (
            <li key={String(label)} className="flex items-center gap-2" data-met={String(met)}>
              {met ? (
                <Check size={14} aria-hidden="true" />
              ) : (
                <Circle size={14} aria-hidden="true" />
              )}
              <span className="sr-only">{met ? "Atendido: " : "Pendente: "}</span>
              <span className={met ? "line-through" : ""}>{label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
