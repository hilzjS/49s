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
  const { session, loading, profile, isAdmin } = useAuth();
  if (loading) return <Spinner label="Checking permissions…" />;
  if (!session) return <Redirect to="/auth" />;
  // Wait for the profile to resolve before deciding.
  if (!profile) return <Spinner label="Loading your account…" />;
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