import { useState } from 'react';
import { Boxes } from 'lucide-react';
import { api, type DrawType } from '@/lib/api';
import { useAsync, formatDate } from '@/lib/useAsync';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  PanelHeader,
  ProgressBar,
  Spinner,
  Tabs,
  percent,
} from '@/components/ui';

export default function AdminModels() {
  const [drawType, setDrawType] = useState<DrawType>('lunchtime');
  const active = useAsync(() => api.getActiveModel(drawType), [drawType]);
  const history = useAsync(() => api.getModelHistory(drawType), [drawType]);

  const model = active.data?.model;
  const weights = model ? Object.entries(model.weights).sort((a, b) => b[1] - a[1]) : [];
  const maxWeight = weights.length ? Math.max(...weights.map(([, v]) => v)) : 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Administration</p>
          <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.02em]">Models</h1>
          <p className="mt-1 text-[13px] text-[var(--text-3)]">
            The active model and its configuration history for each session.
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

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <PanelHeader
            title="Active model"
            subtitle={model ? `Version ${model.version}` : 'No active model'}
            right={<Boxes size={16} className="text-[var(--text-3)]" />}
          />
          {active.loading ? (
            <Spinner />
          ) : active.error ? (
            <ErrorState message={active.error} onRetry={active.reload} />
          ) : !model ? (
            <EmptyState title="No active model" description="A model is created once validated history exists." />
          ) : (
            <div className="space-y-5 p-5">
              <div className="flex flex-wrap gap-2">
                <Badge tone="mint">{model.status}</Badge>
                <Badge tone="sky">{model.lookbackWindow} draw lookback</Badge>
                {model.trainingCutoff ? <Badge>cutoff {formatDate(model.trainingCutoff)}</Badge> : null}
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="eyebrow">Validation 4-hit</p>
                  <p className="stat-value-sm mt-1">{percent(model.validationMetrics?.fourHitRate ?? null)}</p>
                </div>
                <div>
                  <p className="eyebrow">Validation avg</p>
                  <p className="stat-value-sm mt-1">
                    {model.validationMetrics?.avgHits != null ? model.validationMetrics.avgHits.toFixed(2) : '—'}
                  </p>
                </div>
                <div>
                  <p className="eyebrow">Sample size</p>
                  <p className="stat-value-sm mt-1">{model.validationMetrics?.sampleSize ?? '—'}</p>
                </div>
              </div>

              <div>
                <p className="eyebrow">Constraints</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge tone={model.constraints?.enforceDiversity ? 'mint' : 'neutral'}>
                    diversity {model.constraints?.enforceDiversity ? 'on' : 'off'}
                  </Badge>
                  <Badge>spread ≥ {model.constraints?.minNumberSpread ?? '—'}</Badge>
                  <Badge>max same group {model.constraints?.maxSameGroup ?? '—'}</Badge>
                </div>
              </div>

              <div>
                <p className="eyebrow">Feature weights</p>
                <div className="mt-3 space-y-2">
                  {weights.map(([name, value]) => (
                    <div key={name} className="flex items-center gap-3">
                      <span className="w-28 truncate text-[11.5px] text-[var(--text-3)]">{name}</span>
                      <div className="flex-1">
                        <ProgressBar value={(value / maxWeight) * 100} tone="gold" />
                      </div>
                      <span className="mono w-12 text-right text-[11.5px] text-[var(--text-2)]">{value.toFixed(3)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </Card>

        <Card className="overflow-hidden">
          <PanelHeader title="Model history" subtitle="Every configuration" />
          {history.loading ? (
            <Spinner />
          ) : !history.data?.models?.length ? (
            <EmptyState title="No model history" description="Configurations appear here as models are trained." />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Version</th>
                    <th>Status</th>
                    <th>Lookback</th>
                    <th>Val. avg</th>
                    <th>Val. 4-hit</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {history.data.models.map((item) => (
                    <tr key={item.id}>
                      <td className="strong mono">{item.version}</td>
                      <td>
                        <Badge tone={item.status === 'active' ? 'mint' : 'neutral'}>{item.status}</Badge>
                      </td>
                      <td className="mono">{item.lookbackWindow}</td>
                      <td className="mono">
                        {item.validationMetrics?.avgHits != null ? item.validationMetrics.avgHits.toFixed(2) : '—'}
                      </td>
                      <td className="mono">{percent(item.validationMetrics?.fourHitRate ?? null)}</td>
                      <td>{formatDate(item.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}