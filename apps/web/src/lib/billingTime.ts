/** Resolve a civil day in the contract timezone, including historical DST. */
export function brasiliaWallClockIso(day: string, time: string): string {
  const target = Date.parse(`${day}T${time}:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time) || !Number.isFinite(target)) {
    throw new Error('Data inválida');
  }
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  let instant = target;
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(({ type, value }) => [type, value]));
    const localAsUtc = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
    const adjustment = target - localAsUtc;
    if (adjustment === 0) break;
    instant += adjustment;
  }
  return new Date(instant).toISOString();
}

export function brasiliaDayStartIso(day: string): string {
  return brasiliaWallClockIso(day, '00:00');
}

export function billingMonthStartIso(month: string): string {
  return brasiliaDayStartIso(`${month}-01`);
}

/**
 * Last millisecond of a civil day in the contract timezone: the start of the
 * following day minus 1 ms, so an inclusive "até" filter takes the whole day.
 */
export function brasiliaDayEndIso(day: string): string {
  brasiliaDayStartIso(day); // valida o dia antes de somar
  const next = new Date(`${day}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const nextStart = Date.parse(brasiliaDayStartIso(next.toISOString().slice(0, 10)));
  return new Date(nextStart - 1).toISOString();
}
