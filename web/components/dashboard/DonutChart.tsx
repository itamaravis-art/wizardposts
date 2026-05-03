'use client';
import { cn } from '@/lib/cn';

export interface DonutChartProps {
  success: number;
  failed: number;
  size?: number;
  thickness?: number;
  className?: string;
  showLabel?: boolean;
}

/**
 * Small SVG donut showing success / fail ratio.
 * Center label shows success rate %.
 */
export default function DonutChart({
  success,
  failed,
  size = 96,
  thickness = 10,
  className,
  showLabel = true,
}: DonutChartProps) {
  const total = success + failed;
  const rate = total > 0 ? success / total : 0;
  const pct = Math.round(rate * 100);

  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const successLen = c * rate;
  const failLen = c - successLen;

  return (
    <div className={cn('relative inline-flex items-center justify-center', className)} style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`שיעור הצלחה: ${pct}%`}
        className="-rotate-90"
      >
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.12}
          strokeWidth={thickness}
        />
        {/* Failed arc (red) */}
        {total > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="rgb(239 68 68)"
            strokeWidth={thickness}
            strokeDasharray={`${failLen} ${c}`}
            strokeDashoffset={-successLen}
            strokeLinecap="butt"
          />
        )}
        {/* Success arc (emerald) */}
        {total > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="rgb(16 185 129)"
            strokeWidth={thickness}
            strokeDasharray={`${successLen} ${c}`}
            strokeLinecap="butt"
          />
        )}
      </svg>
      {showLabel && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
          <div className="text-lg font-bold tabular-nums leading-none">{pct}%</div>
          <div className="text-[10px] text-slate-500 mt-0.5">הצלחה</div>
        </div>
      )}
    </div>
  );
}
