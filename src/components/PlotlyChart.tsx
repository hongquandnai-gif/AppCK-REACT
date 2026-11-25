import React, { useEffect, useRef } from 'react';
import Plotly from 'plotly.js-dist-min';
import { useTheme } from '../context/ThemeContext';

interface PlotlyChartProps {
  data: any[];
  layout: Record<string, any>;
  config?: Record<string, any>;
  className?: string;
  height?: number;
  onHover?: (ev: any) => void;
  onUnhover?: () => void;
}

const LIGHT_GRIDS = new Set(['#f1f5f9', '#e2e8f0', '#eef2f7']);
const DARK_TEXTS = new Set(['#0f172a', '#1e293b', '#334155', '#475569']);

function themeAxis(axis: Record<string, any> | undefined, isDark: boolean): Record<string, any> | undefined {
  if (!axis) return axis;
  const next = { ...axis };
  if (isDark) {
    if (!next.gridcolor || LIGHT_GRIDS.has(String(next.gridcolor).toLowerCase())) {
      next.gridcolor = '#1e293b';
    }
    if (!next.zerolinecolor || ['#cbd5e1', '#94a3b8', '#e2e8f0'].includes(String(next.zerolinecolor).toLowerCase())) {
      next.zerolinecolor = '#334155';
    }
    if (next.linecolor && LIGHT_GRIDS.has(String(next.linecolor).toLowerCase())) {
      next.linecolor = '#334155';
    }
    if (next.spikecolor && String(next.spikecolor).toLowerCase() === '#94a3b8') {
      next.spikecolor = '#475569';
    }
    next.tickfont = {
      color: '#94a3b8',
      ...(next.tickfont || {}),
    };
    if (next.title) {
      if (typeof next.title === 'string') {
        next.title = { text: next.title, font: { color: '#94a3b8' } };
      } else {
        next.title = {
          ...next.title,
          font: { color: '#94a3b8', ...(next.title.font || {}) },
        };
      }
    }
  } else {
    next.tickfont = {
      color: '#64748b',
      ...(next.tickfont || {}),
    };
  }
  return next;
}

function adaptLayoutForTheme(
  layout: Record<string, any>,
  height: number,
  isDark: boolean
): Record<string, any> {
  const baseBg = isDark ? '#0f172a' : '#ffffff';
  const baseFontColor = isDark ? '#cbd5e1' : '#334155';
  const baseFont = {
    family: '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, sans-serif',
    size: 12,
    color: baseFontColor,
    ...(layout?.font || {}),
  };
  if (isDark && layout?.font?.color && DARK_TEXTS.has(String(layout.font.color).toLowerCase())) {
    baseFont.color = '#cbd5e1';
  }

  const next: Record<string, any> = {
    paper_bgcolor: baseBg,
    plot_bgcolor: baseBg,
    height,
    ...layout,
    font: baseFont,
    uirevision: layout?.uirevision ?? 'v11_keep_view',
  };

  if (
    isDark &&
    (!layout?.paper_bgcolor || String(layout.paper_bgcolor).toLowerCase() === '#ffffff')
  ) {
    next.paper_bgcolor = '#0f172a';
  }
  if (
    isDark &&
    (!layout?.plot_bgcolor || String(layout.plot_bgcolor).toLowerCase() === '#ffffff')
  ) {
    next.plot_bgcolor = '#0f172a';
  }

  // Adapt all x/y axes (xaxis, xaxis2, yaxis, yaxis2, ...)
  for (const key of Object.keys(next)) {
    if (/^[xy]axis\d*$/.test(key) && typeof next[key] === 'object' && next[key] !== null) {
      next[key] = themeAxis(next[key], isDark);
    }
  }

  // Adapt legend text color
  if (next.legend && typeof next.legend === 'object') {
    next.legend = {
      ...next.legend,
      font: {
        color: isDark ? '#cbd5e1' : '#334155',
        ...(next.legend.font || {}),
      },
    };
  }

  // Adapt annotations (light callout boxes / dark text -> dark-safe)
  if (Array.isArray(next.annotations)) {
    next.annotations = next.annotations.map((ann: any) => {
      if (!ann || typeof ann !== 'object') return ann;
      const cloned = { ...ann };
      if (isDark) {
        if (
          typeof cloned.bgcolor === 'string' &&
          cloned.bgcolor.toLowerCase().includes('255,255,255')
        ) {
          cloned.bgcolor = 'rgba(15,23,42,0.88)';
        }
        if (cloned.font && typeof cloned.font === 'object') {
          const fc = String(cloned.font.color || '').toLowerCase();
          if (DARK_TEXTS.has(fc)) {
            cloned.font = { ...cloned.font, color: '#e2e8f0' };
          } else if (fc === '#64748b') {
            cloned.font = { ...cloned.font, color: '#94a3b8' };
          }
        }
      }
      return cloned;
    });
  }

  // Adapt default hoverlabel unless caller intentionally hid it with transparent bgcolor
  const isHiddenHover =
    next.hoverlabel?.bgcolor === 'rgba(0,0,0,0)' || next.hoverlabel?.bgcolor === 'transparent';
  if (!isHiddenHover) {
    next.hoverlabel = {
      bgcolor: isDark ? '#1e293b' : '#0f172a',
      bordercolor: isDark ? '#334155' : '#0f172a',
      font: {
        color: '#f8fafc',
        family: '"Plus Jakarta Sans", -apple-system, sans-serif',
        size: 12,
      },
      ...(next.hoverlabel || {}),
    };
  }

  return next;
}

export const PlotlyChart: React.FC<PlotlyChartProps> = ({
  data,
  layout,
  config,
  className = '',
  height = 450,
  onHover,
  onUnhover,
}) => {
  const { isDark } = useTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onHoverRef = useRef(onHover);
  const onUnhoverRef = useRef(onUnhover);
  const listenersBoundRef = useRef(false);

  onHoverRef.current = onHover;
  onUnhoverRef.current = onUnhover;

  useEffect(() => {
    const el = containerRef.current as any;
    if (!el) return;

    const mergedConfig = {
      responsive: true,
      displaylogo: false,
      modeBarButtonsToRemove: ['lasso2d', 'select2d'],
      ...config,
    };

    const mergedLayout = adaptLayoutForTheme(layout, height, isDark);
    Plotly.react(el, data, mergedLayout, mergedConfig);

    if (!listenersBoundRef.current && typeof el.on === 'function') {
      el.on('plotly_hover', (ev: any) => onHoverRef.current?.(ev));
      el.on('plotly_unhover', () => onUnhoverRef.current?.());
      listenersBoundRef.current = true;
    }
  }, [data, layout, config, height, isDark]);

  useEffect(() => {
    const el = containerRef.current;
    return () => {
      if (el) {
        try {
          Plotly.purge(el);
        } catch {
          // ignore
        }
      }
    };
  }, []);

  return <div ref={containerRef} className={`w-full ${className}`} style={{ height }} />;
};
