import * as React from 'react';
import { cn } from '@/lib/cn';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  rounded?: 'sm' | 'md' | 'lg' | 'full';
}

export function Skeleton({ rounded = 'md', className, ...rest }: SkeletonProps) {
  const r = {
    sm: 'rounded-sm',
    md: 'rounded-md',
    lg: 'rounded-lg',
    full: 'rounded-full',
  }[rounded];
  return (
    <div
      aria-hidden
      className={cn('skeleton-shimmer', r, 'h-4 w-full', className)}
      {...rest}
    />
  );
}

export default Skeleton;
