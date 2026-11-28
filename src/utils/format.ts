export function vnTodayIso(): string {
  const vnMs = Date.now() + 7 * 60 * 60 * 1000;
  return new Date(vnMs).toISOString().slice(0, 10);
}

export function addDaysIso(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return dt.toISOString().slice(0, 10);
}

export function fmtIsoToDdMmYyyy(isoDate: string | null | undefined): string {
  if (!isoDate) return '';
  const m = String(isoDate).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(isoDate);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function parseDdMmYyyyToIso(input: string): string | null {
  const m = String(input || '').trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function fmtDisplayDateOrTime(val: string | null | undefined): string {
  if (!val) return '';
  const s = String(val).trim();
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})(.*)$/);
  if (isoMatch) {
    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}${isoMatch[4]}`;
  }
  return s;
}

export function fmtNum(val: number | null | undefined, digits = 2): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  return val.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtInt(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  return Math.round(val).toLocaleString('en-US');
}

export function fmtSigned(val: number | null | undefined, digits = 2, suffix = ''): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  const sign = val > 0 ? '+' : '';
  return `${sign}${val.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}${suffix}`;
}

export function fmtSignedInt(val: number | null | undefined, suffix = ''): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  const r = Math.round(val);
  const sign = r > 0 ? '+' : '';
  return `${sign}${r.toLocaleString('en-US')}${suffix}`;
}

export function colorStatusClass(val: string): string {
  const s = String(val).toUpperCase();
  if (
    ['DẪN DẮT', 'TRÊN', 'ĐẠT (FULL)', 'BUY', 'CHUẨN', 'CHỐT LỜI', 'MUA THÊM', 'GIAI ĐOẠN 2', 'POWER PLAY'].some(
      (k) => s.includes(k)
    )
  ) {
    return 'text-emerald-600 dark:text-emerald-400 font-semibold';
  }
  if (
    ['YẾU', 'DƯỚI', 'SELL', 'CẮT LỖ', 'QUÁ', 'GÃY', 'GIAI ĐOẠN 4', 'CẢNH BÁO'].some((k) =>
      s.includes(k)
    )
  ) {
    return 'text-red-600 dark:text-red-400 font-semibold';
  }
  if (
    ['TRUNG LẬP', 'CHẠM', 'CHỜ', 'NỔ VOL', 'KHÓA LÃI', 'GIAI ĐOẠN 3', 'QUAN SÁT'].some((k) =>
      s.includes(k)
    )
  ) {
    return 'text-amber-600 dark:text-amber-400 font-semibold';
  }
  return 'text-slate-700 dark:text-slate-300';
}

export function colorSignedClass(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) {
    return 'text-slate-500 dark:text-slate-400';
  }
  if (val > 0) return 'text-emerald-600 dark:text-emerald-400 font-semibold';
  if (val < 0) return 'text-red-600 dark:text-red-400 font-semibold';
  return 'text-amber-600 dark:text-amber-400 font-semibold';
}

export function colorPctStrengthClass(val: number): string {
  if (val >= 50) return 'text-emerald-600 dark:text-emerald-400 font-semibold';
  if (val <= 30) return 'text-red-600 dark:text-red-400 font-semibold';
  return 'text-amber-600 dark:text-amber-400 font-semibold';
}

export function colorPctWeakClass(val: number): string {
  return val >= 50
    ? 'text-red-600 dark:text-red-400 font-semibold'
    : 'text-slate-700 dark:text-slate-300';
}

export function colorRsClass(val: number): string {
  if (val >= 90) return 'text-violet-600 dark:text-violet-400 font-semibold';
  if (val >= 80) return 'text-emerald-600 dark:text-emerald-400 font-semibold';
  return 'text-amber-600 dark:text-amber-400 font-semibold';
}

export function colorVolScoreClass(val: number): string {
  return val >= 1.5
    ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
    : 'text-slate-700 dark:text-slate-300';
}

export function downloadCsv(
  filename: string,
  headers: string[],
  rows: (string | number | null | undefined)[][]
) {
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv =
    '\uFEFF' + [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
