// Indicadores de UX; o backend valida novamente cadastro e redefinição.
export function passwordRequirements(password: string) {
  return {
    letters: (password.match(/\p{L}/gu)?.length ?? 0) >= 5,
    number: /\p{Nd}/u.test(password),
  }
}

export function validateAuth(payload, register = false) {
  const identifier = typeof payload.email === "string" ? payload.email.trim() : ""
  const password = payload.senha
  if (!identifier || identifier.length > 254)
    return "Informe um e-mail ou usuário de até 254 caracteres."
  if (typeof password !== "string" || !password.length) return "Informe uma senha."
  if (!register) return ""
  const username = typeof payload.usuario === "string" ? payload.usuario.trim() : ""
  if (username.length < 3 || username.length > 32)
    return "Usuário deve ter entre 3 e 32 caracteres."
  if (!/^[a-z0-9._-]+$/i.test(username))
    return "Usuário deve usar apenas letras, números, ponto, hífen ou sublinhado."
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) return "E-mail inválido."
  const requirements = passwordRequirements(password)
  if (!requirements.letters || !requirements.number)
    return "Senha deve conter 5 ou mais letras e 1 ou mais números."
  return ""
}
