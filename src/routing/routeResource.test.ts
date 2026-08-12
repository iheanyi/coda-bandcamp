import { describe, expect, it } from "vitest";
import {
  missingRouteResource,
  pendingRouteResource,
  readyRouteResource,
} from "./routeResource";

describe("route resources", () => {
  it("models pending, missing, and ready identities explicitly", () => {
    expect(pendingRouteResource()).toEqual({ status: "pending" });
    expect(missingRouteResource()).toEqual({ status: "not-found" });
    expect(readyRouteResource({ id: "album-1" })).toEqual({
      status: "ready",
      value: { id: "album-1" },
    });
  });
});
