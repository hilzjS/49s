import { supabase } from '@/integrations/supabase/client';

export interface Plan {
  id: string;
  name: string;
  tagline: string | null;
  price_cents: number;
  currency: string;
  interval: string;
  features: string[];
  is_active: boolean;
  sort_order: number;
}

// Used only if the database is unreachable — the database is the source of truth.
export const FALLBACK_PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'Everything you need to get started',
    price_cents: 0,
    currency: 'GBP',
    interval: 'month',
    features: [
      'Daily Lunchtime & Teatime predictions',
      'Latest results & basic statistics',
      '7-day prediction history',
      'Community support',
    ],
    is_active: true,
    sort_order: 1,
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'For the serious analyst',
    price_cents: 1499,
    currency: 'GBP',
    interval: 'month',
    features: [
      'Everything in Free',
      'Full prediction history',
      'Advanced analytics & charts',
      'Backtesting access',
      'No advertising',
      'Email support',
    ],
    is_active: true,
    sort_order: 2,
  },
  {
    id: 'vip',
    name: 'VIP',
    tagline: 'Maximum insight and control',
    price_cents: 3999,
    currency: 'GBP',
    interval: 'month',
    features: [
      'Everything in Pro',
      'Advanced model analytics',
      'Optimizer access',
      'Priority support',
      'Early feature access',
    ],
    is_active: true,
    sort_order: 3,
  },
];

export async function fetchPlans(): Promise<Plan[]> {
  try {
    const { data, error } = await supabase
      .from('plans')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (error || !data || data.length === 0) return FALLBACK_PLANS;
    return (data as Plan[]).map((plan) => ({
      ...plan,
      features: Array.isArray(plan.features) ? plan.features : [],
    }));
  } catch {
    return FALLBACK_PLANS;
  }
}

export function formatPrice(priceCents: number, currency: string): string {
  if (!priceCents) return 'Free';
  const symbol = currency === 'GBP' ? '£' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '';
  return `${symbol}${(priceCents / 100).toFixed(2)}`;
}

export function planRank(id: string | null | undefined): number {
  return id === 'vip' ? 3 : id === 'pro' ? 2 : 1;
}