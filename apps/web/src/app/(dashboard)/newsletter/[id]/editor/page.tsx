import type { Metadata } from 'next';

import { EditorShell } from '@/components/newsletter/editor-shell';

export const metadata: Metadata = {
  title: 'Editor newsletter',
  description:
    'Editor a blocchi della newsletter, con salvataggio automatico, anteprima e invio di prova.',
};

export default async function NewsletterEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EditorShell newsletterId={id} />;
}
