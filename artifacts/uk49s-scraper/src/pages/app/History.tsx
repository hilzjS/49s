import { useMemo, useState } from 'react';
import { History as HistoryIcon } from 'lucide-react';
import { api, type DrawType } from '@/lib/api';
import { useAsync, formatDate } from '@/lib/useAsync';
import {
  Badge,
  Balls,
  Card,
  EmptyState,
  ErrorState,
  PanelHeader,
  Spinner,
  StatCard,
  Tabs,
  percent,
} from '@/components/ui';

export default function History() {
  const [drawType, setDrawType] = useState<DrawType>('lunchtime');
  const data = useAsync(() => api.getPredictionHistory(drawType, 100), [drawType]);

  const predictions = data.data?.predictions ?? [];
  const resolved = useMemo(() => predictions.filter((p) => p.mainHits != null), [predictions]);
  const avgHits = resolved.length
    ? resolved.reduce((sum, p) => sum + (p.mainHits ?? 0), 0) / resolved.length
    : null;
  const fourHitCount = resolved.filter((p) => p.mainHits === 4).length;
  const boosterHits = resolved.filter((p) => p.boosterHit).length;

  const label = drawType === 'lunchtime' ? 'Lunchtime' : 'Teatime';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Record</p>
          <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.02em]">Prediction History</h1>
          <p className="mt-1 text-[13px] text-[var(--text-3)]">
            Every prediction, matched to its draw result.
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

      {data.data?.statsSince ? (
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 text-[12px] text-[var(--text-2)]">
          Statistics count only predictions from the current model, applied {formatDate(data.data.statsSince)}. Earlier
          predictions are kept but no longer counted.
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Predictions" value={predictions.length} hint={`${label} session`} tone="sky" />
        <StatCard label="Avg main hits" value={avgHits != null ? avgHits.toFixed(2) : '—'} hint={`${resolved.length} resolved`} tone="mint" />
        <StatCard label="4-hit rate" value={resolved.length ? percent(fourHitCount / resolved.length) : '—'} hint={`${fourHitCount} exact`} tone="gold" />
        <StatCard label="Booster hits" value={resolved.length ? percent(boosterHits / resolved.length) : '—'} hint={`${boosterHits} hits`} tone="violet" />
      </div>

      <Card className="overflow-hidden">
        <PanelHeader
          title={`${label} predictions`}
          subtitle="Most recent first"
          right={<HistoryIcon size={16} className="text-[var(--text-3)]" />}
        />

        {data.loading ? (
          <Spinner label="Loading history…" />
        ) : data.error ? (
          <ErrorState message={data.error} onRetry={data.reload} />
        ) : predictions.length === 0 ? (
          <EmptyState
            icon={<HistoryIcon size={20} />}
            title="No predictions recorded yet"
            description="Once predictions are generated, their results and hit statistics appear here."
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Session</th>
                    <th>Prediction</th>
                    <th>Result</th>
                    <th>Hits</th>
                  </tr>
                </thead>
                <tbody>
                  {predictions.map((p) => (
                    <tr key={p.id}>
                      <td className="strong">{formatDate(p.predictionDate)}</td>
                      <td>
                        <Badge tone={p.drawType === 'lunchtime' ? 'gold' : 'sky'}>
                          {p.drawType === 'lunchtime' ? 'Lunchtime' : 'Teatime'}
                        </Badge>
                      </td>
                      <td>
                        <Balls main={p.predictedMain} booster={p.predictedBooster} size="sm" />
                      </td>
                      <td>
                        {p.actualMain ? (
                          <Balls main={p.actualMain} booster={p.actualBooster} size="sm" />
                        ) : (
                          <span className="text-[12px] text-[var(--text-3)]">Awaiting draw</span>
                        )}
                      </td>
                      <td>
                        <Badge
                          tone={
                            p.mainHits == null ? 'neutral' : p.mainHits >= 3 ? 'mint' : p.mainHits === 2 ? 'sky' : 'neutral'
                          }
                        >
                          {p.mainHits == null ? 'Pending' : `${p.mainHits} / 4${p.boosterHit ? ' +B' : ''}`}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-[var(--line)] md:hidden">
              {predictions.map((p) => (
                <div key={p.id} className="px-4 py-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-medium text-[var(--text)]">{formatDate(p.predictionDate)}</span>
                    <Badge
                      tone={p.mainHits == null ? 'neutral' : p.mainHits >= 3 ? 'mint' : p.mainHits === 2 ? 'sky' : 'neutral'}
                    >
                      {p.mainHits == null ? 'Pending' : `${p.mainHits} hits`}
                    </Badge>
                  </div>
                  <div className="mt-3 space-y-2">
                    <div>
                      <p className="eyebrow mb-1">Prediction</p>
                      <Balls main={p.predictedMain} booster={p.predictedBooster} size="sm" />
                    </div>
                    {p.actualMain ? (
                      <div>
                        <p className="eyebrow mb-1">Result</p>
                        <Balls main={p.actualMain} booster={p.actualBooster} size="sm" />
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}