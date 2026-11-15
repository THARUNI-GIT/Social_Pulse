import { ForbiddenException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RetryingConsumer } from './amqp-consumer';

/**
 * Suspended accounts, kept in sync with user-service.
 *
 * The gateway already refuses REST calls from a suspended user, but a Socket.IO connection that
 * was opened before the suspension is unaffected by that check. This registry closes the gap:
 * new sockets are refused, live sockets are torn down when the event arrives, and every send is
 * re-checked so a missed event cannot keep a suspended account chatting.
 */
@Injectable()
export class SuspensionsService implements OnModuleInit, OnModuleDestroy {
  private log = new Logger('Suspensions');
  private ids = new Set<string>();
  private listeners: Array<(userId: string) => void> = [];
  private consumer: RetryingConsumer | null = null;
  private timer: NodeJS.Timeout | null = null;

  isSuspended(userId: string): boolean {
    return !!userId && this.ids.has(userId);
  }

  /** Throws the same code the gateway uses, so clients can treat both paths identically. */
  assertActive(userId: string): void {
    if (this.isSuspended(userId)) {
      throw new ForbiddenException({ code: 'ACCOUNT_SUSPENDED', message: 'This account is suspended' });
    }
  }

  /** Called by the gateway to tear down the suspended user's live sockets. */
  onSuspend(fn: (userId: string) => void): () => void {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter((l) => l !== fn); };
  }

  /** Startup + periodic resync, so events lost across a broker restart cannot leave a gap. */
  private async resync(): Promise<void> {
    const base = process.env.USER_SERVICE_URL || 'http://user-service:3003';
    try {
      const res = await fetch(`${base}/users/suspended`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return;
      const body: any = await res.json();
      const ids: string[] = body?.data?.items ?? body?.items ?? [];
      const next = new Set(ids.map(String));
      // Anyone newly suspended by another path still gets disconnected.
      for (const id of next) if (!this.ids.has(id)) this.listeners.forEach((fn) => fn(id));
      this.ids = next;
    } catch { /* keep the last known set */ }
  }

  onModuleInit() {
    this.consumer = new RetryingConsumer({
      logName: 'ChatSuspensions',
      queue: 'chat-service.suspensions',
      bindings: ['user.suspended', 'user.unsuspended'],
      handle: async (routingKey, e) => {
        const id = String(e?.userId ?? '');
        if (!id) return;
        if (routingKey === 'user.suspended') {
          this.ids.add(id);
          this.listeners.forEach((fn) => fn(id));
        } else {
          this.ids.delete(id);
        }
      },
    });
    this.consumer.start();
    void this.resync();
    this.timer = setInterval(() => void this.resync(), 60_000);
    this.timer.unref?.();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.listeners = [];
    await this.consumer?.onModuleDestroy();
  }
}
