export interface OhlcvBar {
  /** Unix timestamp in seconds (UTC) */
  t: number;
  /** Local VN date string YYYY-MM-DD */
  date: string;
  /** Local VN time string HH:MM */
  time: string;
  /** Local VN display string YYYY-MM-DD HH:MM */
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface LiveTick {
  symbol: string;
  last: number;
  ref: number | null;
  delta: number;
  pct: number;
  volume: number;
  value_bil?: number;
  time: string;
}

export const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

export function vnNowParts(nowMs = Date.now()) {
  const d = new Date(nowMs + VN_OFFSET_MS);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hour = String(d.getUTCHours()).padStart(2, '0');
  const minute = String(d.getUTCMinutes()).padStart(2, '0');
  const second = String(d.getUTCSeconds()).padStart(2, '0');
  const weekday = d.getUTCDay();
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    weekday,
    dateStr: `${year}-${month}-${day}`,
    ddmm: `${day}/${month}`,
    ddmmyyyy: `${day}/${month}/${year}`,
    clock: `${day}/${month}/${year} ${hour}:${minute}`,
    hms: `${hour}:${minute}:${second}`,
    hm: `${hour}:${minute}`,
    hhmm: Number(hour) * 100 + Number(minute),
  };
}

export function vnTodayStr(): string {
  return vnNowParts().dateStr;
}

export function addDaysToDateStr(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return dt.toISOString().slice(0, 10);
}

export function formatDdMm(dateStr: string): string {
  const [, m, d] = dateStr.split('-');
  return `${d}/${m}`;
}

export function formatDdMmYyyy(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}
