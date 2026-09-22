import { supabase } from '@/integrations/supabase/client';
import type { Plan } from '@/lib/plans';

export interface Subscription {
  id: string;
  user_id: string;
  plan_id: string;
  status: string;
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  created_at: string;
}

export interface Payment {
  id: string;
  plan_id: string | null;
  amount_cents: number;
  currency: string;
  status: string;
  description: string | null;
  created_at: string;
}

function addDays(iso: string, days: number): string {
  const date = new Date(iso);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

export async function getMySubscription(userId: string): Promise<Subscription | null> {
  const { data } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Subscription | null) ?? null;
}

export async function getMyPayments(userId: string): Promise<Payment[]> {
  const { data } = await supabase
    .from('payments')
    .select('id, plan_id, amount_cents, currency, status, description, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  return (data as Payment[]) ?? [];
}

export async function changePlan(userId: string, plan: Plan): Promise<{ error: string | null }> {
  const now = new Date().toISOString();
  const { data: existing, error: findError } = await supabase
    .from('subscriptions')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (findError) return { error: findError.message };

  let subscriptionId: string | null = (existing as { id: string } | null)?.id ?? null;

  if (plan.id === 'free') {
    if (subscriptionId) {
      await supabase
        .from('subscriptions')
        .update({ status: 'canceled', cancel_at_period_end: true, updated_at: now })
        .eq('id', subscriptionId);
    }
  } else if (subscriptionId) {
    const { error } = await supabase
      .from('subscriptions')
      .update({
        plan_id: plan.id,
        status: 'active',
        cancel_at_period_end: false,
        current_period_start: now,
        current_period_end: addDays(now, 30),
        updated_at: now,
      })
      .eq('id', subscriptionId);
    if (error) return { error: error.message };
  } else {
    const { data: inserted, error } = await supabase
      .from('subscriptions')
      .insert({ user_id: userId, plan_id: plan.id, status: 'active' })
      .select('id')
      .maybeSingle();
    if (error) return { error: error.message };
    subscriptionId = (inserted as { id: string } | null)?.id ?? null;
  }

  const { error: profileError } = await supabase
    .from('profiles')
    .update({ plan_id: plan.id, updated_at: now })
    .eq('id', userId);
  if (profileError) return { error: profileError.message };

  if (plan.id !== 'free' && plan.price_cents > 0) {
    await supabase.from('payments').insert({
      user_id: userId,
      subscription_id: subscriptionId,
      plan_id: plan.id,
      amount_cents: plan.price_cents,
      currency: plan.currency,
      status: 'succeeded',
      description: `${plan.name} plan — ${plan.interval}`,
    });
  }

  return { error: null };
}