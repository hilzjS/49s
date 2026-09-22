import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('card', className)}>{children}</div>;
}

export function PanelHeader({
  title,
  subtitle,
  right,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="panel-head">
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold text-[var(--text)]">{title}</h3>
        {subtitle ? <p className="mt-1 text-[12.5px] text-[var(--text-3)]">{subtitle}</p> : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  block?: boolean;
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  block = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cn(
        'btn',
        variant === 'primary' && 'btn-primary',
        variant === 'secondary' && 'btn-secondary',
        variant === 'ghost' && 'btn-ghost',
        size === 'lg' && 'btn-lg',
        block && 'btn-block',
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 size={15} className="spin" /> : null}
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block">
      {label ? <span className="label">{label}</span> : null}
      {children}
      {hint ? <span className="mt-1 block text-[11.5px] text-[var(--text-3)]">{hint}</span> : null}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn('input', props.className)} {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn('select', props.className)} {...props} />;
}

type BadgeTone = 'neutral' | 'gold' | 'mint' | 'sky' | 'coral' | 'violet';

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={cn('badge', tone !== 'neutral' && `badge-${tone}`)}>{children}</span>;
}

export function Ball({
  number,
  booster = false,
  size = 'md',
}: {
  number: number;
  booster?: boolean;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <span
      className={cn(
        'ball',
        booster && 'ball-booster',
        size === 'sm' && 'ball-sm',
        size === 'lg' && 'ball-lg',
      )}
    >
      {String(number).padStart(2, '0')}
    </span>
  );
}

export function Balls({
  main,
  booster,
  size = 'md',
}: {
  main: number[];
  booster?: number | null;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {main.map((n) => (
        <Ball key={n} number={n} size={size} />
      ))}
      {booster != null ? (
        <>
          <span className="mx-1 h-6 w-px bg-[var(--line-2)]" aria-hidden />
          <Ball number={booster} booster size={size} />
        </>
      ) : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'gold',
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: 'gold' | 'mint' | 'sky' | 'coral' | 'violet';
}) {
  const tones: Record<string, string> = {
    gold: 'text-[var(--gold)]',
    mint: 'text-[var(--mint)]',
    sky: 'text-[var(--sky)]',
    coral: 'text-[var(--coral)]',
    violet: 'text-[var(--violet)]',
  };
  return (
    <div className="card card-hover p-5">
      <div className="flex items-start justify-between">
        <span className="eyebrow">{label}</span>
        {icon ? <span className={tones[tone]}>{icon}</span> : null}
      </div>
      <div className="stat-value mt-3">{value}</div>
      {hint ? <div className="mt-1 text-[12px] text-[var(--text-3)]">{hint}</div> : null}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-14 text-[var(--text-3)]">
      <Loader2 size={20} className="spin" />
      <span className="text-[13px]">{label ?? 'Loading…'}</span>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {icon ? <div className="text-[var(--text-3)]">{icon}</div> : null}
      <div>
        <p className="text-[14px] font-semibold text-[var(--text)]">{title}</p>
        {description ? (
          <p className="mx-auto mt-1 max-w-sm text-[12.5px] text-[var(--text-3)]">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card flex flex-col items-center gap-3 p-8 text-center">
      <AlertTriangle size={22} className="text-[var(--coral)]" />
      <p className="text-[13px] text-[var(--text-2)]">{message}</p>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
}: {
  items: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          className={cn('tab', value === item.value && 'active')}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function SectionHeading({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-[17px] font-semibold text-[var(--text)]">{title}</h2>
        {subtitle ? <p className="mt-1 text-[12.5px] text-[var(--text-3)]">{subtitle}</p> : null}
      </div>
      {right}
    </div>
  );
}

export function ProgressBar({
  value,
  tone = 'gold',
}: {
  value: number;
  tone?: 'gold' | 'mint' | 'sky' | 'violet';
}) {
  const colors: Record<string, string> = {
    gold: 'var(--gold)',
    mint: 'var(--mint)',
    sky: 'var(--sky)',
    violet: 'var(--violet)',
  };
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-3)]">
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: colors[tone] }}
      />
    </div>
  );
}

export function percent(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

export function num(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toFixed(digits);
}