import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { StockCatalogResponse } from '../types/catalog';
import type { LiveTickDto } from '../utils/livePatch';

export interface MarketStatusDto {
  connected: boolean;
  upstreamSsiConnected: boolean;
  hoseCount: number;
  hnxCount: number;
  upcomCount: number;
  totalCount: number;
  dataSource: string;
  classificationStandard: string;
  ssiRestBlocked: boolean;
  vnClock: string;
  today: string;
  lastUpdate: string;
}

export interface SyncVersionState {
  board: number;
  indices: number;
  lastSyncTime: string;
  lastSource: string;
}

interface MarketStreamContextValue {
  wsConnected: boolean;
  upstreamSsiConnected: boolean;
  liveAuto: boolean;
  setLiveAuto: React.Dispatch<React.SetStateAction<boolean>>;
  status: MarketStatusDto;
  catalog: StockCatalogResponse | null;
  refreshCatalog: (force?: boolean) => Promise<void>;
  ticks: Record<string, LiveTickDto>;
  tickVersion: number;
  syncVersion: SyncVersionState;
  subscribe: (symbols: string[]) => void;
  unsubscribe: (symbols: string[]) => void;
}

const DEFAULT_STATUS: MarketStatusDto = {
  connected: false,
  upstreamSsiConnected: false,
  hoseCount: 0,
  hnxCount: 0,
  upcomCount: 0,
  totalCount: 0,
  dataSource: 'SSI',
  classificationStandard: 'SSI ICB Level-2',
  ssiRestBlocked: false,
  vnClock: '',
  today: '',
  lastUpdate: '',
};

const MarketStreamContext = createContext<MarketStreamContextValue | null>(null);

export const MarketStreamProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [wsConnected, setWsConnected] = useState(false);
  const [liveAuto, setLiveAuto] = useState(true);
  const [status, setStatus] = useState<MarketStatusDto>(DEFAULT_STATUS);
  const [catalog, setCatalog] = useState<StockCatalogResponse | null>(null);
  const [ticks, setTicks] = useState<Record<string, LiveTickDto>>({});
  const [tickVersion, setTickVersion] = useState(0);
  const [syncVersion, setSyncVersion] = useState<SyncVersionState>({
    board: 0,
    indices: 0,
    lastSyncTime: '',
    lastSource: '',
  });

  const wsRef = useRef<WebSocket | null>(null);
  const subCountsRef = useRef<Map<string, number>>(new Map());
  const ticksRef = useRef<Record<string, LiveTickDto>>({});
  const liveAutoRef = useRef(liveAuto);
  liveAutoRef.current = liveAuto;

  const sendWs = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(payload));
      } catch {
        // ignore closed socket race
      }
    }
  }, []);

  const subscribe = useCallback(
    (symbols: string[]) => {
      const newlyAdded: string[] = [];
      for (const raw of symbols) {
        const sym = String(raw || '').toUpperCase().trim();
        if (!sym) continue;
        const prev = subCountsRef.current.get(sym) || 0;
        subCountsRef.current.set(sym, prev + 1);
        if (prev === 0) newlyAdded.push(sym);
      }
      if (newlyAdded.length > 0) {
        sendWs({ type: 'subscribe', symbols: newlyAdded });
      }
    },
    [sendWs]
  );

  const unsubscribe = useCallback(
    (symbols: string[]) => {
      const removed: string[] = [];
      for (const raw of symbols) {
        const sym = String(raw || '').toUpperCase().trim();
        if (!sym) continue;
        const prev = subCountsRef.current.get(sym) || 0;
        if (prev <= 1) {
          subCountsRef.current.delete(sym);
          if (prev === 1) removed.push(sym);
        } else {
          subCountsRef.current.set(sym, prev - 1);
        }
      }
      if (removed.length > 0) {
        sendWs({ type: 'unsubscribe', symbols: removed });
      }
    },
    [sendWs]
  );

  const refreshCatalog = useCallback(async (force = false) => {
    try {
      const resp = await fetch(`/api/stocks${force ? '?refresh=1' : ''}`);
      if (resp.ok) {
        const json: StockCatalogResponse = await resp.json();
        setCatalog(json);
      }
    } catch {
      // ignore transient errors
    }
  }, []);

  // Load unified SSI 3-exchange catalog + initial status once on mount
  useEffect(() => {
    let mounted = true;
    refreshCatalog(false);
    fetch('/api/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (mounted && json) {
          setStatus((prev) => ({
            ...prev,
            connected: Boolean(json.connected),
            upstreamSsiConnected: Boolean(json.upstreamSsiConnected),
            hoseCount: Number(json.hoseCount || 0),
            hnxCount: Number(json.hnxCount || 0),
            upcomCount: Number(json.upcomCount || 0),
            totalCount: Number(json.totalCount || json.hoseCount || 0),
            dataSource: String(json.dataSource || 'SSI'),
            classificationStandard: String(json.classificationStandard || 'SSI ICB Level-2'),
            ssiRestBlocked: Boolean(json.ssiRestBlocked),
            vnClock: String(json.vnClock || ''),
            today: String(json.today || ''),
            lastUpdate: String(json.lastUpdate || ''),
          }));
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [refreshCatalog]);

  // Flush buffered ticks immediately when user re-enables liveAuto
  useEffect(() => {
    if (liveAuto && Object.keys(ticksRef.current).length > 0) {
      setTicks({ ...ticksRef.current });
      setTickVersion((v) => v + 1);
    }
  }, [liveAuto]);

  // Single persistent WebSocket connection to /ws
  useEffect(() => {
    let disposed = false;
    let reconnectDelay = 1000;
    let reconnectTimer: number | null = null;
    let pingTimer: number | null = null;

    const connect = () => {
      if (disposed) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${window.location.host}/ws`;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        reconnectTimer = window.setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 10_000);
        return;
      }

      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed) {
          ws.close();
          return;
        }
        reconnectDelay = 1000;
        setWsConnected(true);

        // Re-register all active subscriptions on (re)connect
        const activeSubs = [...subCountsRef.current.keys()];
        if (activeSubs.length > 0) {
          sendWs({ type: 'subscribe', symbols: activeSubs });
        }

        if (pingTimer !== null) window.clearInterval(pingTimer);
        pingTimer = window.setInterval(() => {
          sendWs({ type: 'ping' });
        }, 25_000);
      };

      ws.onmessage = (event) => {
        if (disposed) return;
        try {
          const msg = JSON.parse(String(event.data || '{}'));
          if (msg.type === 'status' && msg.status) {
            const s = msg.status;
            setStatus((prev) => ({
              ...prev,
              connected: Boolean(s.connected),
              upstreamSsiConnected: Boolean(s.upstreamSsiConnected),
              hoseCount: Number(s.hoseCount || prev.hoseCount),
              hnxCount: Number(s.hnxCount || prev.hnxCount),
              upcomCount: Number(s.upcomCount || prev.upcomCount),
              totalCount: Number(s.totalCount || prev.totalCount),
              dataSource: String(s.dataSource || prev.dataSource),
              classificationStandard: String(
                s.classificationStandard || prev.classificationStandard
              ),
              ssiRestBlocked: Boolean(s.ssiRestBlocked),
              vnClock: String(s.vnClock || prev.vnClock),
              today: String(s.today || prev.today),
              lastUpdate: String(s.lastUpdate || prev.lastUpdate),
            }));
          } else if (msg.type === 'ticks' && msg.ticks && typeof msg.ticks === 'object') {
            const incoming = msg.ticks as Record<string, LiveTickDto>;
            let changed = false;
            for (const [sym, tick] of Object.entries(incoming)) {
              const prev = ticksRef.current[sym];
              if (
                !prev ||
                prev.last !== tick.last ||
                prev.volume !== tick.volume ||
                prev.value_bil !== tick.value_bil ||
                prev.pct !== tick.pct
              ) {
                ticksRef.current[sym] = tick;
                changed = true;
              }
            }
            if (changed && liveAutoRef.current) {
              setTicks({ ...ticksRef.current });
              setTickVersion((v) => v + 1);
            }
          } else if (msg.type === 'sync') {
            if (liveAutoRef.current) {
              setSyncVersion((prev) => ({
                board: msg.kind === 'board' ? prev.board + 1 : prev.board,
                indices: msg.kind === 'indices' ? prev.indices + 1 : prev.indices,
                lastSyncTime: String(msg.syncTime || prev.lastSyncTime),
                lastSource: String(msg.source || prev.lastSource),
              }));
            }
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onerror = () => {
        // onclose handles reconnect cleanly
      };

      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        if (pingTimer !== null) {
          window.clearInterval(pingTimer);
          pingTimer = null;
        }
        if (disposed) return;
        setWsConnected(false);
        reconnectTimer = window.setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 10_000);
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (pingTimer !== null) window.clearInterval(pingTimer);
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // ignore
        }
        wsRef.current = null;
      }
    };
  }, [sendWs]);

  const value = useMemo<MarketStreamContextValue>(
    () => ({
      wsConnected,
      upstreamSsiConnected: status.upstreamSsiConnected,
      liveAuto,
      setLiveAuto,
      status,
      catalog,
      refreshCatalog,
      ticks,
      tickVersion,
      syncVersion,
      subscribe,
      unsubscribe,
    }),
    [
      wsConnected,
      status,
      liveAuto,
      catalog,
      refreshCatalog,
      ticks,
      tickVersion,
      syncVersion,
      subscribe,
      unsubscribe,
    ]
  );

  return <MarketStreamContext.Provider value={value}>{children}</MarketStreamContext.Provider>;
};

export function useMarketStream(): MarketStreamContextValue {
  const ctx = useContext(MarketStreamContext);
  if (!ctx) {
    throw new Error('useMarketStream must be used inside <MarketStreamProvider>');
  }
  return ctx;
}

/**
 * Declaratively subscribes a stable set of symbols to the WebSocket stream
 * and cleanly unsubscribes on change or unmount.
 */
export function useSubscribeSymbols(symbols: string[], enabled = true): void {
  const { subscribe, unsubscribe } = useMarketStream();

  const normalizedKey = useMemo(() => {
    if (!enabled || !symbols.length) return '';
    const unique = new Set<string>();
    for (const s of symbols) {
      const sym = String(s || '').toUpperCase().trim();
      if (sym) unique.add(sym);
    }
    return [...unique].sort().join(',');
  }, [symbols, enabled]);

  useEffect(() => {
    if (!normalizedKey) return;
    const list = normalizedKey.split(',');
    subscribe(list);
    return () => {
      unsubscribe(list);
    };
  }, [normalizedKey, subscribe, unsubscribe]);
}
