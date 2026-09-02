import { redirect } from 'next/navigation';

/** La radice non ha contenuti propri: si entra sempre dalla dashboard. */
export default function RootPage(): never {
  redirect('/dashboard');
}
