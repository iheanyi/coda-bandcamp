export type ResponsiveGridMeasurement = Readonly<{
  scrollMargin: number;
  width: number;
}>;

export type ResponsiveGridViewport = Readonly<{
  height: number;
  offset: number;
  width: number;
}>;

const EMPTY_MEASUREMENT: ResponsiveGridMeasurement = {
  scrollMargin: 0,
  width: 0,
};

let lastResponsiveGridMeasurement: ResponsiveGridMeasurement =
  EMPTY_MEASUREMENT;

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function resetResponsiveGridMeasurementCache(): void {
  lastResponsiveGridMeasurement = EMPTY_MEASUREMENT;
}

export function rememberResponsiveGridMeasurement(
  measurement: ResponsiveGridMeasurement,
): void {
  const width = finiteNonNegative(measurement.width);
  if (width <= 0) return;
  lastResponsiveGridMeasurement = {
    scrollMargin: finiteNonNegative(measurement.scrollMargin),
    width,
  };
}

export function initialResponsiveGridWidth(
  scrollElement: HTMLElement | null,
): number {
  if (lastResponsiveGridMeasurement.width > 0) {
    return lastResponsiveGridMeasurement.width;
  }
  if (!scrollElement) return 0;
  const bounds = scrollElement.getBoundingClientRect();
  return finiteNonNegative(scrollElement.clientWidth || bounds.width);
}

export function initialResponsiveGridScrollMargin(): number {
  return lastResponsiveGridMeasurement.scrollMargin;
}

export function readResponsiveGridViewport(
  scrollElement: HTMLElement | null,
): ResponsiveGridViewport {
  if (!scrollElement) {
    return {
      height: 0,
      offset: 0,
      width: lastResponsiveGridMeasurement.width,
    };
  }
  const bounds = scrollElement.getBoundingClientRect();
  return {
    height: finiteNonNegative(scrollElement.clientHeight || bounds.height),
    offset: finiteNonNegative(scrollElement.scrollTop),
    width: finiteNonNegative(scrollElement.clientWidth || bounds.width),
  };
}
