import type { Metadata } from 'next';

import { LoginForm } from '@/components/layout/login-form';

export const metadata: Metadata = {
  title: 'Accedi',
  description:
    'Accedi con email e password oppure con il tuo account Google per gestire le newsletter AlphaInk.',
};

export default function LoginPage() {
  return <LoginForm />;
}
