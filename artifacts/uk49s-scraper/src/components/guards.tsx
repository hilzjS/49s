import type { ReactNode } from 'react';
import { Redirect } from 'wouter';
import { useAuth } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';
import { Spinner } from '@/components/ui';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <Spinner label="Checking your session…" />;
  if (!session) return <Redirect to="/auth" />;
  return <>{children}</>;
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { session, loading, profileLoading, isAdmin } = useAuth();
  if (loading) return <Spinner label="Checking permissions…" />;
  if (!session) return <Redirect to="/auth" />;
  // Wait for the profile fetch, which is bounded by a timeout so this can never
  // spin forever.
  if (profileLoading) return <Spinner label="Loading your account…" />;
  // Profile resolved but unavailable (missing row or fetch failed) — send
  // non-admins to the app rather than leaving them on a permanent spinner.
  if (!isAdmin) return <Redirect to="/app" />;
  return <>{children}</>;
}

export function UserShell({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <AppShell>{children}</AppShell>
    </RequireAuth>
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <RequireAdmin>
      <AppShell>{children}</AppShell>
    </RequireAdmin>
  );
}