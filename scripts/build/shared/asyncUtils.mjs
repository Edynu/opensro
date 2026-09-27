/**
 * Run `worker` over `items` with at most `limit` jobs in flight.
 * Results retain input order even when workers finish out of order.
 */
export async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const laneCount = Math.max(1, Math.min(normalizeConcurrency(limit), items.length));
  const lanes = Array.from({ length: laneCount }, async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(lanes);
  return results;
}

function normalizeConcurrency(value) {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}
