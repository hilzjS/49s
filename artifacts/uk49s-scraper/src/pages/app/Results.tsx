import { useMemo, useState } from 'react';
import { ListChecks, Search } from 'lucide-react';
import { api, type DrawType } from '@/lib/api';
import { useAsync, formatDate } from '@/lib/useAsync';
import {
  Badge,
  Balls,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PanelHeader,
  Select,
  Spinner,
  Tabs,
} from '@/components/ui';

interface Row {
  drawType: DrawType;
  drawDate: string;
  mainNumbers: number[];
  boosterBall: number;
}

export default function Results() {
  const [session, setSession] = useState<'all' | DrawType>('all');
  const [dateQuery, setDateQuery] = useState('');
  const [limit, setLimit] = useState(100);

  const data = useAsync(async () => {
    const [lunch, tea] = await Promise.all([
      api.getLatestDraws('lunchtime', limit),
      api.getLatestDraws('teatime', limit),
    ]);
    const rows: Row[] = [
      ...lunch.draws.map((draw) => ({
        drawType: 'lunchtime' as DrawType,
        drawDate: draw.drawDate,
        mainNumbers: draw.mainNumbers,
        boosterBall: draw.boosterBall,
      })),
      ...tea.draws.map((draw) => ({
        drawType: 'teatime' as DrawType,
        drawDate: draw.drawDate,
        mainNumbers: draw.mainNumbers,
        boosterBall: draw.boosterBall,
      })),
    ];
    rows.sort((a, b) => b.drawDate.localeCompare(a.drawDate));
    return rows;
  }, [limit]);

  const rows = useMemo(() => {
    const all = data.data ?? [];
    return all.filter(
      (row) =>
        (session === 'all' || row.drawType === session) &&
        (!dateQuery || row.drawDate.includes(dateQuery)),
    );
  }, [data.data, session, dateQuery]);

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Explorer</p>
        <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.02em]">Historical Results</h1>
        <p className="mt-1 text-[13px] text-[var(--text-3)]">
          Browse validated Lunchtime and Teatime draws.
        </p>
      </div>

      <Card>
        <div className="flex flex-wrap items-end gap-4 p-4">
          <Tabs
            items={[
              { value: 'all', label: 'All sessions' },
              { value: 'lunchtime', label: 'Lunchtime' },
              { value: 'teatime', label: 'Teatime' },
            ]}
            value={session}
            onChange={(value) => setSession(value as 'all' | DrawType)}
          />
          <div className="ml-auto flex flex-wrap items-end gap-3">
            <Field label="Date contains">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
                <Input
                  className="pl-8"
                  value={dateQuery}
                  onChange={(e) => setDateQuery(e.target.value)}
                  placeholder="e.g. 2024-05"
                />
              </div>
            </Field>
            <Field label="Rows">
              <Select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={250}>250</option>
                <option value={500}>500</option>
              </Select>
            </Field>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <PanelHeader
          title="Draws"
          subtitle={`${rows.length} ${rows.length === 1 ? 'draw' : 'draws'} shown`}
          right={<ListChecks size={16} className="text-[var(--text-3)]" />}
        />

        {data.loading ? (
          <Spinner label="Loading results…" />
        ) : data.error ? (
          <ErrorState message={data.error} onRetry={data.reload} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<ListChecks size={20} />}
            title="No draws found"
            description="Try clearing the filters, or ingest historical data to populate results."
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Session</th>
                    <th>Main numbers</th>
                    <th>Booster</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`${row.drawType}-${row.drawDate}`}>
                      <td className="strong">{formatDate(row.drawDate)}</td>
                      <td>
                        <Badge tone={row.drawType === 'lunchtime' ? 'gold' : 'sky'}>
                          {row.drawType === 'lunchtime' ? 'Lunchtime' : 'Teatime'}
                        </Badge>
                      </td>
                      <td>
                        <Balls main={row.mainNumbers} size="sm" />
                      </td>
                      <td>
                        <Balls main={[]} booster={row.boosterBall} size="sm" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="divide-y divide-[var(--line)] md:hidden">
              {rows.map((row) => (
                <div key={`${row.drawType}-${row.drawDate}`} className="px-4 py-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-medium text-[var(--text)]">{formatDate(row.drawDate)}</span>
                    <Badge tone={row.drawType === 'lunchtime' ? 'gold' : 'sky'}>
                      {row.drawType === 'lunchtime' ? 'Lunchtime' : 'Teatime'}
                    </Badge>
                  </div>
                  <div className="mt-3">
                    <Balls main={row.mainNumbers} booster={row.boosterBall} size="sm" />
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