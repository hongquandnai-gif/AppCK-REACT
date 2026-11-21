import React, { useEffect, useRef } from 'react';
import Plotly from 'plotly.js-dist-min';

interface PlotlyChartProps {
  data: any[];
  layout: Record<string, any>;
  config?: Record<string, any>;
  className?: string;
  height?: number;
  onHover?: (ev: any) => void;
  onUnhover?: () => void;
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onHoverRef = useRef(onHover);
  const onUnhoverRef = useRef(onUnhover);

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

    const mergedLayout = {
      paper_bgcolor: '#ffffff',
      plot_bgcolor: '#ffffff',
      font: { family: 'Segoe UI, Arial, sans-serif', size: 12, color: '#1e293b' },
      height,
      ...layout,
    };

    Plotly.react(el, data, mergedLayout, mergedConfig);

    const handleHover = (ev: any) => onHoverRef.current?.(ev);
    const handleUnhover = () => onUnhoverRef.current?.();

    if (typeof el.removeAllListeners === 'function') {
      el.removeAllListeners('plotly_hover');
      el.removeAllListeners('plotly_unhover');
    }
    if (onHoverRef.current && typeof el.on === 'function') {
      el.on('plotly_hover', handleHover);
    }
    if (onUnhoverRef.current && typeof el.on === 'function') {
      el.on('plotly_unhover', handleUnhover);
    }
  }, [data, layout, config, height]);

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
