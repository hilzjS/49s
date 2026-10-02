import { useState } from 'react';
import { Boxes } from 'lucide-react';
import { api, type DrawType, type EngineWeights } from '@/lib/api';
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
} from '@/components/ui';

/** The engine's tunable weights, in a stable display order. */
const WEIGHT_ORDER: (keyof EngineWeights)[] = ['hot', 'overdue', 'halfLife', 'power'];

export default function AdminModels() {
  const [drawType, setDrawType] = useState<DrawType>('lunchtime');
  const active = useAsync(() => api.getActiveModel(drawType), [drawType]);
  const history = useAsync(() => api.getModelHistory(drawType), [drawType]);

  const model = active.data?.model;
  const weightEntries = model ? WEIGHT_ORDER.map((key) => [key, model.weights[key]] as const) : [];
  const maxWeight = weightEntries.length ? Math.max(...weightEntries.map(([, v]) => v)) : 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Administration</p>
          <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.02em]">Models</h1>
          <p className="mt-1 text-[13px] text-[var(--text-3)]">
            The locked champion weights for each session, tuned by the walk-forward optimizer.
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
            title="Active champion"
            subtitle={model && model.id !== null ? `Version ${model.version}` : 'Engine defaults'}
            right={<Boxes size={16} className="text-[var(--text-3)]" />}
          />
          {active.loading ? (
            <Spinner />
          ) : active.error ? (
            <ErrorState message={active.error} onRetry={active.reload} />
          ) : !model || model.id === null ? (
            <EmptyState
              title="No tuned champion yet"
              description="The engine uses its default weights until the optimizer locks a champion."
            />
          ) : (
            <div className="space-y-5 p-5">
              <div className="flex flex-wrap gap-2">
                <Badge tone="mint">base44</Badge>
                <Badge tone={model.targetMet ? 'mint' : 'neutral'}>
                  {model.targetMet ? 'target met' : 'below target'}
                </Badge>
                <Badge tone="sky">4-number line + booster</Badge>
                {model.candidatesTested != null ? (
                  <Badge>{model.candidatesTested} candidates</Badge>
                ) : null}
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="eyebrow">3+ draws</p>
                  <p className="stat-value-sm mt-1">{model.threePlusCount ?? '—'}</p>
                </div>
                <div>
                  <p className="eyebrow">Avg hits</p>
                  <p className="stat-value-sm mt-1">
                    {model.avgHitsPerLine != null ? model.avgHitsPerLine.toFixed(3) : '—'}
                  </p>
                </div>
                <div>
                  <p className="eyebrow">Locked</p>
                  <p className="stat-value-sm mt-1">{model.createdAt ? formatDate(model.createdAt) : '—'}</p>
                </div>
              </div>

              <div>
                <p className="eyebrow">Engine weights</p>
                <div className="mt-3 space-y-2">
                  {weightEntries.map(([name, value]) => (
                    <div key={name} className="flex items-center gap-3">
                      <span className="w-20 truncate text-[11.5px] text-[var(--text-3)]">{name}</span>
                      <div className="flex-1">
                        <ProgressBar value={(value / maxWeight) * 100} tone="gold" />
                      </div>
                      <span className="mono w-12 text-right text-[11.5px] text-[var(--text-2)]">
                        {value.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </Card>

        <Card className="overflow-hidden">
          <PanelHeader title="Champion history" subtitle="Every locked weight set" />
          {history.loading ? (
            <Spinner />
          ) : !history.data?.models?.length ? (
            <EmptyState title="No champion history" description="Weight sets appear here as the optimizer locks them." />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Version</th>
                    <th>Status</th>
                    <th>hot</th>
                    <th>halfLife</th>
                    <th>power</th>
                    <th>3+</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {history.data.models.map((item) => (
                    <tr key={`${item.id}-${item.version}`}>
                      <td className="strong mono">{item.version}</td>
                      <td>
                        <Badge tone={item.targetMet ? 'mint' : 'neutral'}>
                          {item.targetMet ? 'target met' : 'locked'}
                        </Badge>
                      </td>
                      <td className="mono">{item.weights.hot.toFixed(2)}</td>
                      <td className="mono">{item.weights.halfLife}</td>
                      <td className="mono">{item.weights.power.toFixed(2)}</td>
                      <td className="mono">{item.threePlusCount ?? '—'}</td>
                      <td>{item.createdAt ? formatDate(item.createdAt) : '—'}</td>
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
