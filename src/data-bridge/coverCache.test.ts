import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";

import { coverCacheDiagnostics } from "./coverCache";

afterEach(() => {
  clearMocks();
});

describe("coverCacheDiagnostics", () => {
  it("decodes native cover-cache diagnostics", async () => {
    mockIPC((command) => {
      if (command === "cover_cache_diagnostics") {
        return {
          entryCount: 2,
          totalBytes: 1_024,
          hitCount: 8,
          missCount: 1,
          staleCount: 0,
          cleanupPending: false,
        };
      }
      throw new Error(`Unexpected native command: ${command}`);
    });

    await expect(coverCacheDiagnostics()).resolves.toEqual({
      entryCount: 2,
      totalBytes: 1_024,
      hitCount: 8,
      missCount: 1,
      staleCount: 0,
      cleanupPending: false,
    });
  });
});
