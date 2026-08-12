export type RouteResource<Value> =
  | Readonly<{ status: "pending" }>
  | Readonly<{ status: "not-found" }>
  | Readonly<{ status: "ready"; value: Value }>;

export function pendingRouteResource(): RouteResource<never> {
  return Object.freeze({ status: "pending" });
}

export function missingRouteResource(): RouteResource<never> {
  return Object.freeze({ status: "not-found" });
}

export function readyRouteResource<Value>(
  value: Value,
): RouteResource<Value> {
  return Object.freeze({ status: "ready", value });
}
