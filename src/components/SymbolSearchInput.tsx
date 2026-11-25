import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { StockCatalogItem } from '../types/catalog';

interface SymbolSearchInputProps {
  value: string;
  onSelect: (symbol: string) => void;
  onChangeQuery?: (raw: string) => void;
  items: StockCatalogItem[];
  placeholder?: string;
  allowFreeText?: boolean;
  className?: string;
}

function stripDiacritics(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

const EXCHANGE_TEXT_COLOR: Record<StockCatalogItem['exchange'], string> = {
  HOSE: 'text-sky-600 dark:text-sky-400',
  HNX: 'text-emerald-600 dark:text-emerald-400',
  UPCOM: 'text-amber-600 dark:text-amber-400',
  INDEX: 'text-violet-600 dark:text-violet-400',
};

export const SymbolSearchInput: React.FC<SymbolSearchInputProps> = ({
  value,
  onSelect,
  onChangeQuery,
  items,
  placeholder = 'Tìm hoặc nhập mã (VD: FPT, CEO, BSR...)',
  allowFreeText = true,
  className = '',
}) => {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        if (!onChangeQuery) setQuery(value);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [value, onChangeQuery]);

  const trimmedUpper = query.trim().toUpperCase();

  const matches = useMemo(() => {
    if (!trimmedUpper) {
      return items.slice(0, 80);
    }
    const qNorm = stripDiacritics(query.trim());
    const exact: StockCatalogItem[] = [];
    const prefix: StockCatalogItem[] = [];
    const symContains: StockCatalogItem[] = [];
    const nameContains: StockCatalogItem[] = [];

    for (const item of items) {
      if (item.symbol === trimmedUpper) {
        exact.push(item);
      } else if (item.symbol.startsWith(trimmedUpper)) {
        prefix.push(item);
      } else if (item.symbol.includes(trimmedUpper)) {
        symContains.push(item);
      } else if (
        stripDiacritics(item.companyName).includes(qNorm) ||
        stripDiacritics(item.industry).includes(qNorm)
      ) {
        nameContains.push(item);
      }
    }

    return [...exact, ...prefix, ...symContains, ...nameContains].slice(0, 60);
  }, [items, query, trimmedUpper]);

  const hasExactMatch = useMemo(
    () => matches.some((m) => m.symbol === trimmedUpper),
    [matches, trimmedUpper]
  );

  const showCustomOption =
    allowFreeText && trimmedUpper.length >= 2 && /^[A-Z0-9]+$/.test(trimmedUpper) && !hasExactMatch;

  useEffect(() => {
    setHighlightIdx(0);
  }, [query, open]);

  const commitSymbol = (sym: string) => {
    const clean = sym.trim().toUpperCase();
    if (!clean) return;
    setQuery(clean);
    setOpen(false);
    onSelect(clean);
  };

  const totalOptions = matches.length + (showCustomOption ? 1 : 0);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (totalOptions > 0) setHighlightIdx((prev) => (prev + 1) % totalOptions);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (totalOptions > 0) setHighlightIdx((prev) => (prev - 1 + totalOptions) % totalOptions);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (showCustomOption && highlightIdx === 0) {
        commitSymbol(trimmedUpper);
        return;
      }
      const matchIndex = showCustomOption ? highlightIdx - 1 : highlightIdx;
      if (matches[matchIndex]) {
        commitSymbol(matches[matchIndex].symbol);
      } else if (allowFreeText && trimmedUpper) {
        commitSymbol(trimmedUpper);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery(value);
      inputRef.current?.blur();
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative flex items-center">
        <Search className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 absolute left-2.5 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onFocus={() => {
            setOpen(true);
            inputRef.current?.select();
          }}
          onChange={(e) => {
            const next = e.target.value.toUpperCase();
            setQuery(next);
            onChangeQuery?.(next);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          className="w-full h-9 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg pl-8 pr-7 text-[13px] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 font-semibold font-mono focus:outline-none focus:ring-2 focus:ring-sky-500/25 focus:border-sky-500 dark:focus:border-sky-400 transition-colors"
        />
        {query && (
          <button
            type="button"
            tabIndex={-1}
            aria-label="Xóa tìm kiếm"
            onClick={() => {
              setQuery('');
              onChangeQuery?.('');
              setOpen(true);
              inputRef.current?.focus();
            }}
            className="absolute right-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute left-0 right-0 mt-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg z-40 max-h-72 overflow-y-auto min-w-[270px]">
          {showCustomOption && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                commitSymbol(trimmedUpper);
              }}
              className={`w-full text-left px-3 py-2 text-[12.5px] border-b border-slate-100 dark:border-slate-800 flex items-center justify-between cursor-pointer ${
                highlightIdx === 0
                  ? 'bg-sky-50 dark:bg-sky-950/50 text-sky-600 dark:text-sky-400'
                  : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200'
              }`}
            >
              <span>
                Tra cứu tự do mã <strong className="font-mono font-bold">{trimmedUpper}</strong>
              </span>
              <span className="text-[11px] text-slate-400 font-mono">Enter</span>
            </button>
          )}

          {matches.length === 0 && !showCustomOption && (
            <div className="px-3 py-3 text-[12.5px] text-slate-500 dark:text-slate-400">
              Không tìm thấy mã phù hợp. Bạn có thể nhập mã trực tiếp rồi nhấn Enter.
            </div>
          )}

          {matches.map((item, idx) => {
            const optionIndex = showCustomOption ? idx + 1 : idx;
            const isHighlighted = optionIndex === highlightIdx;
            const isSelected = item.symbol === value;
            return (
              <button
                key={`${item.exchange}_${item.symbol}`}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  commitSymbol(item.symbol);
                }}
                onMouseEnter={() => setHighlightIdx(optionIndex)}
                className={`w-full text-left px-3 py-2 border-b border-slate-100 dark:border-slate-800/80 last:border-b-0 flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                  isHighlighted
                    ? 'bg-sky-50 dark:bg-sky-950/50'
                    : isSelected
                    ? 'bg-slate-50 dark:bg-slate-800/70'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[12.5px]">
                    <span className="font-bold font-mono text-slate-900 dark:text-slate-100 tabular-nums">
                      {item.symbol}
                    </span>
                    <span
                      className={`text-[11px] font-semibold ${
                        EXCHANGE_TEXT_COLOR[item.exchange] || 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {item.exchange === 'INDEX' ? 'CHỈ SỐ' : item.exchange}
                    </span>
                    <span className="text-slate-300 dark:text-slate-600">·</span>
                    <span className="text-[11.5px] text-slate-500 dark:text-slate-400 truncate">
                      {item.industry}
                    </span>
                  </div>
                  {item.companyName && item.companyName !== item.symbol && (
                    <div className="text-[11.5px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                      {item.companyName}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
