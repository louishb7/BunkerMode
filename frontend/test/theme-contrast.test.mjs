import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const theme = readFileSync(new URL("../src/theme/theme.css", import.meta.url), "utf8")
const objectiveTheme = readFileSync(new URL("../src/features/objectives/objectives.css", import.meta.url), "utf8")
const colors = Object.fromEntries(
  [...theme.matchAll(/--color-([\w-]+): light-dark\((#[\da-f]{6}), (#[\da-f]{6})\)/g)].map(
    ([, name, light, dark]) => [name, { light, dark }]
  )
)

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map((value) => {
    const channel = parseInt(value, 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

function contrast(foreground, background, mode) {
  const values = [foreground, background].map((name) => luminance(colors[name][mode]))
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05)
}

for (const mode of ["light", "dark"]) {
  test(`${mode}: conexões do mapa preservam contraste mínimo de 3:1`, () => {
    const local = Object.fromEntries([...objectiveTheme.matchAll(/--objective-([\w-]+): light-dark\((#[\da-f]{6}), (#[\da-f]{6})\)/g)]
      .map(([, name, light, dark]) => [name, { light, dark }]))
    const line = luminance(local.connector[mode])
    const paper = luminance(local.paper[mode])
    const ratio = (Math.max(line, paper) + 0.05) / (Math.min(line, paper) + 0.05)
    assert.ok(ratio >= 3, `conector/fundo: ${ratio.toFixed(2)}:1`)
  })

  test(`${mode}: textos e estados semânticos preservam contraste mínimo de 4.5:1`, () => {
    const pairs = [
      ["on-action", "action"],
      ["on-action", "action-hover"],
      ["selection-text", "selection"],
      ["success", "success-soft"],
      ["warning", "warning-soft"],
      ["danger", "danger-soft"],
      ["danger-hover", "danger-soft"],
      ["accent", "peripheral"],
    ]
    for (const background of ["canvas", "peripheral", "surface", "surface-subtle", "surface-overlay"]) {
      for (const foreground of ["text-primary", "text-secondary", "text-muted", "danger"]) {
        pairs.push([foreground, background])
      }
    }
    for (const [foreground, background] of pairs) {
      const ratio = contrast(foreground, background, mode)
      assert.ok(ratio >= 4.5, `${foreground}/${background}: ${ratio.toFixed(2)}:1`)
    }
  })

  test(`${mode}: foco e limites de controles preservam contraste mínimo de 3:1`, () => {
    for (const background of ["canvas", "peripheral", "surface", "surface-overlay"]) {
      for (const foreground of ["focus-ring", "border-strong"]) {
        const ratio = contrast(foreground, background, mode)
        assert.ok(ratio >= 3, `${foreground}/${background}: ${ratio.toFixed(2)}:1`)
      }
    }
    assert.ok(contrast("selection-border", "selection", mode) >= 3)
  })
}
