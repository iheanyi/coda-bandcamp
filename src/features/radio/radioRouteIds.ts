import {
  parseRadioSeriesIdParam,
  parseRadioShowIdParam,
  type RadioSeriesId,
  type RadioShowId,
} from "@/routing/routeContracts";

export function radioSeriesId(value: unknown): RadioSeriesId | undefined {
  try {
    return parseRadioSeriesIdParam(value);
  } catch {
    return undefined;
  }
}

export function radioShowId(value: unknown): RadioShowId | undefined {
  try {
    return parseRadioShowIdParam(value);
  } catch {
    return undefined;
  }
}
