import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it } from "vitest";

import "./test/appTestHarness";

describe("App native bridge harness", () => {
  it("rejects IPC commands not explicitly supported by the App harness", async () => {
    await expect(
      invoke("misspelled_app_command"),
    ).rejects.toThrow("Unexpected App command: misspelled_app_command");
  });
});
