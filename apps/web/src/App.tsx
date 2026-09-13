import { useEffect, useState } from "react";
import type { HealthResponse } from "@edgetts/shared";
import { HealthResponseSchema } from "@edgetts/shared";
import "./App.css";

type ApiStatus = "loading" | "healthy" | "unavailable";

export function App() {
  const [status, setStatus] = useState<ApiStatus>("loading");

  useEffect(() => {
    let active = true;

    async function checkHealth(): Promise<void> {
      try {
        const response = await fetch("/api/health");
        if (!response.ok) {
          if (active) {
            setStatus("unavailable");
          }
          return;
        }

        const data: unknown = await response.json();
        const parsed: HealthResponse = HealthResponseSchema.parse(data);

        if (active) {
          setStatus(parsed.status === "ok" ? "healthy" : "unavailable");
        }
      } catch {
        if (active) {
          setStatus("unavailable");
        }
      }
    }

    void checkHealth();

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="container">
      <header className="header">
        <h1>EdgeTTS</h1>
        <p className="description">Self-hosted text-to-speech service.</p>
      </header>
      <section className="status-container">
        <p>
          API status:{" "}
          {status === "loading" && <span className="status status-loading">Loading...</span>}
          {status === "healthy" && <span className="status status-healthy">Healthy</span>}
          {status === "unavailable" && (
            <span className="status status-unavailable">Unavailable</span>
          )}
        </p>
      </section>
    </main>
  );
}
