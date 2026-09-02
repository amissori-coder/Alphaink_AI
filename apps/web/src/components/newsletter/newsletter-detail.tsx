'use client';

import { COLLECTIONS, NEWSLETTER_CATEGORY_LABELS } from '@alphaink/shared';
import type { Newsletter } from '@alphaink/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArchiveRestore,
  CalendarClock,
  CalendarX2,
  Copy,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Rocket,
  Send,
  Trash2,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/lib/auth-context';
import { useDocumentQuery } from '@/lib/hooks/use-document';
import { toast, toastError } from '@/lib/toast';
import { formatDateTimeIt, formatNumber, relativeTimeIt } from '@/lib/utils';

import { toNewsletterInput, updateNewsletter } from './api';
import {
  CANCELLABLE_STATUSES,
  DELETABLE_STATUSES,
  EDITABLE_STATUSES,
  NEWSLETTER_QUERY_ROOT,
  PAUSABLE_STATUSES,
  REPORTABLE_STATUSES,
  ROUTES,
  SCHEDULABLE_STATUSES,
  SEND_NOW_STATUSES,
} from './constants';
import { AudiencePicker } from './audience-picker';
import { NewsletterPreview } from './newsletter-preview';
import { NewsletterReport } from './newsletter-report';
import { ScheduleDialog } from './schedule-dialog';
import { SendTestDialog } from './send-test-dialog';
import { StatusBadge } from './status-badge';
import type { AudienceCriteria } from './types';
import { useNewsletterActions } from './use-newsletter-actions';

/** Criteri di pubblico estratti dal documento salvato. */
function audienceOf(newsletter: Newsletter): AudienceCriteria {
  return {
    clusterIds: newsletter.audience?.clusterIds ?? [],
    excludeClusterIds: newsletter.audience?.excludeClusterIds ?? [],
    includeContactIds: newsletter.audience?.includeContactIds ?? [],
    excludeContactIds: newsletter.audience?.excludeContactIds ?? [],
    suppressIfContactedWithinDays: newsletter.audience?.suppressIfContactedWithinDays ?? null,
    suppressIfPurchasedWithinDays: newsletter.audience?.suppressIfPurchasedWithinDays ?? null,
  };
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-sm text-foreground">{children}</dd>
    </div>
  );
}

export interface NewsletterDetailProps {
  newsletterId: string;
}

/**
 * Scheda di una newsletter.
 *
 * Se la spedizione è partita mostra il report completo; altrimenti l'anteprima
 * del contenuto e i comandi per completare la preparazione (pubblico, prova,
 * pianificazione, invio immediato).
 */
export function NewsletterDetail({ newsletterId }: NewsletterDetailProps) {
  const { can } = useAuth();
  const canWrite = can('newsletter:write');
  const canSchedule = can('newsletter:schedule');
  const canSend = can('newsletter:send');

  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: newsletter, loading, error, exists } = useDocumentQuery<Newsletter>(
    COLLECTIONS.newsletters,
    newsletterId,
  );
  const actions = useNewsletterActions();

  const [audience, setAudience] = React.useState<AudienceCriteria | null>(null);
  const [testOpen, setTestOpen] = React.useState(false);
  const [scheduleOpen, setScheduleOpen] = React.useState(false);
  const [sendNowOpen, setSendNowOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  const savedAudience = newsletter ? audienceOf(newsletter) : null;
  const savedSignature = savedAudience ? JSON.stringify(savedAudience) : '';

  // Il documento è in tempo reale: la bozza locale riparte quando cambia.
  React.useEffect(() => {
    if (!savedSignature) return;
    setAudience(JSON.parse(savedSignature) as AudienceCriteria);
  }, [savedSignature]);

  const audienceDirty =
    audience !== null && savedSignature !== '' && JSON.stringify(audience) !== savedSignature;

  const saveAudience = useMutation({ mutationFn: updateNewsletter });

  const handleSaveAudience = async () => {
    if (!newsletter || !audience) return;
    try {
      await saveAudience.mutateAsync({
        ...toNewsletterInput(newsletter),
        newsletterId: newsletter.id,
        audience,
      });
      toast.success('Pubblico aggiornato.');
      void queryClient.invalidateQueries({ queryKey: [...NEWSLETTER_QUERY_ROOT] });
    } catch (caught) {
      toastError(caught, 'Impossibile salvare il pubblico.');
    }
  };

  if (loading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <div className="space-y-2 border-b border-border pb-4">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-28 w-full" />
          ))}
        </div>
        <Skeleton className="h-[420px] w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={<Send />}
        title="Impossibile aprire la newsletter"
        description={error.message}
        action={
          <Button asChild variant="outline">
            <Link href={ROUTES.list}>Torna all’elenco</Link>
          </Button>
        }
      />
    );
  }

  if (!newsletter || !exists) {
    return (
      <EmptyState
        icon={<Send />}
        title="Newsletter non trovata"
        description="Potrebbe essere stata eliminata da un altro utente oppure il collegamento non è più valido."
        action={
          <Button asChild>
            <Link href={ROUTES.list}>Torna all’elenco</Link>
          </Button>
        }
      />
    );
  }

  const busy = actions.pendingId === newsletter.id;
  const editable = EDITABLE_STATUSES.includes(newsletter.status);
  const showReport =
    REPORTABLE_STATUSES.includes(newsletter.status) || newsletter.stats.requested > 0;
  const estimated = newsletter.audience?.estimatedRecipients ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Link href={ROUTES.list} className="hover:underline">
            Newsletter
          </Link>
        }
        title={newsletter.name}
        description={newsletter.subject}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={newsletter.status} />

            {canWrite && editable ? (
              <Button variant="outline" onClick={() => actions.openEditor(newsletter.id)}>
                <Pencil aria-hidden="true" />
                Modifica contenuto
              </Button>
            ) : null}

            {canWrite ? (
              <Button variant="outline" onClick={() => setTestOpen(true)}>
                <Send aria-hidden="true" />
                Invia una prova
              </Button>
            ) : null}

            {canSchedule && SCHEDULABLE_STATUSES.includes(newsletter.status) ? (
              <Button onClick={() => setScheduleOpen(true)}>
                <CalendarClock aria-hidden="true" />
                {newsletter.schedule?.sendAt ? 'Ripianifica' : 'Pianifica l’invio'}
              </Button>
            ) : null}

            {canSend && SEND_NOW_STATUSES.includes(newsletter.status) ? (
              <Button variant="secondary" onClick={() => setSendNowOpen(true)} disabled={busy}>
                <Rocket aria-hidden="true" />
                Invia ora
              </Button>
            ) : null}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Altre azioni" disabled={busy}>
                  <MoreHorizontal aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {canWrite ? (
                  <DropdownMenuItem onSelect={() => void actions.duplicate(newsletter)}>
                    <Copy aria-hidden="true" />
                    Duplica
                  </DropdownMenuItem>
                ) : null}

                {canSchedule && CANCELLABLE_STATUSES.includes(newsletter.status) ? (
                  <DropdownMenuItem onSelect={() => void actions.cancelSchedule(newsletter)}>
                    <CalendarX2 aria-hidden="true" />
                    Annulla la programmazione
                  </DropdownMenuItem>
                ) : null}

                {canSchedule && PAUSABLE_STATUSES.includes(newsletter.status) ? (
                  <DropdownMenuItem onSelect={() => void actions.pause(newsletter)}>
                    <Pause aria-hidden="true" />
                    Metti in pausa
                  </DropdownMenuItem>
                ) : null}

                {canSchedule && newsletter.status === 'paused' ? (
                  <DropdownMenuItem onSelect={() => void actions.resume(newsletter)}>
                    <Play aria-hidden="true" />
                    Riprendi la spedizione
                  </DropdownMenuItem>
                ) : null}

                {canWrite ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => void actions.setArchived(newsletter, !newsletter.archived)}
                    >
                      {newsletter.archived ? (
                        <ArchiveRestore aria-hidden="true" />
                      ) : (
                        <Archive aria-hidden="true" />
                      )}
                      {newsletter.archived ? 'Ripristina' : 'Archivia'}
                    </DropdownMenuItem>
                    {DELETABLE_STATUSES.includes(newsletter.status) ? (
                      <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
                        <Trash2 aria-hidden="true" />
                        Elimina
                      </DropdownMenuItem>
                    ) : null}
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      {newsletter.status === 'failed' && newsletter.failureReason ? (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Ultimo tentativo non riuscito: {newsletter.failureReason}
        </p>
      ) : null}

      <Tabs defaultValue={showReport ? 'report' : 'anteprima'}>
        <TabsList variant="underline">
          {showReport ? <TabsTrigger value="report">Report</TabsTrigger> : null}
          <TabsTrigger value="anteprima">Anteprima</TabsTrigger>
          <TabsTrigger value="pubblico">
            Pubblico
            {audienceDirty ? (
              <span className="ml-1.5 size-1.5 rounded-full bg-warning" aria-hidden="true" />
            ) : null}
          </TabsTrigger>
        </TabsList>

        {showReport ? (
          <TabsContent value="report">
            <NewsletterReport newsletterId={newsletter.id} />
          </TabsContent>
        ) : null}

        <TabsContent value="anteprima">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Anteprima del contenuto</CardTitle>
                <CardDescription>
                  Così apparirà l’email nella casella del destinatario, con i merge tag risolti.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <NewsletterPreview newsletterId={newsletter.id} height={620} />
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Dettagli</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="divide-y divide-border">
                    <InfoRow label="Mittente">
                      {newsletter.fromName}
                      <span className="block text-xs text-muted-foreground">
                        {newsletter.fromEmail}
                      </span>
                    </InfoRow>
                    {newsletter.replyTo ? (
                      <InfoRow label="Risposte a">{newsletter.replyTo}</InfoRow>
                    ) : null}
                    <InfoRow label="Anteprima testo">
                      {newsletter.preheader || (
                        <span className="text-muted-foreground">Non impostata</span>
                      )}
                    </InfoRow>
                    <InfoRow label="Categoria">
                      {newsletter.category ? (
                        <Badge variant="outline">
                          {NEWSLETTER_CATEGORY_LABELS[newsletter.category]}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">Nessuna</span>
                      )}
                    </InfoRow>
                    {(newsletter.tags ?? []).length > 0 ? (
                      <InfoRow label="Etichette">
                        <span className="flex flex-wrap justify-end gap-1">
                          {newsletter.tags.map((tag) => (
                            <Badge key={tag} variant="secondary">
                              {tag}
                            </Badge>
                          ))}
                        </span>
                      </InfoRow>
                    ) : null}
                    <InfoRow label="Destinatari stimati">
                      {estimated > 0 ? (
                        formatNumber(estimated)
                      ) : (
                        <span className="text-muted-foreground">Da calcolare</span>
                      )}
                    </InfoRow>
                    {newsletter.schedule?.sendAt ? (
                      <InfoRow label="Invio previsto">
                        {formatDateTimeIt(newsletter.schedule.sendAt)}
                        <span className="block text-xs text-muted-foreground">
                          {newsletter.schedule.throttle
                            ? `a scaglioni di ${formatNumber(
                                newsletter.schedule.throttle.batchSize,
                              )} ogni ${newsletter.schedule.throttle.intervalMinutes} minuti`
                            : 'in un’unica spedizione'}
                        </span>
                      </InfoRow>
                    ) : null}
                    <InfoRow label="Ultima modifica">
                      {relativeTimeIt(newsletter.updatedAt)}
                    </InfoRow>
                  </dl>
                </CardContent>
              </Card>

              {(newsletter.testSends ?? []).length > 0 ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Invii di prova</CardTitle>
                    <CardDescription>Ultime email di test spedite.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-1.5 text-sm">
                      {[...(newsletter.testSends ?? [])]
                        .slice(-5)
                        .reverse()
                        .map((test, index) => (
                          <li
                            key={`${test.email}-${test.sentAt}-${index}`}
                            className="flex items-center justify-between gap-3"
                          >
                            <span className="truncate text-foreground">{test.email}</span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {relativeTimeIt(test.sentAt)}
                            </span>
                          </li>
                        ))}
                    </ul>
                  </CardContent>
                </Card>
              ) : null}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="pubblico">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 shadow-card">
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Users className="size-4 shrink-0" aria-hidden="true" />
                {editable
                  ? 'Scegli i cluster destinatari: le modifiche vanno salvate prima della pianificazione.'
                  : 'La newsletter non è più modificabile: il pubblico è quello usato per la spedizione.'}
              </p>
              {canWrite && editable ? (
                <div className="flex items-center gap-2">
                  {audienceDirty ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setAudience(audienceOf(newsletter))}
                      disabled={saveAudience.isPending}
                    >
                      Annulla le modifiche
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    onClick={() => void handleSaveAudience()}
                    disabled={!audienceDirty || saveAudience.isPending}
                    loading={saveAudience.isPending}
                  >
                    Salva il pubblico
                  </Button>
                </div>
              ) : null}
            </div>

            {audience ? (
              <AudiencePicker
                value={audience}
                onChange={setAudience}
                disabled={!canWrite || !editable || saveAudience.isPending}
              />
            ) : null}
          </div>
        </TabsContent>
      </Tabs>

      <SendTestDialog open={testOpen} onOpenChange={setTestOpen} newsletter={newsletter} />

      <ScheduleDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        newsletter={newsletter}
      />

      <ConfirmDialog
        open={sendNowOpen}
        onOpenChange={setSendNowOpen}
        title="Inviare subito la newsletter?"
        description={
          estimated > 0
            ? `“${newsletter.name}” verrà spedita immediatamente a circa ${formatNumber(estimated)} destinatari. L’operazione non può essere annullata una volta partita.`
            : `“${newsletter.name}” verrà spedita immediatamente al pubblico configurato. L’operazione non può essere annullata una volta partita.`
        }
        confirmLabel="Invia adesso"
        onConfirm={async () => {
          const done = await actions.sendNow(newsletter);
          if (!done) throw new Error('Invio non riuscito.');
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Eliminare definitivamente la newsletter?"
        description={`“${newsletter.name}” e tutti i dati collegati verranno rimossi. Se vuoi conservarne lo storico, archiviala invece di eliminarla.`}
        confirmLabel="Elimina"
        destructive
        onConfirm={async () => {
          const done = await actions.remove(newsletter);
          if (!done) throw new Error('Eliminazione non riuscita.');
          router.push(ROUTES.list);
        }}
      />
    </div>
  );
}
