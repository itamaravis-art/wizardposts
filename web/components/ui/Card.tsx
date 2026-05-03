import * as React from 'react';
import { cn } from '@/lib/cn';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  hoverLift?: boolean;
  padded?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, hoverLift = false, padded = false, ...rest },
  ref
) {
  return (
    <div
      ref={ref}
      className={cn(
        'bg-white border border-slate-200 rounded-xl shadow-card',
        'dark:bg-surface dark:border-border',
        'transition-shadow duration-200',
        hoverLift && 'hover:shadow-elevated hover:-translate-y-0.5',
        padded && 'p-5',
        className
      )}
      {...rest}
    />
  );
});

export const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(function CardHeader({ className, ...rest }, ref) {
  return (
    <div
      ref={ref}
      className={cn(
        'flex flex-col gap-1 p-5 pb-3 border-b border-slate-100 dark:border-border',
        className
      )}
      {...rest}
    />
  );
});

export const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(function CardTitle({ className, ...rest }, ref) {
  return (
    <h3
      ref={ref}
      className={cn('text-base font-semibold text-slate-900 dark:text-foreground', className)}
      {...rest}
    />
  );
});

export const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(function CardDescription({ className, ...rest }, ref) {
  return (
    <p
      ref={ref}
      className={cn('text-sm text-slate-500 dark:text-muted-foreground', className)}
      {...rest}
    />
  );
});

export const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(function CardContent({ className, ...rest }, ref) {
  return <div ref={ref} className={cn('p-5', className)} {...rest} />;
});

export const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(function CardFooter({ className, ...rest }, ref) {
  return (
    <div
      ref={ref}
      className={cn(
        'flex items-center gap-3 px-5 py-3 border-t border-slate-100 dark:border-border',
        className
      )}
      {...rest}
    />
  );
});

export default Card;
