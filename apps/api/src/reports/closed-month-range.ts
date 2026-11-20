export interface DateRange {
  start: Date;
  end: Date;
}

/**
 * "current" is the most recently fully completed UTC calendar month before
 * `reference` (the in-progress month is never included, so the report
 * never compares a partial month against a full one); "previous" is the
 * month before that.
 */
export function getClosedMonthRanges(reference: Date): { current: DateRange; previous: DateRange } {
  const referenceMonthStart = Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), 1);

  const currentStart = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() - 1, 1));
  const currentEnd = new Date(referenceMonthStart);
  const previousStart = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() - 2, 1));
  const previousEnd = currentStart;

  return {
    current: { start: currentStart, end: currentEnd },
    previous: { start: previousStart, end: previousEnd },
  };
}
