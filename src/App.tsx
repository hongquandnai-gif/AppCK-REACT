import React, { useEffect, useState } from 'react';
import {
  BarChart3,
  Briefcase,
  CandlestickChart,
  Compass,
  Crosshair,
  Globe,
  Moon,
  Radio,
  Sun,
} from 'lucide-react';
import { MarketStreamProvider, useMarketStream } from './context/MarketStreamContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { MarketOverviewWorkspace } from './workspaces/MarketOverviewWorkspace';
import { SectorFlowWorkspace } from './workspaces/SectorFlowWorkspace';
import { BreakoutScreenerWorkspace } from './workspaces/BreakoutScreenerWorkspace';
import { ChartAnalysisWorkspace } from './workspaces/ChartAnalysisWorkspace';
import { PortfolioBacktestWorkspace } from './workspaces/PortfolioBacktestWorkspace';

const WORKSPACES = [
  { id: 'market', label: 'Toàn cảnh', icon: Globe },
  { id: 'sector', label: 'Sóng ngành', icon: Compass },
  { id: 'screener', label: 'Lọc đột phá', icon: Crosshair },
  { id: 'chart', label: 'Biểu đồ', icon: CandlestickChart },
  { id: 'portfolio', label: 'Danh mục', icon: Briefcase },
] as const;

type WorkspaceId = (typeof WORKSPACES)[number]['id'];

function AppShell() {
  const [activeWs, setActiveWs] = useState<WorkspaceId>('market');
  const [visitedWs, setVisitedWs] = useState<Record<WorkspaceId, boolean>>({
    market: true,
    sector: false,
    screener: false,
    chart: false,
    portfolio: false,
  });

  const { isDark, toggleTheme } = useTheme();
  const { wsConnected, upstreamSsiConnected, liveAuto, setLiveAuto, status, catalog } =
    useMarketStream();

  const handleSelectWs = (id: WorkspaceId) => {
    setActiveWs(id);
    setVisitedWs((prev) => (prev[id] ? prev : { ...prev, [id]: true }));
  };

  // Trigger a clean Plotly resize whenever switching back to an already-mounted tab
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });
    return () => cancelAnimationFrame(raf);
  }, [activeWs]);

  const hoseCount = catalog?.counts.HOSE || status.hoseCount;
  const hnxCount = catalog?.counts.HNX || status.hnxCount;
  const upcomCount = catalog?.counts.UPCOM || status.upcomCount;
  const totalCount = catalog?.counts.total || status.totalCount;
  const sectorCount = catalog?.industries
    ? catalog.industries.filter((g) => g !== 'Tất cả ngành' && g !== 'Chỉ số').length
    : 0;

  const isStreamUp = upstreamSsiConnected || wsConnected;
  const wsStatusLabel = upstreamSsiConnected
    ? 'SSI WS Live'
    : wsConnected
    ? 'WS Live'
    : 'WS Đang kết nối';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0b1120] text-slate-900 dark:text-slate-100 transition-colors">
      {/* Compact 1-row, 3-zone Top Header */}
      <header className="sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-[1600px] mx-auto px-3 sm:px-5 h-14 flex items-center justify-between gap-3">
          {/* Zone 1: Brand */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-sky-600 dark:bg-sky-500 text-white dark:text-slate-950 flex items-center justify-center shrink-0">
              <BarChart3 className="w-4 h-4" strokeWidth={2.25} />
            </div>
            <span className="text-[15.5px] font-extrabold tracking-tight text-slate-900 dark:text-white whitespace-nowrap">
              V11 PRO
            </span>
          </div>

          {/* Zone 2: Primary Horizontal Workspace Navigation */}
          <nav
            aria-label="Điều hướng chính"
            className="flex items-center gap-1 overflow-x-auto no-scrollbar h-full"
          >
            {WORKSPACES.map((ws) => {
              const isActive = activeWs === ws.id;
              const Icon = ws.icon;
              return (
                <button
                  key={ws.id}
                  type="button"
                  onClick={() => handleSelectWs(ws.id)}
                  className={`relative inline-flex items-center gap-1.5 h-full px-3 text-[13px] whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    isActive
                      ? 'text-sky-600 dark:text-sky-400 font-semibold'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 font-medium'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" strokeWidth={1.85} />
                  <span>{ws.label}</span>
                  {isActive && (
                    <span className="absolute inset-x-2 bottom-0 h-[2px] bg-sky-600 dark:bg-sky-400 rounded-full" />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Live Stream Toggle + Light/Dark Switch */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              role="switch"
              aria-checked={liveAuto}
              onClick={() => setLiveAuto(!liveAuto)}
              title="Bật/tắt cập nhật trực tiếp theo WebSocket SSI"
              className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border text-[12px] font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                liveAuto
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/70 text-emerald-700 dark:text-emerald-300'
                  : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'
              }`}
            >
              <Radio className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
              <span className="hidden sm:inline">WS Live</span>
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  liveAuto
                    ? isStreamUp
                      ? 'bg-emerald-500'
                      : 'bg-amber-500'
                    : 'bg-slate-400 dark:bg-slate-600'
                }`}
              />
            </button>

            <button
              type="button"
              onClick={toggleTheme}
              aria-label={isDark ? 'Chuyển sang giao diện Sáng' : 'Chuyển sang giao diện Tối'}
              title={isDark ? 'Giao diện Sáng' : 'Giao diện Tối'}
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer shrink-0"
            >
              {isDark ? (
                <Sun className="w-4 h-4" strokeWidth={1.85} />
              ) : (
                <Moon className="w-4 h-4" strokeWidth={1.85} />
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <div className="max-w-[1600px] mx-auto px-3 sm:px-5 pt-3 pb-10">
        {/* Quiet Unboxed Inline Context Strip */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 pb-2.5 mb-3 border-b border-slate-200/80 dark:border-slate-800/80 text-[12px] text-slate-500 dark:text-slate-400">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 tabular-nums">
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isStreamUp ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
              />
              <span
                className={
                  isStreamUp
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-amber-600 dark:text-amber-400'
                }
              >
                {wsStatusLabel}
              </span>
            </span>
            <span className="text-slate-300 dark:text-slate-700">·</span>
            <span className="text-slate-700 dark:text-slate-300 font-medium">
              {totalCount > 0
                ? `${totalCount.toLocaleString('en-US')} mã (HOSE ${hoseCount} · HNX ${hnxCount} · UPCOM ${upcomCount})`
                : 'Đang tải danh mục 3 sàn...'}
            </span>
            {sectorCount > 0 && (
              <>
                <span className="text-slate-300 dark:text-slate-700">·</span>
                <span className="text-sky-600 dark:text-sky-400 font-medium">
                  SSI ICB ({sectorCount} ngành)
                </span>
              </>
            )}
          </div>
          {status.vnClock && (
            <div className="font-mono text-[11.5px] font-medium text-slate-500 dark:text-slate-400 tabular-nums">
              {status.vnClock}
            </div>
          )}
        </div>

        {/* Persistent Workspaces — switching tabs never interrupts scans, charts, or inputs */}
        <main>
          {visitedWs.market && (
            <div className={activeWs === 'market' ? 'block' : 'hidden'}>
              <MarketOverviewWorkspace isActive={activeWs === 'market'} />
            </div>
          )}
          {visitedWs.sector && (
            <div className={activeWs === 'sector' ? 'block' : 'hidden'}>
              <SectorFlowWorkspace isActive={activeWs === 'sector'} />
            </div>
          )}
          {visitedWs.screener && (
            <div className={activeWs === 'screener' ? 'block' : 'hidden'}>
              <BreakoutScreenerWorkspace isActive={activeWs === 'screener'} />
            </div>
          )}
          {visitedWs.chart && (
            <div className={activeWs === 'chart' ? 'block' : 'hidden'}>
              <ChartAnalysisWorkspace isActive={activeWs === 'chart'} />
            </div>
          )}
          {visitedWs.portfolio && (
            <div className={activeWs === 'portfolio' ? 'block' : 'hidden'}>
              <PortfolioBacktestWorkspace isActive={activeWs === 'portfolio'} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <MarketStreamProvider>
        <AppShell />
      </MarketStreamProvider>
    </ThemeProvider>
  );
}
