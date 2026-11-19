/** Retry crashed project coordinators with bounded backoff until they become stable. */
export class Recovery {
  private entries = new Map<string, { attempts: number; timer?: ReturnType<typeof setTimeout>; stable?: ReturnType<typeof setTimeout> }>();
  constructor(private readonly baseMs = 1000, private readonly maxMs = 30_000, private readonly stableMs = 60_000) {}

  schedule(id: string, restart: () => Promise<boolean>): void {
    const entry = this.entries.get(id) ?? { attempts: 0 };
    this.entries.set(id, entry);
    if (entry.timer) return;
    if (entry.stable) { clearTimeout(entry.stable); entry.stable = undefined; }
    const delay = Math.min(this.maxMs, this.baseMs * 2 ** Math.min(entry.attempts++, 10));
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      void restart().then((wanted) => {
        if (!wanted) return this.cancel(id);
        this.started(id);
      }).catch(() => this.schedule(id, restart));
    }, delay);
    entry.timer.unref?.();
  }

  started(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.stable) clearTimeout(entry.stable);
    entry.timer = undefined;
    entry.stable = setTimeout(() => this.entries.delete(id), this.stableMs);
    entry.stable.unref?.();
  }

  cancel(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.stable) clearTimeout(entry.stable);
    this.entries.delete(id);
  }
}
