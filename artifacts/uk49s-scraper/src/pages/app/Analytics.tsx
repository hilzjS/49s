import { useMemo, useState } from 'react';
import { BarChart3, Flame, Snowflake, Sparkles, TrendingUp } from 'lucide-react';
import { api, type DrawType } from '@/lib/api';
import { useAsync, formatDate } from '@/lib/useAsync';
import { BarFrequencyChart, CHART_COLORS, DonutChart, TrendAreaChart } from '@/components/charts';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  PanelHeader,
  ProgressBar,
  Spinner,
  StatCard,
  Tabs,
  percent,
} from '@/components/ui';

interface DrawRow {
  drawType: DrawType;
  drawDate: string;
  mainNumbers: number[];
  boosterBall: number;
}

function countFrequencies(rows: DrawRow[]) {
  const main = new Array(50).fill(0) as number[];
  const booster = new Array(50).fill(0) as number[];
  for (const row of rows) {
    for (const n of row.mainNumbers) if (n >= 1 && n <= 49) main[n] += 1;
    if (row.boosterBall >= 1 && row.boosterBall <= 49) booster[row.boosterBall] += 1;
  }
  return { main, booster };
}

export default function Analytics() {
  const [drawType, setDrawType] = useState<DrawType>('lunchtime');

  const draws = useAsync(async () => {
    const [lunch, tea] = await Promise.all([
      api.getLatestDraws('lunchtime', 400),
      api.getLatestDraws('teatime', 400),
    ]);
    const rows: DrawRow[] = [
      ...lunch.draws.map((d) => ({ drawType: 'lunchtime' as DrawType, drawDate: d.drawDate, mainNumbers: d.mainNumbers, boosterBall: d.boosterBall })),
      ...tea.draws.map((d) => ({ drawType: 'teatime' as DrawType, drawDate: d.drawDate, mainNumbers: d.mainNumbers, boosterBall: d.boosterBall })),
    ];
    rows.sort((a, b) => b.drawDate.localeCompare(a.drawDate));
    return rows;
  }, []);

  const model = useAsync(() => api.getActiveModel(drawType), [drawType]);
  const backtest = useAsync(() => api.getBacktestLatest(drawType), [drawType]);
  const history = useAsync(() => api.getPredictionHistory(drawType, 60), [drawType]);

  const rows = useMemo(
    () => (draws.data ?? []).filter((row) => row.drawType === drawType),
    [draws.data, drawType],
  );

  const overall = useMemo(() => countFrequencies(rows), [rows]);
  const recent = useMemo(() => countFrequencies(rows.slice(0, 30)), [rows]);

  const numberData = useMemo(
    () =>
      Array.from({ length: 49 }, (_, i) => ({
        label: String(i + 1).padStart(2, '0'),
        value: overall.main[i + 1],
      })),
    [overall],
  );
  const recentData = useMemo(
    () =>
      Array.from({ length: 49 }, (_, i) => ({
        label: String(i + 1).padStart(2, '0'),
        value: recent.main[i + 1],
      })),
    [recent],
  );

  const ranked = useMemo(
    () =>
      Array.from({ length: 49 }, (_, i) => ({ number: i + 1, count: overall.main[i + 1] })).sort(
        (a, b) => b.count - a.count,
      ),
    [overall],
  );
  const hottest = ranked[0];
  const coldest = ranked[ranked.length - 1];
  const hotRecent = useMemo(() => {
    const list = Array.from({ length: 49 }, (_, i) => ({ number: i + 1, count: recent.main[i + 1] }));
    list.sort((a, b) => b.count - a.count);
    return list[0];
  }, [recent]);

  const boosterDonut = useMemo(() => {
    const list = Array.from({ length: 49 }, (_, i) => ({ number: i + 1, count: overall.booster[i + 1] }));
    list.sort((a, b) => b.count - a.count);
    const palette = [CHART_COLORS.gold, CHART_COLORS.sky, CHART_COLORS.mint, CHART_COLORS.violet, CHART_COLORS.coral, '#5c6b85'];
    return list.slice(0, 6).map((item, index) => ({
      name: `#${String(item.number).padStart(2, '0')}`,
      value: item.count,
      color: palette[index],
    }));
  }, [overall]);

  const performance = useMemo(() => {
    const resolved = (history.data?.predictions ?? [])
      .filter((p) => p.mainHits != null)
      .slice()
      .reverse();
    return resolved.map((p) => ({
      label: p.predictionDate.slice(5),
      value: p.mainHits ?? 0,
    }));
  }, [history.data]);

  const resolvedCount = (history.data?.predictions ?? []).filter((p) => p.mainHits != null).length;
  const avgHits =
    resolvedCount > 0
      ? (history.data?.predictions ?? [])
          .filter((p) => p.mainHits != null)
          .reduce((sum, p) => sum + (p.mainHits ?? 0), 0) / resolvedCount
      : null;

  const topWeights = model.data?.model
    ? Object.entries(model.data.model.weights)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
    : [];
  const maxWeight = topWeights.length ? Math.max(...topWeights.map(([, v]) => v)) : 1;
  const bt = backtest.data?.backtest;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Insight</p>
          <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.02em]">Analytics</h1>
          <p className="mt-1 text-[13px] text-[var(--text-3)]">
            Number behaviour and model performance for the selected session.
          </p>
        </div>
        <Tabs
          items={[
            { value: 'lunchtime', label: 'Lunchtime' },
            { value: 'teatime', label: 'Teatime' },
          ]}
          value={drawType}
          onChange={(value) => setDrawType(value as DrawType)}
        />
      </div>

      {draws.loading ? (
        <Card>
          <Spinner label="Analysing draws…" />
        </Card>
      ) : draws.error ? (
        <ErrorState message={draws.error} onRetry={draws.reload} />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<BarChart3 size={20} />}
            title="No draw data for this session"
            description="Ingest historical results to unlock frequency, pattern and model analytics."
          />
        </Card>
      ) : (
        <>
          {backtest.data?.statsSince ?? history.data?.statsSince ? (
            <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 text-[12px] text-[var(--text-2)]">
              Performance statistics count only predictions and backtests from the current model, applied{' '}
              {formatDate(backtest.data?.statsSince ?? history.data?.statsSince)}. Earlier figures are kept but no
              longer counted.
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Hottest (all-time)"
              value={hottest ? `#${String(hottest.number).padStart(2, '0')}` : '—'}
              hint={hottest ? `${hottest.count} appearances` : ''}
              icon={<Flame size={17} />}
              tone="coral"
            />
            <StatCard
              label="Coldest (all-time)"
              value={coldest ? `#${String(coldest.number).padStart(2, '0')}` : '—'}
              hint={coldest ? `${coldest.count} appearances` : ''}
              icon={<Snowflake size={17} />}
              tone="sky"
            />
            <StatCard
              label="Hottest (last 30)"
              value={hotRecent ? `#${String(hotRecent.number).padStart(2, '0')}` : '—'}
              hint={hotRecent ? `${hotRecent.count} in 30 draws` : ''}
              icon={<TrendingUp size={17} />}
              tone="mint"
            />
            <StatCard
              label="Avg main hits"
              value={avgHits != null ? avgHits.toFixed(2) : '—'}
              hint={`${resolvedCount} resolved predictions`}
              icon={<Sparkles size={17} />}
              tone="gold"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <PanelHeader
                title="Number frequency"
                subtitle={`Main numbers · ${rows.length} ${drawType} draws`}
                right={<Badge tone="gold">All-time</Badge>}
              />
              <div className="p-4">
                <BarFrequencyChart data={numberData} />
              </div>
            </Card>

            <Card>
              <PanelHeader title="Booster frequency" subtitle="Top 6 boosters" />
              <div className="p-4">
                <DonutChart data={boosterDonut} />
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {boosterDonut.map((item) => (
                    <div key={item.name} className="flex items-center gap-2 text-[12px] text-[var(--text-2)]">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: item.color }} />
                      <span className="mono">{item.name}</span>
                      <span className="mono ml-auto text-[var(--text-3)]">{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <PanelHeader title="Recent frequency" subtitle="Last 30 draws" />
              <div className="p-4">
                <BarFrequencyChart data={recentData} color={CHART_COLORS.sky} />
              </div>
            </Card>

            <Card>
              <PanelHeader
                title="Prediction performance"
                subtitle="Main hits per resolved prediction"
              />
              <div className="p-4">
                {performance.length === 0 ? (
                  <EmptyState title="No resolved predictions" description="Performance appears once predictions are matched to draws." />
                ) : (
                  <TrendAreaChart data={performance} name="hits" color={CHART_COLORS.mint} />
                )}
              </div>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <PanelHeader title="Model statistics" subtitle={model.data?.model ? `Version ${model.data.model.version}` : 'Active model'} />
              <div className="space-y-4 p-5">
                {topWeights.length === 0 ? (
                  <EmptyState title="No model data" description="A model is trained from validated history." />
                ) : (
                  topWeights.map(([name, value]) => (
                    <div key={name} className="flex items-center gap-3">
                      <span className="w-24 truncate text-[11.5px] text-[var(--text-3)]">{name}</span>
                      <div className="flex-1">
                        <ProgressBar value={(value / maxWeight) * 100} tone="violet" />
                      </div>
                      <span className="mono w-12 text-right text-[11.5px] text-[var(--text-2)]">{value.toFixed(2)}</span>
                    </div>
                  ))
                )}
              </div>
            </Card>

            <Card>
              <PanelHeader title="Backtest summary" subtitle="Out-of-sample comparison" />
              <div className="space-y-4 p-5">
                {!bt ? (
                  <EmptyState title="No backtest yet" description="Run a backtest to see model vs baselines." />
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <p className="eyebrow">Model</p>
                        <p className="stat-value-sm mt-1">{bt.superhybrid.avgMainHits.toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="eyebrow">Random</p>
                        <p className="stat-value-sm mt-1 text-[var(--text-2)]">
                          {bt.baselines.random.avgMainHits.toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <p className="eyebrow">Frequency</p>
                        <p className="stat-value-sm mt-1 text-[var(--text-2)]">
                          {bt.baselines.frequency.avgMainHits.toFixed(2)}
                        </p>
                      </div>
                    </div>
                    <div className="card-2 flex items-center justify-between p-3 text-[12.5px]">
                      <span className="text-[var(--text-2)]">4-hit rate vs random</span>
                      <Badge tone={bt.superhybrid.fourHitRate >= bt.baselines.random.fourHitRate ? 'mint' : 'neutral'}>
                        {percent(bt.superhybrid.fourHitRate)} vs {percent(bt.baselines.random.fourHitRate)}
                      </Badge>
                    </div>
                  </>
                )}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}