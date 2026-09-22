import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import {
  ArrowRight,
  BarChart3,
  Check,
  Clock3,
  Database,
  History,
  LineChart,
  Lock,
  Moon,
  Rocket,
  ShieldCheck,
  Sparkles,
  Sun,
  Target,
  TrendingUp,
} from 'lucide-react';
import { Badge, Ball, Button, Card } from '@/components/ui';
import { TrendAreaChart } from '@/components/charts';
import { FALLBACK_PLANS, fetchPlans, formatPrice, type Plan } from '@/lib/plans';
import { useAuth } from '@/lib/auth';

const steps = [
  { icon: Database, title: 'Historical UK49s data', text: 'Every validated Lunchtime and Teatime draw, collected and de-duplicated.' },
  { icon: BarChart3, title: 'Statistical analysis', text: 'Frequency, recency, gap, pairs and balance features are computed over rolling windows.' },
  { icon: LineChart, title: 'Model processing', text: 'A configurable SuperHybrid model weights each feature and ranks every number.' },
  { icon: Target, title: 'Prediction generation', text: 'Four main numbers plus a booster, generated per session with diversity constraints.' },
  { icon: TrendingUp, title: 'Performance tracking', text: 'Predictions are matched to results and scored — including when the model is at chance.' },
];

const features = [
  { icon: Sun, title: 'Lunchtime predictions', text: 'Dedicated 13:00 model and history.' },
  { icon: Moon, title: 'Teatime predictions', text: 'A completely separate 18:45 model.' },
  { icon: Database, title: 'Historical analysis', text: 'Browse and export validated draws.' },
  { icon: LineChart, title: 'Backtesting', text: 'Walk-forward validation against real baselines.' },
  { icon: BarChart3, title: 'Model analytics', text: 'See what drives each ranking.' },
  { icon: History, title: 'Prediction history', text: 'An immutable record of every call.' },
  { icon: TrendingUp, title: 'Performance statistics', text: 'Honest, out-of-sample metrics.' },
];

function PreviewCard() {
  const trend = [
    { label: 'W1', value: 0.41 },
    { label: 'W2', value: 0.44 },
    { label: 'W3', value: 0.39 },
    { label: 'W4', value: 0.47 },
    { label: 'W5', value: 0.45 },
    { label: 'W6', value: 0.49 },
    { label: 'W7', value: 0.46 },
  ];
  return (
    <Card className="w-full p-5 shadow-2xl">
      <div className="flex items-center justify-between">
        <span className="eyebrow">Today’s predictions</span>
        <Badge tone="mint">Live model</Badge>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="card-2 p-4">
          <div className="flex items-center gap-2 text-[12px] text-[var(--text-3)]">
            <Sun size={14} /> LUNCHTIME · 13:00
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Ball number={5} size="sm" />
            <Ball number={17} size="sm" />
            <Ball number={24} size="sm" />
            <Ball number={31} size="sm" />
            <Ball number={42} booster size="sm" />
          </div>
        </div>
        <div className="card-2 p-4">
          <div className="flex items-center gap-2 text-[12px] text-[var(--text-3)]">
            <Moon size={14} /> TEATIME · 18:45
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Ball number={8} size="sm" />
            <Ball number={19} size="sm" />
            <Ball number={28} size="sm" />
            <Ball number={39} size="sm" />
            <Ball number={12} booster size="sm" />
          </div>
        </div>
      </div>
      <div className="mt-4 card-2 p-3">
        <div className="flex items-center justify-between px-1 pb-1">
          <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-3)]">
            Rolling hit rate
          </span>
          <span className="mono text-[12px] text-[var(--mint)]">+3.1%</span>
        </div>
        <TrendAreaChart data={trend} name="hits" />
      </div>
      <p className="mt-3 text-center text-[10.5px] text-[var(--text-3)]">
        Illustrative interface — not a guarantee of results.
      </p>
    </Card>
  );
}

export default function Landing() {
  const [plans, setPlans] = useState<Plan[]>(FALLBACK_PLANS);
  const { session } = useAuth();

  useEffect(() => {
    let active = true;
    fetchPlans().then((p) => active && setPlans(p));
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="min-h-screen bg-[var(--ink)] text-[var(--text)]">
      <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--ink)]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-[1180px] items-center gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--gold)] text-[15px] font-bold text-[#17130a]">
              49
            </span>
            <span className="display text-[15px] font-semibold">49S Predictor</span>
          </Link>
          <nav className="ml-6 hidden items-center gap-1 md:flex">
            <a className="nav-link" href="#how">How it works</a>
            <a className="nav-link" href="#features">Features</a>
            <a className="nav-link" href="#pricing">Pricing</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {session ? (
              <Link href="/app">
                <Button size="sm">
                  Open app <ArrowRight size={15} />
                </Button>
              </Link>
            ) : (
              <>
                <Link href="/auth">
                  <Button variant="ghost" size="sm">
                    Sign in
                  </Button>
                </Link>
                <Link href="/auth?mode=signup">
                  <Button size="sm">Get Started</Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="app-gradient relative overflow-hidden border-b border-[var(--line)]">
        <div className="mx-auto grid w-full max-w-[1180px] items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:py-24">
          <div className="fade-up">
            <Badge tone="gold">
              <Sparkles size={12} /> Statistical prediction platform
            </Badge>
            <h1 className="mt-5 text-[40px] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[56px]">
              Predict smarter.
              <br />
              <span className="text-[var(--gold)]">Analyze deeper.</span>
            </h1>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-[var(--text-2)]">
              49S Predictor turns years of historical UK49s results into analytical predictions.
              Statistical models, walk-forward backtesting and transparent performance tracking —
              for both Lunchtime and Teatime sessions.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/auth?mode=signup">
                <Button size="lg">
                  Get Started <ArrowRight size={16} />
                </Button>
              </Link>
              <Link href="/app/predictions">
                <Button variant="secondary" size="lg">
                  View Predictions
                </Button>
              </Link>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-[12.5px] text-[var(--text-3)]">
              <span className="inline-flex items-center gap-2">
                <ShieldCheck size={15} className="text-[var(--mint)]" /> Honest, out-of-sample metrics
              </span>
              <span className="inline-flex items-center gap-2">
                <Lock size={15} className="text-[var(--sky)]" /> Secure accounts
              </span>
              <span className="inline-flex items-center gap-2">
                <Clock3 size={15} className="text-[var(--gold)]" /> Two sessions daily
              </span>
            </div>
          </div>
          <div className="fade-up">
            <PreviewCard />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-b border-[var(--line)] py-16">
        <div className="mx-auto w-full max-w-[1180px] px-4 sm:px-6">
          <span className="eyebrow">How it works</span>
          <h2 className="mt-2 max-w-2xl text-[28px] font-semibold tracking-[-0.02em]">
            From raw results to a ranked prediction
          </h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {steps.map((step, index) => {
              const Icon = step.icon;
              return (
                <Card key={step.title} className="card-hover p-5">
                  <div className="flex items-center justify-between">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--surface-3)] text-[var(--gold)]">
                      <Icon size={18} />
                    </span>
                    <span className="mono text-[12px] text-[var(--text-3)]">0{index + 1}</span>
                  </div>
                  <h3 className="mt-4 text-[14.5px] font-semibold">{step.title}</h3>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--text-2)]">{step.text}</p>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-b border-[var(--line)] py-16">
        <div className="mx-auto w-full max-w-[1180px] px-4 sm:px-6">
          <span className="eyebrow">Features</span>
          <h2 className="mt-2 text-[28px] font-semibold tracking-[-0.02em]">Everything in one platform</h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((feature) => {
              const Icon = feature.icon;
              return (
                <div key={feature.title} className="card-2 p-5">
                  <Icon size={18} className="text-[var(--gold)]" />
                  <h3 className="mt-3 text-[14px] font-semibold">{feature.title}</h3>
                  <p className="mt-1.5 text-[12.5px] text-[var(--text-2)]">{feature.text}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-b border-[var(--line)] py-16">
        <div className="mx-auto w-full max-w-[1180px] px-4 sm:px-6">
          <span className="eyebrow">Pricing</span>
          <h2 className="mt-2 text-[28px] font-semibold tracking-[-0.02em]">Simple, flexible plans</h2>
          <p className="mt-2 max-w-xl text-[13.5px] text-[var(--text-2)]">
            Start free. Upgrade any time — plans are managed centrally and can change without an app update.
          </p>
          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            {plans.map((plan) => {
              const highlight = plan.id === 'pro';
              return (
                <Card
                  key={plan.id}
                  className={`relative p-6 ${highlight ? 'border-[var(--gold)]/60' : ''}`}
                >
                  {highlight ? (
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
                  <Link href="/auth?mode=signup" className="mt-6 block">
                    <Button variant={highlight ? 'primary' : 'secondary'} block>
                      {plan.price_cents === 0 ? 'Start free' : `Choose ${plan.name}`}
                    </Button>
                  </Link>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* Disclaimer + footer */}
      <section className="py-14">
        <div className="mx-auto w-full max-w-[1180px] px-4 sm:px-6">
          <Card className="flex flex-col gap-3 p-6 sm:flex-row sm:items-center">
            <ShieldCheck size={22} className="text-[var(--gold)]" />
            <p className="text-[12.5px] leading-relaxed text-[var(--text-2)]">
              <strong className="text-[var(--text)]">Important:</strong> UK49s draws are random.
              49S Predictor produces statistical analysis of historical data — it does not and cannot
              guarantee outcomes. All metrics shown are real and unedited, including when the model
              performs at or below chance. Play responsibly.
            </p>
          </Card>
        </div>
        <footer className="mx-auto mt-12 flex w-full max-w-[1180px] flex-col gap-3 border-t border-[var(--line)] px-4 pt-8 text-[12px] text-[var(--text-3)] sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>© {new Date().getFullYear()} 49S Predictor. Statistical analysis platform.</span>
          <span>Not affiliated with any lottery operator.</span>
        </footer>
      </section>
    </div>
  );
}