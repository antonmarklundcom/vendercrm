// Attaches the previous window's value of the same metric to each row of a
// report table (§17.3 P15's comparison column) — pure, so it is testable
// without a report at all: give it two arrays and a key/metric picker.

export function withComparison<T, K>(
  current: T[],
  previous: T[],
  keyOf: (row: T) => K,
  metricOf: (row: T) => number,
): Array<T & { previous: number }> {
  const previousByKey = new Map(previous.map((row) => [keyOf(row), metricOf(row)]));
  return current.map((row) => ({ ...row, previous: previousByKey.get(keyOf(row)) ?? 0 }));
}
