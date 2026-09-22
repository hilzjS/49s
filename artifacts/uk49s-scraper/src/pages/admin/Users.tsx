import { Users as UsersIcon } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAsync, formatDate } from '@/lib/useAsync';
import { Badge, Card, EmptyState, ErrorState, PanelHeader, Spinner, StatCard } from '@/components/ui';

interface UserRow {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  plan_id: string | null;
  created_at: string;
}

export default function AdminUsers() {
  const users = useAsync(async (): Promise<UserRow[]> => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, role, plan_id, created_at')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data as UserRow[]) ?? [];
  }, []);

  const list = users.data ?? [];
  const admins = list.filter((user) => user.role === 'admin').length;
  const paid = list.filter((user) => (user.plan_id ?? 'free') !== 'free').length;

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Administration</p>
        <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.02em]">Users</h1>
        <p className="mt-1 text-[13px] text-[var(--text-3)]">Accounts, roles and subscription status.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total users" value={users.loading ? '—' : list.length} hint="Registered accounts" icon={<UsersIcon size={17} />} tone="sky" />
        <StatCard label="Paid subscribers" value={users.loading ? '—' : paid} hint="Pro or VIP" tone="mint" />
        <StatCard label="Admins" value={users.loading ? '—' : admins} hint="Full access" tone="violet" />
      </div>

      <Card className="overflow-hidden">
        <PanelHeader title="All users" subtitle="Newest first" right={<UsersIcon size={16} className="text-[var(--text-3)]" />} />
        {users.loading ? (
          <Spinner />
        ) : users.error ? (
          <ErrorState message={users.error} onRetry={users.reload} />
        ) : list.length === 0 ? (
          <EmptyState title="No users yet" description="Accounts appear here after users sign up." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Plan</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {list.map((user) => (
                  <tr key={user.id}>
                    <td className="strong">{user.full_name || '—'}</td>
                    <td>{user.email || '—'}</td>
                    <td>
                      <Badge tone={user.role === 'admin' ? 'violet' : 'neutral'}>{user.role}</Badge>
                    </td>
                    <td>
                      <Badge tone={(user.plan_id ?? 'free') === 'vip' ? 'violet' : (user.plan_id ?? 'free') === 'pro' ? 'sky' : 'neutral'}>
                        {user.plan_id ?? 'free'}
                      </Badge>
                    </td>
                    <td>{formatDate(user.created_at)}</td>
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