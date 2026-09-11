export async function readAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 500,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < 100_000; from += pageSize) {
    const result = await fetchPage(from, from + pageSize - 1);
    if (result.error || result.data === null) throw new Error('database_error');
    rows.push(...result.data);
    if (result.data.length < pageSize) return rows;
  }
  // Fail explicitly rather than return deceptively complete statistics.
  throw new Error('too_many_records');
}
