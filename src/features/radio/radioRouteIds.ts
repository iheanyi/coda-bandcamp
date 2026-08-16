import {
  parseRadioSeriesIdParam,
  parseRadioShowIdParam,
  type RadioSeriesId,
  type RadioShowId,
} from "@/routing/routeContracts";

export function radioSeriesId(
  value: number | undefined,
): RadioSeriesId | undefined {
  try {
    return parseRadioSeriesIdParam(value);
  } catch {
    return undefined;
  }
}

export function radioShowId(value: number | undefined): RadioShowId | undefined {
  try {
    return parseRadioShowIdParam(value);
  } catch {
    return undefined;
  }
}
