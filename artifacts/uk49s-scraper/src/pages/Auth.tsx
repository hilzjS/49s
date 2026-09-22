import { useEffect, useState } from 'react';
import { Link, Redirect, useLocation } from 'wouter';
import { ArrowLeft, ArrowRight, MailCheck, ShieldCheck } from 'lucide-react';
import { Button, Card, Field, Input } from '@/components/ui';
import { useAuth } from '@/lib/auth';

type Mode = 'signin' | 'signup';

function readMode(): Mode {
  if (typeof window === 'undefined') return 'signin';
  const params = new URLSearchParams(window.location.search);
  return params.get('mode') === 'signup' ? 'signup' : 'signin';
}

export default function Auth() {
  const { session, loading, signIn, signUp } = useAuth();
  const [, navigate] = useLocation();
  const [mode, setMode] = useState<Mode>(readMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setMode(readMode());
  }, []);

  if (!loading && session) return <Redirect to="/app" />;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      if (mode === 'signup') {
        const result = await signUp(email.trim(), password, fullName.trim());
        if (result.error) {
          setError(result.error);
        } else if (result.needsConfirmation) {
          setNotice('Account created. Check your inbox to confirm your email, then sign in.');
        } else {
          navigate('/app');
        }
      } else {
        const result = await signIn(email.trim(), password);
        if (result.error) setError(result.error);
        else navigate('/app');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-screen bg-[var(--ink)] lg:grid-cols-2">
      {/* Brand panel */}
      <aside className="app-gradient relative hidden flex-col justify-between border-r border-[var(--line)] p-10 lg:flex">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--gold)] text-[15px] font-bold text-[#17130a]">
            49
          </span>
          <span className="display text-[15px] font-semibold text-[var(--text)]">49S Predictor</span>
        </Link>
        <div className="max-w-md">
          <h1 className="display text-[34px] font-semibold leading-tight tracking-[-0.02em] text-[var(--text)]">
            Predict smarter.
            <br />
            <span className="text-[var(--gold)]">Analyze deeper.</span>
          </h1>
          <p className="mt-4 text-[13.5px] leading-relaxed text-[var(--text-2)]">
            Sign in to access daily Lunchtime and Teatime predictions, historical results, analytics
            and honest backtest performance tracking.
          </p>
          <div className="mt-6 flex items-center gap-2 text-[12.5px] text-[var(--text-3)]">
            <ShieldCheck size={15} className="text-[var(--mint)]" />
            Predictions are statistical analysis — never a guarantee.
          </div>
        </div>
        <span className="text-[11.5px] text-[var(--text-3)]">© {new Date().getFullYear()} 49S Predictor</span>
      </aside>

      {/* Form */}
      <main className="flex items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-[400px]">
          <Link href="/" className="mb-6 inline-flex items-center gap-2 text-[12.5px] text-[var(--text-3)] hover:text-[var(--text)]">
            <ArrowLeft size={14} /> Back to site
          </Link>

          <Card className="p-6">
            <div className="mb-6 flex rounded-xl border border-[var(--line)] bg-[var(--ink-2)] p-1">
              {(['signin', 'signup'] as Mode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`flex-1 rounded-lg py-2 text-[13px] font-semibold transition ${
                    mode === m ? 'bg-[var(--surface-3)] text-[var(--text)]' : 'text-[var(--text-3)]'
                  }`}
                  onClick={() => {
                    setMode(m);
                    setError(null);
                    setNotice(null);
                  }}
                >
                  {m === 'signin' ? 'Sign in' : 'Create account'}
                </button>
              ))}
            </div>

            <h2 className="text-[19px] font-semibold text-[var(--text)]">
              {mode === 'signin' ? 'Welcome back' : 'Create your account'}
            </h2>
            <p className="mt-1 text-[12.5px] text-[var(--text-3)]">
              {mode === 'signin'
                ? 'Sign in to view today’s predictions.'
                : 'Start on the Free plan — upgrade any time.'}
            </p>

            <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
              {mode === 'signup' ? (
                <Field label="Full name">
                  <Input
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Alex Morgan"
                    autoComplete="name"
                  />
                </Field>
              ) : null}
              <Field label="Email">
                <Input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                />
              </Field>
              <Field label="Password" hint={mode === 'signup' ? 'At least 6 characters.' : undefined}>
                <Input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                />
              </Field>

              {error ? (
                <div className="rounded-lg border border-[var(--coral)]/40 bg-[var(--coral)]/10 px-3 py-2 text-[12.5px] text-[#ffc0b8]">
                  {error}
                </div>
              ) : null}
              {notice ? (
                <div className="flex items-start gap-2 rounded-lg border border-[var(--mint)]/40 bg-[var(--mint)]/10 px-3 py-2 text-[12.5px] text-[#9ff0d0]">
                  <MailCheck size={15} className="mt-0.5 shrink-0" />
                  {notice}
                </div>
              ) : null}

              <Button type="submit" block size="lg" loading={submitting}>
                {mode === 'signin' ? 'Sign in' : 'Create account'}
                {!submitting ? <ArrowRight size={16} /> : null}
              </Button>
            </form>
          </Card>

          <p className="mt-4 text-center text-[12px] text-[var(--text-3)]">
            By continuing you agree that predictions are analytical and do not guarantee results.
          </p>
        </div>
      </main>
    </div>
  );
}