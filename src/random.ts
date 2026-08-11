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

type WeightedOrderEntry<T> = {
  index: number;
  item: T;
  arrival: number;
};

/**
 * Produces the same weighted-without-replacement distribution as repeatedly
 * picking from the remaining total weight, without rescanning and splicing the
 * shrinking input for every selection.
 */
export function weightedRandomOrder<T>(
  items: readonly T[],
  weightFor: (item: T) => number,
  random: () => number = Math.random,
): T[] {
  const weighted: WeightedOrderEntry<T>[] = [];
  const unweighted: T[] = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const weight = weightFor(item);
    if (!Number.isFinite(weight) || weight <= 0) {
      unweighted.push(item);
      continue;
    }

    // Independent exponential arrival times form a weighted random
    // permutation: the next item is selected in proportion to its weight.
    weighted.push({
      index,
      item,
      arrival: -Math.log1p(-unitInterval(random)) / weight,
    });
  }

  weighted.sort((left, right) =>
    left.arrival - right.arrival || left.index - right.index
  );

  // Zero/invalid weights become eligible only after every positive weight is
  // exhausted, matching repeated weighted picks' unweighted fallback.
  for (let index = 0; index < unweighted.length - 1; index += 1) {
    const swapIndex = index + Math.floor(
      unitInterval(random) * (unweighted.length - index),
    );
    [unweighted[index], unweighted[swapIndex]] = [
      unweighted[swapIndex],
      unweighted[index],
    ];
  }

  return [...weighted.map(({ item }) => item), ...unweighted];
}

export function yieldToMacrotask(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}
