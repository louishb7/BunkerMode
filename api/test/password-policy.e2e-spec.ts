import { validateNewPassword } from "../src/auth/password-policy"
import { hashPassword, verifyPassword } from "../src/auth/password"

describe("Password policy", () => {
  it.each(["abcde1", "ABCDE1", "abcde1!", " ééééé１２ ", "a".repeat(129) + "1"])(
    "accepts %s without additional rules",
    (password) => {
      expect(validateNewPassword(password)).toBe(password)
      expect(verifyPassword(password, hashPassword(password))).toBe(true)
    }
  )
  it.each(["abcd!1", "abcdef", "123456", "abcde²", "", null, 123456])("rejects %s", (password) => {
    expect(() => validateNewPassword(password)).toThrow("5 ou mais letras e 1 ou mais números")
  })
})
