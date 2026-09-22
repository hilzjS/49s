import { useState } from 'react';
import { Check, Rocket, Sparkles } from 'lucide-react';
import { Badge, Button, Card, Spinner } from '@/components/ui';
import { fetchPlans, formatPrice, type Plan } from '@/lib/plans';
import { changePlan } from '@/lib/billing';
import { useAuth } from '@/lib/auth';
import { useAsync } from '@/lib/useAsync';

export default function Plans() {
  const { user, profile, refreshProfile } = useAuth();
  const plans = useAsync(() => fetchPlans(), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentPlanId = profile?.plan_id ?? 'free';

  async function choose(plan: Plan) {
    if (!user) return;
    setBusy(plan.id);
    setMessage(null);
    setError(null);
    const { error: changeError } = await changePlan(user.id, plan);
    setBusy(null);
    if (changeError) {
      setError(changeError);
    } else {
      await refreshProfile();
      setMessage(
        plan.id === 'free'
          ? 'Your subscription has been cancelled and moved to the Free plan.'
          : `You are now subscribed to the ${plan.name} plan.`,
      );
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Membership</p>
        <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.02em]">Plans</h1>
        <p className="mt-1 text-[13px] text-[var(--text-3)]">
          Pricing and features are managed centrally — plans can change without an app update.
        </p>
      </div>

      {message ? (
        <div className="rounded-lg border border-[var(--mint)]/40 bg-[var(--mint)]/10 px-4 py-3 text-[12.5px] text-[#9ff0d0]">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-lg border border-[var(--coral)]/40 bg-[var(--coral)]/10 px-4 py-3 text-[12.5px] text-[#ffc0b8]">
          {error}
        </div>
      ) : null}

      {plans.loading ? (
        <Spinner />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {plans.data?.map((plan) => {
            const isCurrent = plan.id === currentPlanId;
            const highlight = plan.id === 'pro';
            return (
              <Card
                key={plan.id}
                className={`relative p-6 ${highlight ? 'border-[var(--gold)]/60' : ''} ${
                  isCurrent ? 'ring-1 ring-[var(--mint)]/50' : ''
                }`}
              >
                {isCurrent ? (
                  <span className="absolute -top-3 left-6">
                    <Badge tone="mint">Current plan</Badge>
                  </span>
                ) : highlight ? (
                  <span className="absolute -top-3 left-6">
                    <Badge tone="gold">
                      <Rocket size={12} /> Most popular
                    </Badge>
                  </span>
                ) : null}

                <h3 className="display text-[18px] font-semibold">{plan.name}</h3>
                <p className="mt-1 text-[12.5px] text-[var(--text-3)]">{plan.tagline}</p>
                <div className="mt-5 flex items-end gap-1.5">
                  <span className="display text-[34px] font-semibold">
                    {formatPrice(plan.price_cents, plan.currency)}
                  </span>
                  {plan.price_cents > 0 ? (
                    <span className="pb-1 text-[12.5px] text-[var(--text-3)]">/{plan.interval}</span>
                  ) : null}
                </div>

                <ul className="mt-5 space-y-2.5">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5 text-[12.5px] text-[var(--text-2)]">
                      <Check size={15} className="mt-0.5 shrink-0 text-[var(--mint)]" />
                      {feature}
                    </li>
                  ))}
                </ul>

                <Button
                  className="mt-6"
                  block
                  variant={isCurrent ? 'ghost' : highlight ? 'primary' : 'secondary'}
                  disabled={isCurrent}
                  loading={busy === plan.id}
                  onClick={() => choose(plan)}
                >
                  {isCurrent ? 'Your current plan' : plan.price_cents === 0 ? 'Switch to Free' : `Choose ${plan.name}`}
                </Button>
              </Card>
            );
          })}
        </div>
      )}

      <div className="card-2 flex items-start gap-3 p-4">
        <Sparkles size={17} className="mt-0.5 shrink-0 text-[var(--gold)]" />
        <p className="text-[12px] leading-relaxed text-[var(--text-2)]">
          Plan changes take effect immediately. This environment models subscriptions inside the platform
          database; connect a payment provider to collect real payments.
        </p>
      </div>
    </div>
  );
}