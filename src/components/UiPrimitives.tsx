import React from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';

export const MetricCard: React.FC<{
  label: string;
  value: string;
  delta?: string;
  deltaPositive?: boolean | null;
}> = ({ label, value, delta, deltaPositive = null }) => {
  const deltaColor =
    deltaPositive === true
      ? 'text-emerald-600 dark:text-emerald-400'
      : deltaPositive === false
      ? 'text-red-600 dark:text-red-400'
      : 'text-slate-500 dark:text-slate-400';

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3">
      <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 truncate">
        {label}
      </div>
      <div className="text-[20px] font-bold font-mono text-slate-900 dark:text-slate-50 mt-1 tabular-nums truncate tracking-tight">
        {value}
      </div>
      {delta && (
        <div className={`mt-1 text-[12px] font-semibold font-mono tabular-nums truncate ${deltaColor}`}>
          {delta}
        </div>
      )}
    </div>
  );
};

export const SectionCard: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className = '' }) => (
  <div
    className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl ${className}`}
  >
    {children}
  </div>
);

export const SubTabs: React.FC<{
  tabs: { id: string; label: string; icon?: React.ReactNode }[];
  active: string;
  onChange: (id: string) => void;
}> = ({ tabs, active, onChange }) => (
  <div className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-800 mb-4 overflow-x-auto no-scrollbar">
    {tabs.map((t) => {
      const isAct = t.id === active;
      return (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 text-[13px] whitespace-nowrap shrink-0 border-b-2 -mb-px transition-colors cursor-pointer ${
            isAct
              ? 'border-sky-600 dark:border-sky-400 text-sky-600 dark:text-sky-400 font-semibold'
              : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:border-slate-300 dark:hover:border-slate-700 font-medium'
          }`}
        >
          {t.icon && <span className="shrink-0 opacity-90">{t.icon}</span>}
          <span>{t.label}</span>
        </button>
      );
    })}
  </div>
);

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (val: T) => void;
  size?: 'sm' | 'md';
}) {
  const padCls = size === 'sm' ? 'px-2.5 py-1 text-[12px]' : 'px-3 py-1.5 text-[12.5px]';
  return (
    <div className="inline-flex items-center bg-slate-100 dark:bg-slate-800/90 p-0.5 rounded-lg border border-slate-200/80 dark:border-slate-700/80 shrink-0">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`${padCls} rounded-md whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              active
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white font-semibold shadow-2xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 font-medium'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export const PrimaryButton: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }
> = ({ children, loading, className = '', disabled, ...rest }) => (
  <button
    type="button"
    disabled={disabled || loading}
    className={`inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg bg-sky-600 hover:bg-sky-700 dark:bg-sky-500 dark:hover:bg-sky-400 disabled:opacity-55 text-white dark:text-slate-950 font-semibold text-[13px] whitespace-nowrap shrink-0 transition-colors cursor-pointer ${className}`}
    {...rest}
  >
    {loading && <Loader2 className="w-4 h-4 animate-spin shrink-0" />}
    {children}
  </button>
);

export const SecondaryButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({
  children,
  className = '',
  ...rest
}) => (
  <button
    type="button"
    className={`inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-medium text-[13px] whitespace-nowrap shrink-0 transition-colors cursor-pointer disabled:opacity-55 ${className}`}
    {...rest}
  >
    {children}
  </button>
);

export const LoadingBar: React.FC<{ text: string }> = ({ text }) => (
  <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-sky-50/80 dark:bg-sky-950/40 border border-sky-200/80 dark:border-sky-800/60 text-sky-900 dark:text-sky-200 text-[13px] font-medium my-2">
    <Loader2 className="w-4 h-4 animate-spin text-sky-600 dark:text-sky-400 shrink-0" />
    <span>{text}</span>
  </div>
);

export const ErrorBanner: React.FC<{ message: string; className?: string }> = ({
  message,
  className = '',
}) => (
  <div
    className={`flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl bg-red-50/90 dark:bg-red-950/40 border border-red-200 dark:border-red-900/70 text-red-700 dark:text-red-300 text-[13px] font-medium ${className}`}
  >
    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600 dark:text-red-400" />
    <span>{message}</span>
  </div>
);

export const EmptyState: React.FC<{ message: string; className?: string }> = ({
  message,
  className = '',
}) => (
  <div
    className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-6 text-center text-[13px] text-slate-500 dark:text-slate-400 ${className}`}
  >
    {message}
  </div>
);

export const FieldLabel: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <label className="flex flex-col gap-1 text-[11.5px] font-semibold text-slate-500 dark:text-slate-400">
    <span>{label}</span>
    {children}
  </label>
);

export const inputCls =
  'w-full h-9 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 text-[13px] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 font-medium focus:outline-none focus:ring-2 focus:ring-sky-500/25 focus:border-sky-500 dark:focus:border-sky-400 transition-colors';

export const tableWrapCls =
  'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden';

export const tableHeadCls =
  'bg-slate-50 dark:bg-slate-800/80 sticky top-0 z-10 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 text-[11.5px] uppercase tracking-wider font-semibold';

export const tableRowCls =
  'hover:bg-slate-50/90 dark:hover:bg-slate-800/50 transition-colors';
