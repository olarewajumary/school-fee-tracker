import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

describe("App", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a loading state before the health check resolves", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );

    render(<App />);

    expect(screen.getByRole("status")).toHaveTextContent("API status: checking...");
  });

  it("shows the API as online when the health check succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "ok",
          service: "school-fee-tracker-api",
          timestamp: new Date().toISOString(),
        }),
      }),
    );

    render(<App />);

    expect(await screen.findByText("API status: online")).toBeInTheDocument();
  });

  it("shows the API as unreachable when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    render(<App />);

    expect(await screen.findByText("API status: unreachable")).toBeInTheDocument();
  });

  it("shows the API as unreachable when the server returns an error status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    render(<App />);

    expect(await screen.findByText("API status: unreachable")).toBeInTheDocument();
  });
});
