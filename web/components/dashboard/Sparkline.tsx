'use client';
import { cn } from '@/lib/cn';

export interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  strokeWidth?: number;
  className?: string;
  ariaLabel?: string;
  /** Tailwind-friendly stroke color (uses currentColor by default) */
  color?: string;
  /** Show a soft area gradient under the line */
  fill?: boolean;
}

/**
 * Tiny inline SVG sparkline. No external libs.
 * Renders a smooth-ish polyline using values normalized to the box.
 * If all values are equal, draws a flat midline.
 */
export default function Sparkline({
  values,
  width = 96,
  height = 28,
  strokeWidth = 1.5,
  className,
  ariaLabel = 'מגמה',
  color,
  fill = true,
}: SparklineProps) {
  const safe = values && values.length > 0 ? values : [0, 0];
  const min = Math.min(...safe);
  const max = Math.max(...safe);
  const range = max - min || 1;

  // Padding so stroke isn't clipped
  const pad = strokeWidth + 1;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const step = safe.length > 1 ? innerW / (safe.length - 1) : 0;

  const points = safe.map((v, i) => {
    const x = pad + i * step;
    const y = pad + innerH - ((v - min) / range) * innerH;
    return [x, y] as const;
  });

  const path = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const areaPath =
    points.length > 0
      ? `${path} L${(pad + innerW).toFixed(2)},${(pad + innerH).toFixed(2)} L${pad.toFixed(2)},${(pad + innerH).toFixed(2)} Z`
      : '';

  const gradId = `spark-grad-${Math.random().toString(36).slice(2, 8)}`;

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('overflow-visible', className)}
      style={color ? { color } : undefined}
    >
      {fill && (
        <>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.25" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#${gradId})`} stroke="none" />
        </>
      )}
      <path d={path} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
