export function tryParseRouteId<Wire, Value>(
  value: Wire | undefined,
  parse: (value: Wire) => Value,
): Value | undefined {
  if (value === undefined) return undefined;
  try {
    return parse(value);
  } catch {
    return undefined;
  }
}
