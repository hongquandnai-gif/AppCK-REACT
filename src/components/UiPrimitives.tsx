import React from 'react';
import { Loader2 } from 'lucide-react';

export const MetricCard: React.FC<{
  label: string;
  value: string;
  delta?: string;
  deltaPositive?: boolean | null;
}> = ({ label, value, delta, deltaPositive = null }) => {
  const deltaColor =
    deltaPositive === true
      ? 'text-[#059669] bg-emerald-50'
      : deltaPositive === false
      ? 'text-[#dc2626] bg-red-50'
      : 'text-slate-600 bg-slate-100';

  return (
    <div className="bg-white border border-slate-200 border-l-4 border-l-[#0284c7] rounded-[10px] px-3.5 py-2.5 shadow-xs">
      <div className="text-[12px] font-bold text-slate-500 truncate">{label}</div>
      <div className="text-[20px] font-extrabold text-slate-900 mt-0.5 tabular-nums truncate">
        {value}
      </div>
      {delta && (
        <div
          className={`inline-block mt-1 text-[11.5px] font-bold px-1.5 py-0.5 rounded tabular-nums ${deltaColor}`}
        >
          {delta}
        </div>
      )}
    </div>
  );
};

export const SubTabs: React.FC<{
  tabs: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
}> = ({ tabs, active, onChange }) => (
  <div className="flex flex-wrap gap-1 border-b border-slate-200 mb-3">
    {tabs.map((t) => {
      const isAct = t.id === active;
      return (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={`px-4 py-2 text-[13.5px] font-bold rounded-t-lg transition-colors cursor-pointer ${
            isAct
              ? 'bg-white text-[#0284c7] border border-slate-200 border-b-white -mb-px'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
          }`}
        >
          {t.label}
        </button>
      );
    })}
  </div>
);

export const PrimaryButton: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }
> = ({ children, loading, className = '', disabled, ...rest }) => (
  <button
    type="button"
    disabled={disabled || loading}
    className={`inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg bg-[#0284c7] hover:bg-[#0369a1] disabled:opacity-60 text-white font-bold text-[13px] shadow-xs transition-colors cursor-pointer ${className}`}
    {...rest}
  >
    {loading && <Loader2 className="w-4 h-4 animate-spin" />}
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
    className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 font-semibold text-[13px] transition-colors cursor-pointer ${className}`}
    {...rest}
  >
    {children}
  </button>
);

export const LoadingBar: React.FC<{ text: string }> = ({ text }) => (
  <div className="flex items-center gap-2.5 px-4 py-3 rounded-lg bg-sky-50 border border-sky-200 text-sky-900 text-[13px] font-semibold my-2">
    <Loader2 className="w-4 h-4 animate-spin text-[#0284c7] shrink-0" />
    <span>{text}</span>
  </div>
);

export const FieldLabel: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <label className="flex flex-col gap-1 text-[12px] font-bold text-slate-600">
    <span>{label}</span>
    {children}
  </label>
);

export const inputCls =
  'w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-[13px] text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-[#0284c7]/30 focus:border-[#0284c7]';
