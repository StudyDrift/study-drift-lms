export type RandomSource = () => number

function defaultRandom(): number {
  return Math.random()
}

function randomInt(maxExclusive: number, random: RandomSource): number {
  return Math.floor(random() * maxExclusive)
}

/** In-place Fisher-Yates shuffle; pass a seeded `random` for deterministic output. */
export function shuffleInPlace<T>(items: T[], random: RandomSource = defaultRandom): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(i + 1, random)
    ;[items[i], items[j]] = [items[j], items[i]]
  }
  return items
}

/** Returns a shuffled copy, preserving the input array. */
export function shuffleArray<T>(items: readonly T[], random: RandomSource = defaultRandom): T[] {
  return shuffleInPlace([...items], random)
}

/** Returns a shuffled index permutation for `0..length-1`. */
export function shuffledIndices(length: number, random: RandomSource = defaultRandom): number[] {
  return shuffleInPlace(
    Array.from({ length }, (_, i) => i),
    random,
  )
}
