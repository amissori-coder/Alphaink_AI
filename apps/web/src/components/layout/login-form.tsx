'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, Loader2, LogIn, MailCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/auth-context';
import { isFirebaseConfigured } from '@/lib/firebase/client';
import { toastError, toastSuccess } from '@/lib/toast';

const loginSchema = z.object({
  email: z
    .string()
    .min(1, 'Inserisci il tuo indirizzo email.')
    .email('L’indirizzo email non è valido.'),
  password: z
    .string()
    .min(1, 'Inserisci la password.')
    .min(6, 'La password deve contenere almeno 6 caratteri.'),
});

type LoginValues = z.infer<typeof loginSchema>;

/** Percorso interno sicuro: evita redirect verso domini esterni. */
function safeNext(value: string | null): string {
  if (!value) return '/dashboard';
  if (!value.startsWith('/') || value.startsWith('//')) return '/dashboard';
  return value;
}

/**
 * Destinazione dopo l'accesso, letta da `?next=`.
 * Si legge da `window` invece che con `useSearchParams` così la pagina resta
 * statica e il form viene reso anche lato server (nessun lampeggio iniziale).
 */
function readNext(): string {
  if (typeof window === 'undefined') return '/dashboard';
  return safeNext(new URLSearchParams(window.location.search).get('next'));
}

const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
    <path
      fill="#4285F4"
      d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.63h6.46a5.52 5.52 0 0 1-2.4 3.62v3.01h3.88c2.27-2.09 3.58-5.17 3.58-8.81Z"
    />
    <path
      fill="#34A853"
      d="M12 24c3.24 0 5.96-1.08 7.94-2.92l-3.88-3.01c-1.08.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.11A12 12 0 0 0 12 24Z"
    />
    <path
      fill="#FBBC05"
      d="M5.29 14.27a7.2 7.2 0 0 1 0-4.54V6.62H1.28a12 12 0 0 0 0 10.76l4.01-3.11Z"
    />
    <path
      fill="#EA4335"
      d="M12 4.75c1.76 0 3.34.61 4.59 1.8l3.44-3.44C17.95 1.16 15.23 0 12 0A12 12 0 0 0 1.28 6.62l4.01 3.11C6.23 6.86 8.88 4.75 12 4.75Z"
    />
  </svg>
);

/**
 * Form di accesso con email e password oppure account Google.
 * Al termine dell'accesso riporta l'utente alla pagina richiesta (`?next=`).
 */
export function LoginForm() {
  const router = useRouter();
  const { user, loading, signIn, signInWithGoogle, resetPassword } = useAuth();

  const [formError, setFormError] = React.useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = React.useState(false);
  const [resetting, setResetting] = React.useState(false);
  const configured = isFirebaseConfigured();
  const [next] = React.useState(readNext);

  const {
    register,
    handleSubmit,
    getValues,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
    mode: 'onSubmit',
  });

  // Sessione già attiva (o appena creata): si entra nell'area riservata.
  React.useEffect(() => {
    if (!loading && user) router.replace(next);
  }, [loading, user, next, router]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await signIn(values.email, values.password);
      router.replace(next);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Accesso non riuscito. Riprova.');
      setFocus('password');
    }
  });

  const onGoogle = async () => {
    setFormError(null);
    setGoogleLoading(true);
    try {
      await signInWithGoogle();
      router.replace(next);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Accesso con Google non riuscito.');
    } finally {
      setGoogleLoading(false);
    }
  };

  const onResetPassword = async () => {
    const email = getValues('email').trim();
    if (!email) {
      setFormError('Inserisci prima il tuo indirizzo email, poi richiedi il ripristino.');
      setFocus('email');
      return;
    }
    setResetting(true);
    try {
      await resetPassword(email);
      toastSuccess(
        'Email di ripristino inviata.',
        `Controlla la casella ${email} e segui le istruzioni.`,
      );
    } catch (error) {
      toastError(error, 'Impossibile inviare l’email di ripristino.');
    } finally {
      setResetting(false);
    }
  };

  const busy = isSubmitting || googleLoading;

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Accedi</h1>
        <p className="text-sm text-muted-foreground">
          Entra nella suite newsletter di AlphaInk per creare campagne, automazioni e report.
        </p>
      </div>

      {!configured ? (
        <Alert variant="warning">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>Configurazione Firebase mancante</AlertTitle>
          <AlertDescription>
            Le variabili d’ambiente <code className="font-mono text-xs">NEXT_PUBLIC_FIREBASE_*</code>{' '}
            non sono impostate: l’accesso non è disponibile.
          </AlertDescription>
        </Alert>
      ) : null}

      {formError ? (
        <Alert variant="destructive" role="alert">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>Accesso non riuscito</AlertTitle>
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="nome@alphaink.net"
            disabled={!configured || busy}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? 'email-errore' : undefined}
            {...register('email')}
          />
          {errors.email ? (
            <p id="email-errore" className="text-xs font-medium text-destructive">
              {errors.email.message}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="password">Password</Label>
            <button
              type="button"
              onClick={onResetPassword}
              disabled={!configured || resetting}
              className="rounded text-xs font-medium text-primary transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              {resetting ? 'Invio in corso…' : 'Password dimenticata?'}
            </button>
          </div>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            disabled={!configured || busy}
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={errors.password ? 'password-errore' : undefined}
            {...register('password')}
          />
          {errors.password ? (
            <p id="password-errore" className="text-xs font-medium text-destructive">
              {errors.password.message}
            </p>
          ) : null}
        </div>

        <Button type="submit" className="w-full" loading={isSubmitting} disabled={!configured || busy}>
          {isSubmitting ? null : <LogIn aria-hidden="true" />}
          Accedi
        </Button>
      </form>

      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs uppercase tracking-wider text-muted-foreground">oppure</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={onGoogle}
        disabled={!configured || busy}
      >
        {googleLoading ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <GoogleIcon />
        )}
        Accedi con Google
      </Button>

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <MailCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>
          L’accesso è riservato al team AlphaInk. Se non riesci a entrare, chiedi a un amministratore
          di abilitare il tuo indirizzo.
        </span>
      </p>
    </div>
  );
}
