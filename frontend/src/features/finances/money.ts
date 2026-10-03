export const money = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100)
export function parseMoney(value: string): number | null {
  const normalized = value.trim().replace(/\s/g, "")
  // A entrada usa vírgula decimal, sem milhares, para não interpretar 1.234 como 1,23.
  if (!/^\d+(,\d{1,2})?$/.test(normalized)) return null
  const [whole, fraction = ""] = normalized.split(",")
  const cents = normalized.includes(",")
    ? Number(whole) * 100 + Number(fraction.padEnd(2, "0"))
    : Number(whole)
  return Number.isSafeInteger(cents) && cents <= 2147483647 ? cents : null
}
export const moneyInput = (cents: number) =>
  `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`
// Somente dígitos representam centavos; a formatação não participa do cálculo.
export function formatMoneyInput(value: string): string {
  const digits = value.replace(/\D/g, "").replace(/^0+(?=\d)/, "")
  if (!digits) return ""
  const padded = digits.padStart(3, "0")
  return `${padded.slice(0, -2)},${padded.slice(-2)}`
}
