import { BadRequestException } from "@nestjs/common"

export function validateNewPassword(value: unknown): string {
  if (
    typeof value !== "string" ||
    (value.match(/\p{L}/gu)?.length ?? 0) < 5 ||
    !/\p{Nd}/u.test(value)
  ) {
    throw new BadRequestException("Senha deve conter 5 ou mais letras e 1 ou mais números.")
  }
  return value
}
