import { Receipt } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAsync, formatDate } from '@/lib/useAsync';
import { formatPrice } from '@/lib/plans';
import { Badge, Card, EmptyState, ErrorState, PanelHeader, Spinner, StatCard } from '@/components/ui';

interface PaymentRow {
  id: string;
  user_id: string;
  plan_id: string | null;
  amount_cents: number;
  currency: string;
  status: string;
  description: string | null;
  created_at: string;
}

interface SubRow {
  id: string;
  user_id: string;
  plan_id: string;
  status: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
}

export default function AdminPayments() {
  const payments = useAsync(async (): Promise<PaymentRow[]> => {
    const { data, error } = await supabase
      .from('payments')
      .select('id, user_id, plan_id, amount_cents, currency, status, description, created_at')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data as PaymentRow[]) ?? [];
  }, []);

  const subscriptions = useAsync(async (): Promise<SubRow[]> => {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('id, user_id, plan_id, status, current_period_end, cancel_at_period_end')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data as SubRow[]) ?? [];
  }, []);

  const emails = useAsync(async (): Promise<Record<string, string>> => {
    const { data } = await supabase.from('profiles').select('id, email');
    const map: Record<string, string> = {};
    for (const row of (data as { id: string; email: string | null }[] | null) ?? []) {
      map[row.id] = row.email ?? row.id.slice(0, 8);
    }
    return map;
  }, []);

  const rows = payments.data ?? [];
  const revenue = rows.filter((row) => row.status === 'succeeded').reduce((sum, row) => sum + row.amount_cents, 0);
  const refunds = rows.filter((row) => row.status === 'refunded').length;
  const activeSubs = (subscriptions.data ?? []).filter((sub) => sub.status === 'active').length;
  const emailFor = (userId: string) => emails.data?.[userId] ?? userId.slice(0, 8);

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Administration</p>
        <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.02em]">Payments</h1>
        <p className="mt-1 text-[13px] text-[var(--text-3)]">Transactions, subscriptions and refunds.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Revenue" value={formatPrice(revenue, 'GBP')} hint="Successful payments" tone="mint" />
        <StatCard label="Transactions" value={rows.length} hint="All recorded" tone="sky" />
        <StatCard label="Active subscriptions" value={activeSubs} hint="Currently active" tone="violet" />
        <StatCard label="Refunds" value={refunds} hint="Refunded payments" tone="coral" />
      </div>

      <Card className="overflow-hidden">
        <PanelHeader title="Transactions" subtitle="Most recent first" right={<Receipt size={16} className="text-[var(--text-3)]" />} />
        {payments.loading ? (
          <Spinner />
        ) : payments.error ? (
          <ErrorState message={payments.error} onRetry={payments.reload} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<Receipt size={20} />} title="No transactions yet" description="Payments appear here when users subscribe to paid plans." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Description</th>
                  <th>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="strong">{formatDate(row.created_at)}</td>
                    <td>{emailFor(row.user_id)}</td>
                    <td>{row.description ?? row.plan_id ?? 'Subscription'}</td>
                    <td className="mono">{formatPrice(row.amount_cents, row.currency)}</td>
                    <td>
                      <Badge tone={row.status === 'succeeded' ? 'mint' : row.status === 'refunded' ? 'coral' : 'neutral'}>
                        {row.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <PanelHeader title="Subscriptions" subtitle="All subscription records" />
        {subscriptions.loading ? (
          <Spinner />
        ) : !subscriptions.data?.length ? (
          <EmptyState title="No subscriptions yet" description="Subscriptions appear here when users upgrade." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Plan</th>
                  <th>Status</th>
                  <th>Renews</th>
                  <th>Renewal</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.data.map((sub) => (
                  <tr key={sub.id}>
                    <td className="strong">{emailFor(sub.user_id)}</td>
                    <td>
                      <Badge tone={sub.plan_id === 'vip' ? 'violet' : sub.plan_id === 'pro' ? 'sky' : 'neutral'}>
                        {sub.plan_id}
                      </Badge>
                    </td>
                    <td>
                      <Badge tone={sub.status === 'active' ? 'mint' : 'neutral'}>{sub.status}</Badge>
                    </td>
                    <td>{formatDate(sub.current_period_end)}</td>
                    <td>{sub.cancel_at_period_end ? 'Cancels' : 'Auto-renews'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}