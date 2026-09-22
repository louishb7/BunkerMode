import { Injectable, ServiceUnavailableException } from "@nestjs/common"

export abstract class EmailService {
  abstract sendPasswordReset(email: string, link: string): Promise<void>
}

export function resetEmailConfiguration() {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const from = process.env.EMAIL_FROM?.trim()
  let frontend: URL
  try {
    frontend = new URL(process.env.FRONTEND_URL ?? "")
    if (
      !["http:", "https:"].includes(frontend.protocol) ||
      frontend.username ||
      frontend.password ||
      (process.env.NODE_ENV === "production" && frontend.protocol !== "https:")
    )
      throw new Error()
  } catch {
    throw new ServiceUnavailableException(
      "Recuperação de senha indisponível. Tente novamente mais tarde."
    )
  }
  if (!apiKey || !from) {
    throw new ServiceUnavailableException(
      "Recuperação de senha indisponível. Tente novamente mais tarde."
    )
  }
  return { apiKey, from, frontend }
}

@Injectable()
export class ResendEmailService extends EmailService {
  async sendPasswordReset(email: string, link: string): Promise<void> {
    const { apiKey, from } = resetEmailConfiguration()
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: [email],
          subject: "Redefina sua senha do BunkerMode",
          text: `Para criar uma nova senha, acesse o link abaixo. Ele expira em 30 minutos e só pode ser usado uma vez.\n\n${link}\n\nSe você não solicitou a redefinição, ignore este e-mail.`,
        }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) throw new Error()
      await response.body?.cancel()
    } catch {
      // Não propagar resposta do provider, URL, token ou destinatário.
      throw new Error("Falha no envio do e-mail de recuperação.")
    }
  }
}
