import React, { useEffect, useRef, useState } from 'react';
import { Calendar } from 'lucide-react';
import { inputCls } from './UiPrimitives';
import { fmtIsoToDdMmYyyy, parseDdMmYyyyToIso } from '../utils/format';

interface DateInputProps {
  value: string; // ISO YYYY-MM-DD
  onChange: (isoDate: string) => void;
  className?: string;
  disabled?: boolean;
  min?: string;
  max?: string;
  ariaLabel?: string;
}

/**
 * Locale-independent date input that ALWAYS renders and accepts dd/mm/yyyy
 * while storing/emitting ISO YYYY-MM-DD values and offering a native calendar picker trigger.
 */
export const DateInput: React.FC<DateInputProps> = ({
  value,
  onChange,
  className,
  disabled = false,
  min,
  max,
  ariaLabel,
}) => {
  const [text, setText] = useState(() => fmtIsoToDdMmYyyy(value));
  const nativeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setText(fmtIsoToDdMmYyyy(value));
  }, [value]);

  const commitText = (raw: string) => {
    const parsed = parseDdMmYyyyToIso(raw);
    if (parsed) {
      if (parsed !== value) onChange(parsed);
      setText(fmtIsoToDdMmYyyy(parsed));
    } else {
      setText(fmtIsoToDdMmYyyy(value));
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    // Allow digits, slashes, hyphens only
    const cleaned = raw.replace(/[^\d\/\-]/g, '').slice(0, 10);
    setText(cleaned);

    // Emit immediately once user enters a full valid dd/mm/yyyy date
    if (cleaned.length === 10) {
      const parsed = parseDdMmYyyyToIso(cleaned);
      if (parsed && parsed !== value) {
        onChange(parsed);
      }
    }
  };

  const openPicker = () => {
    if (disabled || !nativeRef.current) return;
    const el = nativeRef.current as HTMLInputElement & { showPicker?: () => void };
    if (typeof el.showPicker === 'function') {
      try {
        el.showPicker();
        return;
      } catch {
        // Fall through to click/focus
      }
    }
    el.focus();
    el.click();
  };

  return (
    <div className="relative w-full">
      <input
        type="text"
        inputMode="numeric"
        value={text}
        disabled={disabled}
        aria-label={ariaLabel}
        placeholder="dd/mm/yyyy"
        maxLength={10}
        onChange={handleTextChange}
        onBlur={() => commitText(text)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commitText(text);
          }
        }}
        className={`${className || inputCls} pr-9 font-mono tabular-nums`}
      />

      <div
        onClick={openPicker}
        className={`absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 rounded-md flex items-center justify-center text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ${
          disabled ? 'opacity-40 pointer-events-none' : 'cursor-pointer'
        }`}
        title="Chọn ngày (dd/mm/yyyy)"
      >
        <Calendar className="w-3.5 h-3.5 pointer-events-none" />
        <input
          ref={nativeRef}
          type="date"
          tabIndex={-1}
          aria-hidden="true"
          disabled={disabled}
          value={value || ''}
          min={min}
          max={max}
          onChange={(e) => {
            if (e.target.value) {
              onChange(e.target.value);
              setText(fmtIsoToDdMmYyyy(e.target.value));
            }
          }}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
      </div>
    </div>
  );
};
