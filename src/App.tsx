import React, { useEffect, useState } from 'react';
import { MarketStreamProvider, useMarketStream } from './context/MarketStreamContext';
import { MarketOverviewWorkspace } from './workspaces/MarketOverviewWorkspace';
import { SectorFlowWorkspace } from './workspaces/SectorFlowWorkspace';
import { BreakoutScreenerWorkspace } from './workspaces/BreakoutScreenerWorkspace';
import { ChartAnalysisWorkspace } from './workspaces/ChartAnalysisWorkspace';
import { PortfolioBacktestWorkspace } from './workspaces/PortfolioBacktestWorkspace';

const WORKSPACES = [
  { id: 'market', label: '🌐 Toàn Cảnh Thị Trường' },
  { id: 'sector', label: '🧭 Sóng Ngành & Dòng Tiền' },
  { id: 'screener', label: '🎯 Lọc Cổ Phiếu Đột Phá' },
  { id: 'chart', label: '📈 Phân Tích Biểu Đồ' },
  { id: 'portfolio', label: '💼 Danh Mục & Backtest' },
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

  const wsBadgeLabel = upstreamSsiConnected
    ? '● SSI WS Live'
    : wsConnected
    ? '● WS Live'
    : '● WS Đang kết nối';

  const wsBadgeClass =
    upstreamSsiConnected || wsConnected ? 'text-[#34d399]' : 'text-[#fbbf24]';

  return (
    <div className="min-h-screen bg-[#f1f5f9] text-[#0f172a]">
      <div className="max-w-[98.5%] mx-auto px-2 sm:px-3 pt-3 pb-10">
        {/* V11 PRO Header */}
        <header
          className="rounded-[10px] px-5 py-3 flex flex-wrap justify-between items-center gap-2 mb-2.5 shadow-sm"
          style={{ background: 'linear-gradient(90deg, #0f172a 0%, #1e293b 100%)' }}
        >
          <div className="flex flex-wrap items-baseline gap-2.5">
            <h1 className="text-[#38bdf8] text-[18px] font-extrabold tracking-wide m-0">
              📊 V11 PRO
            </h1>
            <span className="text-[#94a3b8] text-[12px] font-medium">
              Hệ Thống Phân Tích Định Lượng Minervini &amp; Toàn Thị Trường Việt Nam
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] font-semibold tabular-nums">
            <span className={wsBadgeClass}>{wsBadgeLabel}</span>
            <span className="text-slate-600">·</span>
            <span className="text-slate-200">
              {totalCount > 0
                ? `${totalCount.toLocaleString('en-US')} mã (HOSE ${hoseCount} · HNX ${hnxCount} · UPCOM ${upcomCount})`
                : 'Đang tải danh mục 3 sàn...'}
            </span>
            {sectorCount > 0 && (
              <>
                <span className="text-slate-600">·</span>
                <span className="text-sky-300">SSI ICB ({sectorCount} ngành)</span>
              </>
            )}
            {status.vnClock && (
              <>
                <span className="text-slate-600">·</span>
                <span className="text-slate-300">{status.vnClock}</span>
              </>
            )}
          </div>
        </header>

        {/* Flat 5 Workspace Navigation Bar + Realtime WS Stream Toggle */}
        <nav className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 items-center mb-3">
          {WORKSPACES.map((ws) => {
            const isActive = activeWs === ws.id;
            return (
              <button
                key={ws.id}
                type="button"
                onClick={() => handleSelectWs(ws.id)}
                className={`w-full px-3 py-2 rounded-lg text-[13px] transition-colors cursor-pointer truncate ${
                  isActive
                    ? 'bg-[#0284c7] hover:bg-[#0369a1] text-white font-bold shadow-xs border border-[#0284c7]'
                    : 'bg-white hover:bg-slate-200 text-slate-700 hover:text-slate-900 font-semibold border border-slate-300'
                }`}
              >
                {ws.label}
              </button>
            );
          })}

          <label
            className="flex items-center justify-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 text-[13px] font-bold text-slate-700 cursor-pointer select-none"
            title="Cập nhật trực tiếp theo WebSocket không làm gián đoạn thao tác"
          >
            <input
              type="checkbox"
              checked={liveAuto}
              onChange={(e) => setLiveAuto(e.target.checked)}
              className="w-4 h-4 accent-[#0284c7]"
            />
            <span>⚡ Cập nhật WS Live</span>
          </label>
        </nav>

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
    <MarketStreamProvider>
      <AppShell />
    </MarketStreamProvider>
  );
}
