import React, { useEffect, useState } from 'react';
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

export default function App() {
  const [activeWs, setActiveWs] = useState<WorkspaceId>('market');
  const [liveAuto, setLiveAuto] = useState(true);
  const [status, setStatus] = useState<{
    connected: boolean;
    hoseCount: number;
    vnClock: string;
  }>({ connected: false, hoseCount: 0, vnClock: '' });

  useEffect(() => {
    let mounted = true;
    const fetchStatus = async () => {
      try {
        const resp = await fetch('/api/status');
        if (resp.ok && mounted) {
          const json = await resp.json();
          setStatus({
            connected: Boolean(json.connected),
            hoseCount: Number(json.hoseCount || 0),
            vnClock: String(json.vnClock || ''),
          });
        }
      } catch {
        // ignore transient network errors
      }
    };
    fetchStatus();
    const id = setInterval(fetchStatus, 10_000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

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
              Hệ Thống Phân Tích Định Lượng Minervini &amp; SSI Realtime
            </span>
          </div>
          <div>
            {status.connected ? (
              <span className="inline-block bg-emerald-500/15 text-[#34d399] px-3.5 py-1 rounded-full font-bold text-[12.5px] border border-emerald-500/45">
                🟢 SSI WebSocket Live ({status.hoseCount} mã HOSE) • {status.vnClock}
              </span>
            ) : (
              <span className="inline-block bg-red-500/15 text-[#fca5a5] px-3.5 py-1 rounded-full font-bold text-[12.5px] border border-red-500/45">
                🟡 SSI WebSocket Đang kết nối • {status.vnClock}
              </span>
            )}
          </div>
        </header>

        {/* Flat 5 Workspace Navigation Bar + Live WS Toggle */}
        <nav className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 items-center mb-3">
          {WORKSPACES.map((ws) => {
            const isActive = activeWs === ws.id;
            return (
              <button
                key={ws.id}
                type="button"
                onClick={() => setActiveWs(ws.id)}
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

          <label className="flex items-center justify-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 text-[13px] font-bold text-slate-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={liveAuto}
              onChange={(e) => setLiveAuto(e.target.checked)}
              className="w-4 h-4 accent-[#0284c7]"
            />
            <span>⚡ Live WS (5s)</span>
          </label>
        </nav>

        {/* Workspace Content */}
        <main>
          {activeWs === 'market' && <MarketOverviewWorkspace liveAuto={liveAuto} />}
          {activeWs === 'sector' && <SectorFlowWorkspace />}
          {activeWs === 'screener' && <BreakoutScreenerWorkspace />}
          {activeWs === 'chart' && <ChartAnalysisWorkspace liveAuto={liveAuto} />}
          {activeWs === 'portfolio' && <PortfolioBacktestWorkspace liveAuto={liveAuto} />}
        </main>
      </div>
    </div>
  );
}
