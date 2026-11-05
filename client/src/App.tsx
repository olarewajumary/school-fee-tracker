import { useEffect, useState } from "react";

type HealthResponse = {
  status: string;
  service: string;
  timestamp: string;
};

type ApiState =
  { kind: "loading" } | { kind: "online"; data: HealthResponse } | { kind: "offline" };

const STATUS_STYLES: Record<ApiState["kind"], string> = {
  loading: "bg-slate-100 text-slate-700",
  online: "bg-emerald-100 text-emerald-800",
  offline: "bg-red-100 text-red-800",
};

const STATUS_LABELS: Record<ApiState["kind"], string> = {
  loading: "checking...",
  online: "online",
  offline: "unreachable",
};

export default function App() {
  const [api, setApi] = useState<ApiState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/health", { signal: controller.signal })
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Health check failed with HTTP ${res.status}`);
        }
        return res.json() as Promise<HealthResponse>;
      })
      .then((data) => setApi({ kind: "online", data }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setApi({ kind: "offline" });
      });

    return () => controller.abort();
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-slate-900">
      <section className="w-full max-w-md rounded-xl bg-white p-8 shadow">
        <h1 className="text-2xl font-semibold">School Fee Tracker</h1>
        <p className="mt-2 text-sm text-slate-600">
          Manage students, record payments, and track balances.
        </p>
        <p
          role="status"
          className={`mt-6 inline-block rounded-md px-3 py-1 text-sm font-medium ${STATUS_STYLES[api.kind]}`}
        >
          {`API status: ${STATUS_LABELS[api.kind]}`}
        </p>
      </section>
    </main>
  );
}
