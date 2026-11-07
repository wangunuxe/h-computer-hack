export class ConnectionAttempt {
  readonly controller = new AbortController();
  private timer: ReturnType<typeof setTimeout>;
  constructor(expired: () => void, timeoutMs = 10_000) {
    this.timer = setTimeout(() => { this.controller.abort(); expired(); }, timeoutMs);
  }
  clear() { clearTimeout(this.timer); }
  cancel() { this.clear(); this.controller.abort(); }
}
export const replaceOnForeground = (readyState: number | undefined) => readyState === 0 || readyState === 1;
