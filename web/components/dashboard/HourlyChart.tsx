'use client';
import { cn } from '@/lib/cn';
import { Tooltip } from '@/components/ui/Tooltip';

export interface HourBucket {
  /** Hour of day, 0..23 */
  hour: number;
  posted: number;
  failed: number;
}

export interface HourlyChartProps {
  buckets: HourBucket[];
  className?: string;
  height?: number;
}

/**
 * Stacked bar chart of posts per hour over the last 24h.
 * Each bar = posted (green, bottom) + failed (red, top).
 * Pure SVG. No external dep.
 */
export default function HourlyChart({ buckets, className, height = 120 }: HourlyChartProps) {
  // Normalize to 24 buckets if fewer/more passed
  const data: HourBucket[] = buckets && buckets.length === 24
    ? buckets
    : Array.from({ length: 24 }, (_, h) => {
        const found = buckets?.find((b) => b.hour === h);
        return found ?? { hour: h, posted: 0, failed: 0 };
      });

  const max = Math.max(1, ...data.map((b) => b.posted + b.failed));
  const totalPosted = data.reduce((acc, b) => acc + b.posted, 0);
  const totalFailed = data.reduce((acc, b) => acc + b.failed, 0);

  const barGap = 2;

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-end gap-1 w-full" style={{ height }} role="img" aria-label="פוסטים ב-24 השעות האחרונות">
        {data.map((b) => {
          const total = b.posted + b.failed;
          const totalPctH = (total / max) * height;
          const postedH = total > 0 ? (b.posted / total) * totalPctH : 0;
          const failedH = total > 0 ? (b.failed / total) * totalPctH : 0;
          const label = `${b.hour.toString().padStart(2, '0')}:00 — ${b.posted} הצלחות, ${b.failed} כשלים`;
          return (
            <Tooltip key={b.hour} content={label}>
              <div
                className="flex-1 flex flex-col justify-end rounded-t-sm overflow-hidden bg-slate-100 hover:bg-slate-200 transition-colors min-w-0"
                style={{ height, marginInlineStart: barGap, marginInlineEnd: barGap }}
                aria-label={label}
              >
                {failedH > 0 && (
                  <div
                    className="bg-red-400 transition-all duration-300"
                    style={{ height: `${failedH}px` }}
                  />
                )}
                {postedH > 0 && (
                  <div
                    className="bg-emerald-500 transition-all duration-300"
                    style={{ height: `${postedH}px` }}
                  />
                )}
              </div>
            </Tooltip>
          );
        })}
      </div>
      <div className="flex items-center justify-between text-[11px] text-slate-500">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
      <div className="flex items-center gap-4 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
          פורסם <span className="tabular-nums font-semibold">{totalPosted}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-red-400" />
          נכשל <span className="tabular-nums font-semibold">{totalFailed}</span>
        </span>
      </div>
    </div>
  );
}
