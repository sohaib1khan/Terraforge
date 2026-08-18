/** Lightweight fuzzy match: subsequence + consecutive bonus. Higher score = better. */
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return 1
  const t = text.toLowerCase()
  if (t.includes(q)) return 100 + (q.length / Math.max(t.length, 1)) * 20

  let ti = 0
  let score = 0
  let consecutive = 0
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]!
    let found = false
    while (ti < t.length) {
      if (t[ti] === ch) {
        consecutive++
        score += 1 + consecutive * 2
        if (ti === 0 || /[\s._\-/:]/.test(t[ti - 1]!)) score += 4
        ti++
        found = true
        break
      }
      consecutive = 0
      ti++
    }
    if (!found) return 0
  }
  return score / (1 + t.length * 0.01)
}

export function fuzzyFilter<T>(
  items: T[],
  query: string,
  haystack: (item: T) => string,
): T[] {
  const q = query.trim()
  if (!q) return items
  return items
    .map((item) => ({ item, score: fuzzyScore(q, haystack(item)) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.item)
}
