function unitInterval(random: () => number): number {
  const value = random();
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1 - Number.EPSILON);
}

export function pickRandomItem<T>(
  items: readonly T[],
  random: () => number = Math.random,
): T | undefined {
  if (!items.length) return undefined;
  return items[Math.floor(unitInterval(random) * items.length)];
}

export function pickWeightedItem<T>(
  items: readonly T[],
  weightFor: (item: T) => number,
  random: () => number = Math.random,
): T | undefined {
  if (!items.length) return undefined;
  const weights = items.map((item) => Math.max(0, weightFor(item)));
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  if (totalWeight <= 0) return pickRandomItem(items, random);

  let target = unitInterval(random) * totalWeight;
  for (let index = 0; index < items.length; index += 1) {
    target -= weights[index];
    if (target < 0) return items[index];
  }
  return items[items.length - 1];
}
