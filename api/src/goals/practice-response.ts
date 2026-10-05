import type { planos_pratica } from "@prisma/client";
import type { PracticePlan } from "./practice-domain";

export function practicePlanResponse(plan: planos_pratica): PracticePlan {
  return {
    ...plan,
    frequency: plan.frequency as PracticePlan["frequency"],
    effective_from: plan.effective_from.toISOString().slice(0, 10),
    effective_until: plan.effective_until?.toISOString().slice(0, 10) ?? null,
    target_amount:
      plan.target_amount == null ? null : Number(plan.target_amount),
  };
}
