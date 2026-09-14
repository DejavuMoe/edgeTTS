export interface ShutdownLogger {
  info(msg: string): void;
  error(err: unknown, msg?: string): void;
}

export interface ShutdownTarget {
  close(): Promise<void>;
  log: ShutdownLogger;
}

export interface GracefulShutdownOptions {
  readonly signals?: readonly NodeJS.Signals[];
  readonly setExitCode?: (code: number) => void;
  readonly exit?: (code: number) => void;
}

export interface GracefulShutdownController {
  readonly handleSignal: (signal: NodeJS.Signals) => Promise<void>;
  readonly unregister: () => void;
}

export function registerGracefulShutdown(
  target: ShutdownTarget,
  options?: GracefulShutdownOptions,
): GracefulShutdownController {
  let shuttingDown = false;
  const signals: readonly NodeJS.Signals[] = options?.signals ?? ["SIGTERM", "SIGINT"];
  const setExitCode =
    options?.setExitCode ??
    ((code: number) => {
      process.exitCode = code;
    });
  const exit =
    options?.exit ??
    ((code: number) => {
      process.exit(code);
    });

  async function handleSignal(signal: NodeJS.Signals): Promise<void> {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    target.log.info(`Received ${signal}, shutting down gracefully`);

    try {
      await target.close();
      setExitCode(0);
      exit(0);
    } catch (error) {
      target.log.error(error, "Error during server shutdown");
      setExitCode(1);
      exit(1);
    }
  }

  const signalListeners: Array<{ signal: NodeJS.Signals; listener: () => void }> = [];

  for (const signal of signals) {
    const listener = () => {
      void handleSignal(signal);
    };
    process.on(signal, listener);
    signalListeners.push({ signal, listener });
  }

  function unregister(): void {
    for (const { signal, listener } of signalListeners) {
      process.removeListener(signal, listener);
    }
  }

  return {
    handleSignal,
    unregister,
  };
}
