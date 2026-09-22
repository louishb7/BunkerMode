import { HttpException, HttpStatus, Injectable } from "@nestjs/common"

type Bucket = {
  count: number
  resetAt: number
}

@Injectable()
export class AuthRateLimitService {
  private readonly buckets = new Map<string, Bucket>()

  check(key: string, limit: number, windowMs: number): void {
    const now = Date.now()
    for (const [expiredKey, entry] of this.buckets) {
      if (entry.resetAt <= now) this.buckets.delete(expiredKey)
    }
    const bucket = this.buckets.get(key)
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs })
      return
    }
    if (bucket.count >= limit) {
      throw new HttpException("Muitas tentativas. Aguarde antes de tentar novamente.", HttpStatus.TOO_MANY_REQUESTS)
    }
    bucket.count += 1
  }
}
