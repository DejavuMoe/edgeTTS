import { describe, it, expect, vi, afterEach } from "vitest";
import { registerGracefulShutdown, type ShutdownTarget } from "../src/shutdown.js";

describe("Graceful Shutdown", () => {
  const activeControllers: Array<{ unregister: () => void }> = [];

  afterEach(() => {
    while (activeControllers.length > 0) {
      activeControllers.pop()?.unregister();
    }
  });

  function createMockTarget(closeImpl?: () => Promise<void>): ShutdownTarget & {
    closeMock: ReturnType<typeof vi.fn>;
    infoMock: ReturnType<typeof vi.fn>;
    errorMock: ReturnType<typeof vi.fn>;
  } {
    const closeMock = vi.fn(closeImpl ?? (async () => {}));
    const infoMock = vi.fn();
    const errorMock = vi.fn();

    return {
      close: closeMock,
      closeMock,
      log: {
        info: infoMock,
        error: errorMock,
      },
      infoMock,
      errorMock,
    };
  }

  it("SIGTERM invokes close once and exits cleanly", async () => {
    const target = createMockTarget();
    const exitMock = vi.fn();
    const setExitCodeMock = vi.fn();

    const controller = registerGracefulShutdown(target, {
      signals: ["SIGTERM"],
      exit: exitMock,
      setExitCode: setExitCodeMock,
    });
    activeControllers.push(controller);

    await controller.handleSignal("SIGTERM");

    expect(target.closeMock).toHaveBeenCalledTimes(1);
    expect(target.infoMock).toHaveBeenCalledWith("Received SIGTERM, shutting down gracefully");
    expect(setExitCodeMock).toHaveBeenCalledWith(0);
    expect(exitMock).toHaveBeenCalledWith(0);
    expect(target.errorMock).not.toHaveBeenCalled();
  });

  it("SIGINT invokes close once and exits cleanly", async () => {
    const target = createMockTarget();
    const exitMock = vi.fn();
    const setExitCodeMock = vi.fn();

    const controller = registerGracefulShutdown(target, {
      signals: ["SIGINT"],
      exit: exitMock,
      setExitCode: setExitCodeMock,
    });
    activeControllers.push(controller);

    await controller.handleSignal("SIGINT");

    expect(target.closeMock).toHaveBeenCalledTimes(1);
    expect(target.infoMock).toHaveBeenCalledWith("Received SIGINT, shutting down gracefully");
    expect(setExitCodeMock).toHaveBeenCalledWith(0);
    expect(exitMock).toHaveBeenCalledWith(0);
    expect(target.errorMock).not.toHaveBeenCalled();
  });

  it("second signal during or after shutdown does not invoke close twice", async () => {
    let resolveClose!: () => void;
    const closePromise = new Promise<void>((resolve) => {
      resolveClose = resolve;
    });
    const target = createMockTarget(() => closePromise);
    const exitMock = vi.fn();
    const setExitCodeMock = vi.fn();

    const controller = registerGracefulShutdown(target, {
      signals: ["SIGTERM", "SIGINT"],
      exit: exitMock,
      setExitCode: setExitCodeMock,
    });
    activeControllers.push(controller);

    // First signal begins shutdown
    const firstSignalPromise = controller.handleSignal("SIGTERM");
    expect(target.closeMock).toHaveBeenCalledTimes(1);

    // Second signal arrives while first is in progress
    await controller.handleSignal("SIGINT");
    expect(target.closeMock).toHaveBeenCalledTimes(1);

    // Third signal arrives after close completes
    resolveClose();
    await firstSignalPromise;

    await controller.handleSignal("SIGTERM");
    expect(target.closeMock).toHaveBeenCalledTimes(1);
    expect(exitMock).toHaveBeenCalledTimes(1);
    expect(exitMock).toHaveBeenCalledWith(0);
  });

  it("close failure logs error and produces failure outcome (exit code 1)", async () => {
    const shutdownError = new Error("Fastify close failed");
    const target = createMockTarget(async () => {
      throw shutdownError;
    });
    const exitMock = vi.fn();
    const setExitCodeMock = vi.fn();

    const controller = registerGracefulShutdown(target, {
      signals: ["SIGTERM"],
      exit: exitMock,
      setExitCode: setExitCodeMock,
    });
    activeControllers.push(controller);

    await controller.handleSignal("SIGTERM");

    expect(target.closeMock).toHaveBeenCalledTimes(1);
    expect(target.errorMock).toHaveBeenCalledWith(shutdownError, "Error during server shutdown");
    expect(setExitCodeMock).toHaveBeenCalledWith(1);
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it("process signal listeners invoke handler and unregister cleans them up", async () => {
    const target = createMockTarget();
    const exitMock = vi.fn();

    const controller = registerGracefulShutdown(target, {
      signals: ["SIGTERM"],
      exit: exitMock,
    });

    const listenersBefore = process.listeners("SIGTERM");
    expect(listenersBefore.length).toBeGreaterThan(0);

    controller.unregister();

    const listenersAfter = process.listeners("SIGTERM");
    expect(listenersAfter.length).toBe(listenersBefore.length - 1);
  });
});
