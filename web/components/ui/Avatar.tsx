'use client';
import * as React from 'react';
import { cn } from '@/lib/cn';

export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  src?: string | null;
  alt?: string;
  name?: string | null;
  size?: number;
}

const initialsOf = (name?: string | null) => {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join('') || '?';
};

const colorFor = (str: string) => {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return `hsl(${h} 65% 55%)`;
};

export function Avatar({
  src,
  alt,
  name,
  size = 32,
  className,
  ...rest
}: AvatarProps) {
  const [errored, setErrored] = React.useState(false);
  const showImg = src && !errored;
  const initials = initialsOf(name);
  const bg = colorFor(name ?? alt ?? 'x');

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full overflow-hidden select-none',
        'text-white font-medium shrink-0',
        className
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
        background: showImg ? undefined : bg,
      }}
      aria-label={alt ?? name ?? 'avatar'}
      {...rest}
    >
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src!}
          alt={alt ?? name ?? ''}
          width={size}
          height={size}
          onError={() => setErrored(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <span aria-hidden>{initials}</span>
      )}
    </span>
  );
}

export default Avatar;
