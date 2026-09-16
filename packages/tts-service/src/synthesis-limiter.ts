export class SynthesisQueueFullError extends Error {
  constructor(message = "Speech synthesis capacity is full") {
    super(message);
    this.name = "SynthesisQueueFullError";
  }
}

export function createAbortError(reason?: unknown): Error {
  if (reason instanceof Error) {
    return reason;
  }
  return new DOMException(
    typeof reason === "string" ? reason : "The operation was aborted",
    "AbortError",
  );
}

export interface SynthesisLimiterOptions {
  readonly maxConcurrent: number;
  readonly maxQueued: number;
}

export interface Permit {
  release(): void;
}

interface QueueItem {
  readonly resolve: (permit: Permit) => void;
  readonly reject: (err: unknown) => void;
  readonly signal: AbortSignal;
  readonly onAbort: () => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export class SynthesisLimiter {
  private readonly maxConcurrent: number;
  private readonly maxQueued: number;
  private activeCount = 0;
  private readonly queue: QueueItem[] = [];

  constructor(options: SynthesisLimiterOptions) {
    if (!Number.isInteger(options.maxConcurrent) || options.maxConcurrent < 1) {
      throw new RangeError("maxConcurrentSyntheses must be a finite integer >= 1");
    }
    if (!Number.isInteger(options.maxQueued) || options.maxQueued < 0) {
      throw new RangeError("maxQueuedSyntheses must be a finite integer >= 0");
    }
    this.maxConcurrent = options.maxConcurrent;
    this.maxQueued = options.maxQueued;
  }

  get active(): number {
    return this.activeCount;
  }

  get queued(): number {
    return this.queue.length;
  }

  async acquire(signal: AbortSignal): Promise<Permit> {
    if (signal.aborted) {
      throw createAbortError(signal.reason);
    }

    if (this.activeCount < this.maxConcurrent) {
      this.activeCount++;
      return this.createPermit();
    }

    if (this.queue.length >= this.maxQueued) {
      throw new SynthesisQueueFullError("Speech synthesis capacity is full");
    }

    return new Promise<Permit>((resolve, reject) => {
      const remove = () => {
        const index = this.queue.indexOf(item);
        if (index !== -1) this.queue.splice(index, 1);
        clearTimeout(item.timer);
        signal.removeEventListener("abort", item.onAbort);
      };
      const item: QueueItem = {
        resolve,
        reject,
        signal,
        onAbort: () => {
          remove();
          reject(createAbortError(signal.reason));
        },
        timer: setTimeout(() => {
          remove();
          reject(new SynthesisQueueFullError("Speech synthesis queue wait timed out"));
        }, 30_000),
      };

      signal.addEventListener("abort", item.onAbort, { once: true });
      this.queue.push(item);
    });
  }

  private createPermit(): Permit {
    let released = false;
    return {
      release: () => {
        if (released) {
          return;
        }
        released = true;
        this.dispatchNext();
      },
    };
  }

  private dispatchNext(): void {
    while (this.queue.length > 0) {
      const next = this.queue.shift()!;
      clearTimeout(next.timer);
      next.signal.removeEventListener("abort", next.onAbort);

      if (next.signal.aborted) {
        next.reject(createAbortError(next.signal.reason));
        continue;
      }

      next.resolve(this.createPermit());
      return;
    }

    this.activeCount--;
  }
}
