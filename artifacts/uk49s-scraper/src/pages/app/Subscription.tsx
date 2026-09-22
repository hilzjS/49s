import { useState } from 'react';
import { Link } from 'wouter';
import { CalendarClock, Check, CreditCard, Receipt, XCircle } from 'lucide-react';
import { Badge, Button, Card, EmptyState, PanelHeader, Spinner } from '@/components/ui';
import { fetchPlans, formatPrice, type Plan } from '@/lib/plans';
import { changePlan, getMyPayments, getMySubscription } from '@/lib/billing';
import { useAuth } from '@/lib/auth';
import { useAsync, formatDate } from '@/lib/useAsync';

export default function Subscription() {
  const { user, profile, refreshProfile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plans = useAsync(() => fetchPlans(), []);
  const subscription = useAsync(
    () => (user ? getMySubscription(user.id) : Promise.resolve(null)),
    [user?.id],
  );
  const payments = useAsync(
    () => (user ? getMyPayments(user.id) : Promise.resolve([])),
    [user?.id],
  );

  const planList: Plan[] = plans.data ?? [];
  const currentPlan = planList.find((p) => p.id === (profile?.plan_id ?? 'free'));
  const sub = subscription.data;
  const isPaid = (profile?.plan_id ?? 'free') !== 'free';

  async function cancel() {
    if (!user) return;
    const freePlan = planList.find((p) => p.id === 'free');
    if (!freePlan) return;
    setBusy(true);
    setError(null);
    const { error: cancelError } = await changePlan(user.id, freePlan);
    setBusy(false);
    if (cancelError) setError(cancelError);
    else {
      await refreshProfile();
      subscription.reload();
      payments.reload();
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Billing</p>
        <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.02em]">My Plan</h1>
        <p className="mt-1 text-[13px] text-[var(--text-3)]">Manage your subscription and view payment history.</p>
      </div>

      {error ? (
        <div className="rounded-lg border border-[var(--coral)]/40 bg-[var(--coral)]/10 px-4 py-3 text-[12.5px] text-[#ffc0b8]">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <PanelHeader
            title="Subscription"
            subtitle="Current plan and status"
            right={<CreditCard size={16} className="text-[var(--text-3)]" />}
          />
          {plans.loading ? (
            <Spinner />
          ) : (
            <div className="p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="display text-[28px] font-semibold capitalize">
                    {currentPlan?.name ?? profile?.plan_id ?? 'Free'}
                  </p>
                  <p className="mt-1 text-[12.5px] text-[var(--text-3)]">{currentPlan?.tagline}</p>
                </div>
                <Badge tone={isPaid ? (sub?.cancel_at_period_end ? 'coral' : 'mint') : 'neutral'}>
                  {isPaid ? (sub?.cancel_at_period_end ? 'Cancelling' : sub?.status ?? 'Active') : 'Free'}
                </Badge>
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                <div>
                  <p className="eyebrow">Price</p>
                  <p className="stat-value-sm mt-1">
                    {currentPlan ? formatPrice(currentPlan.price_cents, currentPlan.currency) : '—'}
                  </p>
                </div>
                <div>
                  <p className="eyebrow">Renewal date</p>
                  <p className="mt-1.5 text-[13px] text-[var(--text)]">
                    {isPaid ? formatDate(sub?.current_period_end) : '—'}
                  </p>
                </div>
                <div>
                  <p className="eyebrow">Started</p>
                  <p className="mt-1.5 text-[13px] text-[var(--text)]">
                    {sub ? formatDate(sub.current_period_start) : '—'}
                  </p>
                </div>
              </div>

              {currentPlan ? (
                <ul className="mt-6 grid gap-2 sm:grid-cols-2">
                  {currentPlan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-[12.5px] text-[var(--text-2)]">
                      <Check size={15} className="mt-0.5 shrink-0 text-[var(--mint)]" />
                      {feature}
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="mt-7 flex flex-wrap gap-3">
                <Link href="/app/plans">
                  <Button>Upgrade</Button>
                </Link>
                <Link href="/app/plans">
                  <Button variant="secondary">Change plan</Button>
                </Link>
                {isPaid ? (
                  <Button variant="ghost" onClick={cancel} loading={busy}>
                    <XCircle size={15} /> Cancel subscription
                  </Button>
                ) : null}
              </div>
            </div>
          )}
        </Card>

        <Card>
          <PanelHeader
            title="At a glance"
            subtitle="Account"
            right={<CalendarClock size={16} className="text-[var(--text-3)]" />}
          />
          <div className="space-y-4 p-6">
            <div>
              <p className="eyebrow">Account</p>
              <p className="mt-1.5 truncate text-[13px] text-[var(--text)]">{profile?.email}</p>
            </div>
            <div>
              <p className="eyebrow">Plan</p>
              <p className="mt-1.5 text-[13px] capitalize text-[var(--text)]">{profile?.plan_id ?? 'free'}</p>
            </div>
            <div>
              <p className="eyebrow">Payments</p>
              <p className="mt-1.5 text-[13px] text-[var(--text)]">{payments.data?.length ?? 0} recorded</p>
            </div>
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <PanelHeader
          title="Payment history"
          subtitle="Your recorded transactions"
          right={<Receipt size={16} className="text-[var(--text-3)]" />}
        />
        {payments.loading ? (
          <Spinner />
        ) : !payments.data || payments.data.length === 0 ? (
          <EmptyState
            icon={<Receipt size={20} />}
            title="No payments yet"
            description="Payments appear here after you subscribe to a paid plan."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {payments.data.map((payment) => (
                  <tr key={payment.id}>
                    <td className="strong">{formatDate(payment.created_at)}</td>
                    <td>{payment.description ?? 'Subscription'}</td>
                    <td className="mono">{formatPrice(payment.amount_cents, payment.currency)}</td>
                    <td>
                      <Badge tone={payment.status === 'succeeded' ? 'mint' : 'neutral'}>{payment.status}</Badge>
                    </td>
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