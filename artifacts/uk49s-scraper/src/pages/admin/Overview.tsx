import { Link } from 'wouter';
import {
  Activity,
  Database,
  Download,
  Receipt,
  Target,
  TrendingUp,
  Users,
} from 'lucide-react';
import { api } from '@/lib/api';
import { supabase } from '@/integrations/supabase/client';
import { useAsync, formatDateTime } from '@/lib/useAsync';
import { Badge, Card, PanelHeader, Spinner, StatCard } from '@/components/ui';
import { formatPrice } from '@/lib/plans';

interface Counts {
  users: number;
  activeSubs: number;
  revenueCents: number;
  payments: number;
}

export default function AdminOverview() {
  const health = useAsync(() => api.getScraperHealth(), []);
  const summary = useAsync(() => api.getDataSummary(), []);
  const predictions = useAsync(async () => {
    const [lunch, tea] = await Promise.all([
      api.getPredictionHistory('lunchtime', 200),
      api.getPredictionHistory('teatime', 200),
    ]);
    return lunch.count + tea.count;
  }, []);
  const counts = useAsync(async (): Promise<Counts> => {
    const [users, subs, payments] = await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
      supabase.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('payments').select('amount_cents, status'),
    ]);
    const rows = (payments.data as { amount_cents: number; status: string }[] | null) ?? [];
    const succeeded = rows.filter((row) => row.status === 'succeeded');
    return {
      users: users.count ?? 0,
      activeSubs: subs.count ?? 0,
      revenueCents: succeeded.reduce((sum, row) => sum + (row.amount_cents ?? 0), 0),
      payments: rows.length,
    };
  }, []);

  const data = summary.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Administration</p>
          <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.02em]">Overview</h1>
        </div>
        <Badge tone={health.data?.status === 'ok' ? 'mint' : 'neutral'}>
          <Activity size={12} /> Scraper {health.data?.status ?? 'unknown'}
        </Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Users"
          value={counts.loading ? '—' : counts.data?.users ?? 0}
          hint="Registered accounts"
          icon={<Users size={17} />}
          tone="sky"
        />
        <StatCard
          label="Active subscriptions"
          value={counts.loading ? '—' : counts.data?.activeSubs ?? 0}
          hint={`${counts.data?.payments ?? 0} payments recorded`}
          icon={<Receipt size={17} />}
          tone="violet"
        />
        <StatCard
          label="Revenue"
          value={counts.loading ? '—' : formatPrice(counts.data?.revenueCents ?? 0, 'GBP')}
          hint="Successful payments"
          icon={<TrendingUp size={17} />}
          tone="mint"
        />
        <StatCard
          label="Predictions generated"
          value={predictions.loading ? '—' : predictions.data ?? 0}
          hint="Across both sessions"
          icon={<Target size={17} />}
          tone="gold"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <PanelHeader
            title="Scraper status"
            subtitle="Live health of the scraper service"
            right={<Download size={16} className="text-[var(--text-3)]" />}
          />
          <div className="p-5">
            {health.loading ? (
              <Spinner />
            ) : health.error ? (
              <p className="text-[13px] text-[var(--coral)]">{health.error}</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="eyebrow">Service</p>
                  <p className="mt-1.5 text-[13px] text-[var(--text)]">{health.data?.service ?? '—'}</p>
                </div>
                <div>
                  <p className="eyebrow">Cache entries</p>
                  <p className="mono mt-1.5 text-[13px] text-[var(--text)]">{health.data?.cacheEntries ?? 0}</p>
                </div>
                <div className="sm:col-span-2">
                  <p className="eyebrow">Last scrape</p>
                  <p className="mt-1.5 text-[13px] text-[var(--text)]">
                    {formatDateTime(health.data?.lastScrapeAt)}
                  </p>
                </div>
              </div>
            )}
            <Link href="/admin/scraper" className="mt-4 inline-block text-[12.5px] font-medium text-[var(--gold)]">
              Open scraper controls →
            </Link>
          </div>
        </Card>

        <Card>
          <PanelHeader
            title="Database status"
            subtitle="Validated draw coverage"
            right={<Database size={16} className="text-[var(--text-3)]" />}
          />
          <div className="p-5">
            {summary.loading ? (
              <Spinner />
            ) : summary.error ? (
              <p className="text-[13px] text-[var(--coral)]">{summary.error}</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="eyebrow">Lunchtime draws</p>
                  <p className="stat-value-sm mt-1">{data?.totalLunchDraws ?? 0}</p>
                  <p className="mt-1 text-[11.5px] text-[var(--text-3)]">
                    Latest {data?.lunchtime.latestDate ?? '—'}
                  </p>
                </div>
                <div>
                  <p className="eyebrow">Teatime draws</p>
                  <p className="stat-value-sm mt-1">{data?.totalTeaDraws ?? 0}</p>
                  <p className="mt-1 text-[11.5px] text-[var(--text-3)]">
                    Latest {data?.teatime.latestDate ?? '—'}
                  </p>
                </div>
                <div>
                  <p className="eyebrow">Duplicates removed</p>
                  <p className="mono mt-1.5 text-[13px] text-[var(--text)]">
                    {(data?.lunchtime.duplicateCount ?? 0) + (data?.teatime.duplicateCount ?? 0)}
                  </p>
                </div>
                <div>
                  <p className="eyebrow">Validation errors</p>
                  <p className="mono mt-1.5 text-[13px] text-[var(--text)]">
                    {(data?.lunchtime.validationErrors ?? 0) + (data?.teatime.validationErrors ?? 0)}
                  </p>
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}