import { useState } from 'react';
import { Database, KeyRound, Settings as SettingsIcon, ShieldCheck } from 'lucide-react';
import { api, getAdminKey, setAdminKey } from '@/lib/api';
import { useAsync, formatDateTime } from '@/lib/useAsync';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Field, Input, PanelHeader, Spinner } from '@/components/ui';

export default function AdminSettings() {
  const { profile } = useAuth();
  const [adminKey, setAdminKeyState] = useState(getAdminKey());
  const [saved, setSaved] = useState(false);

  const health = useAsync(() => api.getScraperHealth(), []);
  const summary = useAsync(() => api.getDataSummary(), []);
  const quality = useAsync(() => api.getDataQuality(), []);

  function save() {
    setAdminKey(adminKey.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const qualityEntries = Object.entries(quality.data ?? {}).filter(([key]) => key !== 'success');

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Administration</p>
        <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.02em]">Settings</h1>
        <p className="mt-1 text-[13px] text-[var(--text-3)]">System status and administrative access.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <PanelHeader
            title="Administrative access"
            subtitle="Write endpoints are protected server-side"
            right={<KeyRound size={16} className="text-[var(--text-3)]" />}
          />
          <div className="space-y-4 p-5">
            <Field label="ADMIN_API_KEY" hint="Stored only in this browser. Never bundled into the app.">
              <Input
                type="password"
                value={adminKey}
                onChange={(e) => setAdminKeyState(e.target.value)}
                placeholder="Paste the admin key"
              />
            </Field>
            <div className="flex items-center gap-3">
              <Button variant="secondary" onClick={save}>
                Save key
              </Button>
              {saved ? <Badge tone="mint">Saved</Badge> : null}
            </div>
            <div className="card-2 flex items-start gap-3 p-3">
              <ShieldCheck size={16} className="mt-0.5 shrink-0 text-[var(--mint)]" />
              <p className="text-[12px] leading-relaxed text-[var(--text-2)]">
                You are signed in as <strong className="text-[var(--text)]">{profile?.email}</strong> with role{' '}
                <strong className="text-[var(--text)]">{profile?.role}</strong>. Admin tools are hidden from
                normal users automatically.
              </p>
            </div>
          </div>
        </Card>

        <Card>
          <PanelHeader
            title="System status"
            subtitle="Scraper and database services"
            right={<SettingsIcon size={16} className="text-[var(--text-3)]" />}
          />
          <div className="space-y-4 p-5">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-[var(--text-2)]">Scraper service</span>
              {health.loading ? (
                <Spinner />
              ) : (
                <Badge tone={health.data?.status === 'ok' ? 'mint' : 'neutral'}>{health.data?.status ?? 'unknown'}</Badge>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-[var(--text-2)]">Last scrape</span>
              <span className="text-[12.5px] text-[var(--text)]">{formatDateTime(health.data?.lastScrapeAt)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-[var(--text-2)]">Cache entries</span>
              <span className="mono text-[12.5px] text-[var(--text)]">{health.data?.cacheEntries ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-[var(--text-2)]">Draws stored</span>
              <span className="mono text-[12.5px] text-[var(--text)]">
                {(summary.data?.totalLunchDraws ?? 0) + (summary.data?.totalTeaDraws ?? 0)}
              </span>
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <PanelHeader
          title="Data quality"
          subtitle="From the existing quality endpoint"
          right={<Database size={16} className="text-[var(--text-3)]" />}
        />
        <div className="p-5">
          {quality.loading ? (
            <Spinner />
          ) : quality.error ? (
            <p className="text-[13px] text-[var(--coral)]">{quality.error}</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {qualityEntries.map(([key, value]) => (
                <div key={key} className="card-2 p-3">
                  <p className="eyebrow">{key}</p>
                  <p className="mono mt-1.5 truncate text-[13px] text-[var(--text)]">
                    {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}