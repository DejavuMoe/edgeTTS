// The workbench takes its first language from the browser's, and jsdom reports en-US. The tests
// are written against the 简体中文 default, so the simulated browser prefers Chinese; a test can
// spy on this getter to try another language.
if (typeof window !== "undefined") {
  Object.defineProperty(window.navigator, "languages", {
    configurable: true,
    get: (): readonly string[] => ["zh-CN"],
  });
}
