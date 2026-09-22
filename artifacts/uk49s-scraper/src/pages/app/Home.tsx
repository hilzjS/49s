import { Link } from 'wouter';
import {
  ArrowRight,
  BarChart3,
  CalendarClock,
  Moon,
  Sparkles,
  Sun,
  Target,
  TrendingUp,
} from 'lucide-react';
import { api, type DrawType, type Prediction } from '@/lib/api';
import { useAsync, formatDate, formatDateTime, greeting, type AsyncState } from '@/lib/useAsync';
import { useAuth } from '@/lib/auth';
import {
  Badge,
  Balls,
  Button,
  Card,
  EmptyState,
  ErrorState,
  PanelHeader,
  Spinner,
  StatCard,
  percent,
} from '@/components/ui';

interface PredictionResponse {
  success: boolean;
  prediction: Prediction;
}

function SessionPanel({
  drawType,
  icon,
  state,
}: {
  drawType: DrawType;
  icon: React.ReactNode;
  state: AsyncState<PredictionResponse>;
}) {
  const label = drawType === 'lunchtime' ? 'Lunchtime' : 'Teatime';
  const time = drawType === 'lunchtime' ? '13:00' : '18:45';

  if (state.loading) {
    return (
      <Card>
        <Spinner label={`Loading ${label} prediction…`} />
      </Card>
    );
  }

  if (state.error && state.status !== 404) {
    return (
      <Card>
        <ErrorState message={state.error} onRetry={state.reload} />
      </Card>
    );
  }

  const prediction = state.data?.prediction;
  if (!prediction) {
    return (
      <Card>
        <EmptyState
          icon={<Target size={20} />}
          title={`No ${label} prediction yet`}
          description="Nothing has been generated for this session yet."
        />
      </Card>
    );
  }

  const pending = prediction.status === 'pending' || prediction.status === 'generated';

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--surface-3)] text-[var(--gold)]">
            {icon}
          </span>
          <div>
            <p className="text-[14px] font-semibold text-[var(--text)]">{label}</p>
            <p className="text-[11.5px] text-[var(--text-3)]">
              {formatDate(prediction.predictionDate)} · {time}
            </p>
          </div>
        </div>
        <Badge tone={pending ? 'neutral' : 'mint'}>
          {pending ? 'Pending draw' : `${prediction.mainHits ?? 0} hits`}
        </Badge>
      </div>

      <div className="px-5 py-5">
        <p className="eyebrow">Main numbers</p>
        <div className="mt-3">
          <Balls main={prediction.predictedMain} booster={prediction.predictedBooster} size="lg" />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11.5px] text-[var(--text-3)]">
          <span>
            Model <span className="mono text-[var(--text-2)]">{prediction.modelVersion ?? '—'}</span>
          </span>
          <span>
            Generated <span className="text-[var(--text-2)]">{formatDateTime(prediction.createdAt)}</span>
          </span>
        </div>
      </div>
    </Card>
  );
}

function ResultRow({
  drawType,
  label,
  state,
  index,
}: {
  drawType: DrawType;
  label: string;
  state: AsyncState<{ success: boolean; draws: { drawDate: string; mainNumbers: number[]; boosterBall: number }[] }>;
  index: number;
}) {
  const draw = state.data?.draws?.[index];
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="text-[12.5px] font-medium text-[var(--text)]">{label}</p>
        <p className="text-[11.5px] text-[var(--text-3)]">{formatDate(draw?.drawDate)}</p>
      </div>
      {draw ? (
        <Balls main={draw.mainNumbers} booster={draw.boosterBall} size="sm" />
      ) : (
        <span className="text-[12px] text-[var(--text-3)]">
          {state.loading ? 'Loading…' : 'No data'}
        </span>
      )}
    </div>
  );
}

export default function Home() {
  const { profile } = useAuth();
  const lunch = useAsync(() => api.getLatestPrediction('lunchtime'), []);
  const tea = useAsync(() => api.getLatestPrediction('teatime'), []);
  const lunchDraws = useAsync(() => api.getLatestDraws('lunchtime', 4), []);
  const teaDraws = useAsync(() => api.getLatestDraws('teatime', 4), []);
  const backtest = useAsync(() => api.getBacktestLatest('lunchtime'), []);
  const history = useAsync(() => api.getPredictionHistory('lunchtime', 5), []);

  const bt = backtest.data?.backtest;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Today’s predictions</p>
          <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.02em]">
            {greeting()}
            {profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}
          </h1>
          <p className="mt-1 text-[13px] text-[var(--text-3)]">
            {new Date().toLocaleDateString('en-GB', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </p>
        </div>
        <Link href="/app/predictions">
          <Button variant="secondary">
            Full predictions <ArrowRight size={15} />
          </Button>
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SessionPanel drawType="lunchtime" icon={<Sun size={17} />} state={lunch} />
        <SessionPanel drawType="teatime" icon={<Moon size={17} />} state={tea} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <PanelHeader
            title="Latest results"
            subtitle="Most recent validated draws"
            right={<CalendarClock size={16} className="text-[var(--text-3)]" />}
          />
          <div className="divide-y divide-[var(--line)] px-5">
            <ResultRow drawType="lunchtime" label="Lunchtime" state={lunchDraws} index={0} />
            <ResultRow drawType="teatime" label="Teatime" state={teaDraws} index={0} />
          </div>
          <div className="border-t border-[var(--line)] px-5 py-3">
            <Link href="/app/results" className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--gold)]">
              Browse all results <ArrowRight size={13} />
            </Link>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <PanelHeader
            title="Previous results"
            subtitle="Recent draws across both sessions"
            right={<CalendarClock size={16} className="text-[var(--text-3)]" />}
          />
          <div className="divide-y divide-[var(--line)] px-5">
            <ResultRow drawType="lunchtime" label="Lunchtime" state={lunchDraws} index={1} />
            <ResultRow drawType="teatime" label="Teatime" state={teaDraws} index={1} />
            <ResultRow drawType="lunchtime" label="Lunchtime" state={lunchDraws} index={2} />
            <ResultRow drawType="teatime" label="Teatime" state={teaDraws} index={2} />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <StatCard
          label="Avg main hits"
          value={bt ? bt.superhybrid.avgMainHits.toFixed(2) : '—'}
          hint={bt ? `${bt.totalPredictions} backtested draws` : 'No backtest yet'}
          icon={<TrendingUp size={17} />}
          tone="mint"
        />
        <StatCard
          label="4-hit rate"
          value={bt ? percent(bt.superhybrid.fourHitRate) : '—'}
          hint={bt ? `${bt.superhybrid.fourHitCount} exact matches` : 'No backtest yet'}
          icon={<Target size={17} />}
          tone="gold"
        />
        <StatCard
          label="Booster hit rate"
          value={bt ? percent(bt.superhybrid.boosterHitRate) : '—'}
          hint="Out-of-sample backtest"
          icon={<Sparkles size={17} />}
          tone="sky"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <PanelHeader
            title="Prediction history"
            subtitle="Most recent Lunchtime predictions"
            right={
              <Link href="/app/history" className="text-[12.5px] font-medium text-[var(--gold)]">
                View all
              </Link>
            }
          />
          {history.loading ? (
            <Spinner />
          ) : history.error || !history.data?.predictions?.length ? (
            <EmptyState title="No prediction history yet" description="History appears as predictions are generated." />
          ) : (
            <div className="divide-y divide-[var(--line)]">
              {history.data.predictions.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div>
                    <p className="text-[12.5px] font-medium text-[var(--text)]">{formatDate(p.predictionDate)}</p>
                    <p className="text-[11px] text-[var(--text-3)]">{p.modelVersion ?? 'Model'}</p>
                  </div>
                  <Balls main={p.predictedMain} booster={p.predictedBooster} size="sm" />
                  <Badge tone={p.mainHits == null ? 'neutral' : p.mainHits >= 2 ? 'mint' : 'neutral'}>
                    {p.mainHits == null ? 'Pending' : `${p.mainHits} hits`}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <PanelHeader title="Your plan" subtitle="Subscription status" right={<BarChart3 size={16} className="text-[var(--text-3)]" />} />
          <div className="px-5 py-5">
            <p className="display text-[24px] font-semibold capitalize">{profile?.plan_id ?? 'free'}</p>
            <p className="mt-1 text-[12.5px] text-[var(--text-3)]">
              {(profile?.plan_id ?? 'free') === 'free'
                ? 'Free plan · basic features'
                : 'Active subscription'}
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <Link href="/app/subscription">
                <Button variant="secondary" block>
                  Manage subscription
                </Button>
              </Link>
              <Link href="/app/plans">
                <Button block>Upgrade plan</Button>
              </Link>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}