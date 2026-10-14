import { ExecutionContext, HttpException } from "@nestjs/common";
import { AuthGuard } from "../src/auth/auth.guard";
import { HealthController } from "../src/health.controller";
const context = {
  switchToHttp: () => ({
    getRequest: () => ({ headers: { authorization: "Bearer synthetic" } }),
  }),
} as ExecutionContext;

describe("authentication and readiness failure isolation", () => {
  it("returns 503 for persistence failure without revoking credentials", async () => {
    const guard = new AuthGuard({
      getUserFromToken: async () => {
        throw new Error("database unavailable");
      },
    } as never);
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 503,
    });
  });
  it.each([401, 403, 429])("preserves HTTP %s", async (status) => {
    const guard = new AuthGuard({
      getUserFromToken: async () => {
        throw new HttpException("rejected", status);
      },
    } as never);
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status });
  });
  it("readiness reports database failure/recovery while liveness stays healthy", async () => {
    const health = new HealthController({
      $queryRaw: jest
        .fn()
        .mockRejectedValueOnce(new Error("database unavailable"))
        .mockResolvedValueOnce([]),
    } as never);
    expect(health.apiHealth()).toEqual({ status: "ok" });
    await expect(health.apiDatabaseHealth()).rejects.toMatchObject({
      status: 503,
    });
    await expect(health.apiDatabaseHealth()).resolves.toEqual({
      status: "ok",
      database: "ok",
    });
  });
});
