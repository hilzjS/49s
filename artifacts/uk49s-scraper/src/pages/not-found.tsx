import { Link } from 'wouter';
import { Compass } from 'lucide-react';
import { Button, Card } from '@/components/ui';

export default function NotFound() {
  return (
    <div className="app-gradient grid min-h-screen place-items-center px-4">
      <Card className="w-full max-w-md p-8 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-[var(--surface-3)] text-[var(--gold)]">
          <Compass size={22} />
        </div>
        <p className="eyebrow mt-5">Error 404</p>
        <h1 className="mt-1.5 text-[22px] font-semibold">Page not found</h1>
        <p className="mt-2 text-[13px] text-[var(--text-2)]">
          The page you are looking for doesn’t exist or has moved.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link href="/app">
            <Button>Go to app</Button>
          </Link>
          <Link href="/">
            <Button variant="secondary">Back to home</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}