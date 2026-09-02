'use client';

import {
  PRODUCT_FAMILY_LABELS,
  SITE_SOURCE_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  displayNameFor,
} from '@alphaink/shared';
import type { Cluster, Contact, ProductFamily } from '@alphaink/shared';
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  Globe,
  Layers,
  Mail,
  MailX,
  Phone,
  Printer,
  Send,
  ShieldCheck,
  Tag,
  Trash2,
  UserRound,
  Pencil,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/stat-card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/lib/auth-context';
import { cn, formatCurrency, formatDateIt, formatDateTimeIt, formatNumber } from '@/lib/utils';

import { AddToClusterDialog } from './add-to-cluster-dialog';
import { ContactEmails } from './contact-emails';
import { ContactFormDialog } from './contact-form-dialog';
import { ContactOrders } from './contact-orders';
import { ContactTimeline, buildTimeline } from './contact-timeline';
import { ROUTES } from './constants';
import { EngagementMeter, EngagementTierChip } from './engagement-meter';
import { SendTestDialog } from './send-test-dialog';
import { SegmentBadge, SourceBadge, SubscriptionStatusBadge } from './status-badge';
import { useContactActions } from './use-contact-actions';
import {
  useContact,
  useContactClusters,
  useContactEmails,
  useContactEvents,
  useContactOrders,
  useTestableNewsletters,
} from './use-contacts-data';

/** Riga anagrafica con icona, etichetta e valore. */
function InfoRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <span className="mt-0.5 shrink-0 text-muted-foreground [&_svg]:size-4" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <div className="text-sm text-foreground">{children}</div>
      </div>
    </div>
  );
}

export interface ContactDetailProps {
  contactId: string;
}

/**
 * Scheda completa di un contatto.
 *
 * Ordini, eventi ed email ricevute vengono letti per indirizzo email e non per
 * id: sono le chiavi su cui esistono gli indici Firestore dichiarati nel
 * progetto, e restano valide anche se il contatto viene ricreato dopo una
 * risincronizzazione del sito.
 */
export function ContactDetail({ contactId }: ContactDetailProps) {
  const router = useRouter();
  const { can } = useAuth();
  const canWrite = can('contacts:write');
  const canWriteClusters = can('clusters:write');
  const canSendTest = can('newsletter:write');

  const { data: contact, loading, error, exists } = useContact(contactId);
  const { data: clusters } = useContactClusters();
  const { data: newsletters } = useTestableNewsletters();
  const actions = useContactActions();

  const email = contact?.emailNormalized || contact?.email || null;
  const orders = useContactOrders(email);
  const events = useContactEvents(email);
  const emails = useContactEmails(email);

  const [editOpen, setEditOpen] = React.useState(false);
  const [clusterOpen, setClusterOpen] = React.useState(false);
  const [testOpen, setTestOpen] = React.useState(false);
  const [unsubscribeOpen, setUnsubscribeOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  const newsletterNames = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const newsletter of newsletters) map.set(newsletter.id, newsletter.name);
    return map;
  }, [newsletters]);

  const timeline = React.useMemo(
    () =>
      contact ? buildTimeline(contact, events.data ?? [], orders.data ?? [], newsletterNames) : [],
    [contact, events.data, orders.data, newsletterNames],
  );

  const memberships: Cluster[] = React.useMemo(() => {
    if (!contact) return [];
    const own = new Set([...(contact.clusterIds ?? []), ...(contact.dynamicClusterIds ?? [])]);
    return clusters.filter((cluster) => own.has(cluster.id));
  }, [contact, clusters]);

  if (loading) return <ContactDetailSkeleton />;

  if (!exists || !contact) {
    return (
      <EmptyState
        icon={<UserRound />}
        title="Contatto non trovato"
        description={
          error?.message ??
          'Il contatto che stai cercando è stato eliminato oppure il link non è più valido.'
        }
        action={
          <Button asChild>
            <Link href={ROUTES.list}>
              <ArrowLeft aria-hidden="true" />
              Torna alla rubrica
            </Link>
          </Button>
        }
      />
    );
  }

  const name = displayNameFor({
    firstName: contact.firstName ?? null,
    lastName: contact.lastName ?? null,
    company: contact.company ?? null,
    email: contact.email,
  });

  const familiesBought = Object.entries(contact.stats.ordersByFamily ?? {})
    .filter(([, count]) => (count ?? 0) > 0)
    .sort((left, right) => (right[1] ?? 0) - (left[1] ?? 0));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Link
            href={ROUTES.list}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Contatti
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            {name}
            <SubscriptionStatusBadge status={contact.status} />
            <SegmentBadge segment={contact.segment} />
          </span>
        }
        description={
          <a href={`mailto:${contact.email}`} className="text-primary hover:underline">
            {contact.email}
          </a>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canSendTest ? (
              <Button variant="outline" onClick={() => setTestOpen(true)}>
                <Send aria-hidden="true" />
                Invia email di prova
              </Button>
            ) : null}
            {canWriteClusters ? (
              <Button variant="outline" onClick={() => setClusterOpen(true)}>
                <Layers aria-hidden="true" />
                Aggiungi a un cluster
              </Button>
            ) : null}
            {canWrite ? (
              <>
                {contact.status === 'subscribed' ? (
                  <Button
                    variant="outline"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setUnsubscribeOpen(true)}
                  >
                    <MailX aria-hidden="true" />
                    Disiscrivi
                  </Button>
                ) : null}
                <Button onClick={() => setEditOpen(true)}>
                  <Pencil aria-hidden="true" />
                  Modifica
                </Button>
              </>
            ) : null}
          </div>
        }
      />

      {contact.status === 'blocked' || contact.status === 'bounced' ? (
        <Alert variant="warning">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>Indirizzo non recapitabile</AlertTitle>
          <AlertDescription>
            Lo stato “{SUBSCRIPTION_STATUS_LABELS[contact.status]}” esclude questo contatto da ogni
            invio. È stato impostato da Brevo dopo un rifiuto del server di destinazione o una
            segnalazione di spam: si corregge solo verificando l’indirizzo con il cliente.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Ordini"
          value={formatNumber(contact.stats.ordersCount ?? 0)}
          hint={
            contact.stats.lastOrderAt
              ? `ultimo il ${formatDateIt(contact.stats.lastOrderAt)}`
              : 'nessun acquisto'
          }
        />
        <StatCard
          label="Spesa totale"
          value={formatCurrency(contact.stats.totalSpent ?? 0, 'EUR')}
          hint={
            (contact.stats.averageOrderValue ?? 0) > 0
              ? `scontrino medio ${formatCurrency(contact.stats.averageOrderValue ?? 0, 'EUR')}`
              : undefined
          }
        />
        <StatCard
          label="Email consegnate"
          value={formatNumber(contact.engagement.delivered ?? 0)}
          hint={`${formatNumber(contact.engagement.opened ?? 0)} aperture · ${formatNumber(
            contact.engagement.clicked ?? 0,
          )} click`}
        />
        <StatCard
          label="Engagement"
          value={formatNumber(contact.engagement.engagementScore ?? 0)}
          hint={<EngagementTierChip tier={contact.engagement.engagementTier} />}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[20rem_minmax(0,1fr)]">
        {/* ------------------------- Colonna laterale ------------------------- */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Anagrafica</CardTitle>
            </CardHeader>
            <CardContent className="divide-y divide-border">
              <InfoRow icon={<Mail />} label="Email">
                <a href={`mailto:${contact.email}`} className="break-all hover:underline">
                  {contact.email}
                </a>
              </InfoRow>
              {contact.phone ? (
                <InfoRow icon={<Phone />} label="Telefono">
                  <a href={`tel:${contact.phone}`} className="hover:underline">
                    {contact.phone}
                  </a>
                </InfoRow>
              ) : null}
              {contact.company ? (
                <InfoRow icon={<Building2 />} label="Azienda">
                  {contact.company}
                  {contact.vatNumber ? (
                    <span className="block text-xs text-muted-foreground">
                      P. IVA {contact.vatNumber}
                    </span>
                  ) : null}
                </InfoRow>
              ) : null}
              {contact.city || contact.province || contact.country ? (
                <InfoRow icon={<Globe />} label="Località">
                  {[contact.postcode, contact.city, contact.province, contact.country]
                    .filter(Boolean)
                    .join(' · ')}
                </InfoRow>
              ) : null}
              <InfoRow icon={<Globe />} label="Sorgente">
                <span className="flex flex-wrap gap-1">
                  {(contact.sources ?? [contact.source]).map((source) => (
                    <SourceBadge key={source} source={source} />
                  ))}
                </span>
                {contact.customerGroup ? (
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Gruppo cliente: {contact.customerGroup}
                  </span>
                ) : null}
              </InfoRow>
              {contact.tags.length > 0 ? (
                <InfoRow icon={<Tag />} label="Etichette">
                  <span className="flex flex-wrap gap-1">
                    {contact.tags.map((tag) => (
                      <Badge key={tag} variant="secondary">
                        {tag}
                      </Badge>
                    ))}
                  </span>
                </InfoRow>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="size-4 text-muted-foreground" aria-hidden="true" />
                Consensi
              </CardTitle>
              <CardDescription>Storico dell’autorizzazione all’invio.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Stato attuale</span>
                <SubscriptionStatusBadge status={contact.status} />
              </div>
              <Separator />
              <dl className="space-y-2 text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-muted-foreground">Consenso raccolto</dt>
                  <dd className="text-right text-foreground">
                    {contact.optInAt ? formatDateTimeIt(contact.optInAt) : '—'}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-muted-foreground">Revoca</dt>
                  <dd className="text-right text-foreground">
                    {contact.optOutAt ? formatDateTimeIt(contact.optOutAt) : '—'}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-muted-foreground">Origine</dt>
                  <dd className="max-w-[10rem] text-right text-foreground">
                    {contact.consentSource || '—'}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-muted-foreground">Ultima sincronizzazione</dt>
                  <dd className="text-right text-foreground">
                    {contact.lastSyncAt ? formatDateTimeIt(contact.lastSyncAt) : '—'}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Layers className="size-4 text-muted-foreground" aria-hidden="true" />
                Cluster
              </CardTitle>
              <CardDescription>
                {memberships.length === 0
                  ? 'Il contatto non appartiene ad alcun cluster.'
                  : `Appartiene a ${formatNumber(memberships.length)} ${
                      memberships.length === 1 ? 'cluster' : 'cluster'
                    }.`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {memberships.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Comparirà qui non appena rientrerà nelle regole di un cluster dinamico, oppure se
                  lo aggiungi a un elenco statico.
                </p>
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {memberships.map((cluster) => {
                    const dynamic = (contact.dynamicClusterIds ?? []).includes(cluster.id);
                    return (
                      <li key={cluster.id}>
                        <Link href={ROUTES.clusterDetail(cluster.id)}>
                          <Badge
                            variant="outline"
                            className="hover:bg-muted"
                            style={{ borderColor: `${cluster.color}66` }}
                            title={dynamic ? 'Assegnato dalle regole' : 'Assegnato manualmente'}
                          >
                            <span
                              className="size-1.5 shrink-0 rounded-full"
                              style={{ backgroundColor: cluster.color }}
                              aria-hidden="true"
                            />
                            {cluster.name}
                          </Badge>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Printer className="size-4 text-muted-foreground" aria-hidden="true" />
                Stampanti possedute
              </CardTitle>
              <CardDescription>
                Dedotte dagli acquisti: guidano i coupon sui consumabili compatibili.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {contact.printers.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nessun modello riconosciuto. Verrà dedotto dal primo acquisto di una stampante o di
                  un consumabile con compatibilità dichiarata.
                </p>
              ) : (
                <ul className="space-y-2">
                  {contact.printers.map((printer, index) => (
                    <li
                      key={`${printer.brand}-${printer.model}-${index}`}
                      className="rounded-md border border-border px-3 py-2"
                    >
                      <p className="text-sm font-medium text-foreground">
                        {printer.brand} {printer.model}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {printer.detectedFrom === 'order'
                          ? 'dedotta da un ordine'
                          : printer.detectedFrom === 'manual'
                            ? 'inserita a mano'
                            : 'dedotta dalla compatibilità'}{' '}
                        · {formatDateIt(printer.detectedAt)}
                      </p>
                      {printer.compatibleSkus && printer.compatibleSkus.length > 0 ? (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {formatNumber(printer.compatibleSkus.length)} consumabili compatibili a
                          catalogo
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {familiesBought.length > 0 ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Cosa acquista</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5">
                  {familiesBought.map(([family, count]) => {
                    const spent = contact.stats.spentByFamily?.[family as ProductFamily] ?? 0;
                    return (
                      <li
                        key={family}
                        className="flex items-baseline justify-between gap-2 text-sm"
                      >
                        <span className="text-foreground">
                          {PRODUCT_FAMILY_LABELS[family as ProductFamily] ?? family}
                        </span>
                        <span className="tabular-nums text-muted-foreground">
                          {formatNumber(count ?? 0)} ordini · {formatCurrency(spent, 'EUR')}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {contact.notes ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Note interne</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{contact.notes}</p>
              </CardContent>
            </Card>
          ) : null}

          {canWrite ? (
            <Button
              variant="ghost"
              className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 aria-hidden="true" />
              Elimina il contatto
            </Button>
          ) : null}
        </div>

        {/* --------------------------- Colonna dati --------------------------- */}
        <div className="min-w-0">
          <Card>
            <CardContent className="pt-6">
              <Tabs defaultValue="timeline">
                <TabsList variant="underline" className="w-full">
                  <TabsTrigger value="timeline">Cronologia</TabsTrigger>
                  <TabsTrigger value="ordini">
                    Ordini
                    {(orders.data?.length ?? 0) > 0 ? (
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({formatNumber(orders.data?.length ?? 0)})
                      </span>
                    ) : null}
                  </TabsTrigger>
                  <TabsTrigger value="email">
                    Email ricevute
                    {(emails.data?.length ?? 0) > 0 ? (
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({formatNumber(emails.data?.length ?? 0)})
                      </span>
                    ) : null}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="timeline">
                  <ContactTimeline
                    entries={timeline}
                    loading={events.isLoading || orders.isLoading}
                  />
                </TabsContent>

                <TabsContent value="ordini">
                  <ContactOrders
                    orders={orders.data ?? []}
                    loading={orders.isLoading}
                    error={orders.error}
                    newsletterNames={newsletterNames}
                  />
                </TabsContent>

                <TabsContent value="email">
                  <div className="space-y-3">
                    <ContactEmails
                      emails={emails.data ?? []}
                      loading={emails.isLoading}
                      error={emails.error}
                      newsletterNames={newsletterNames}
                    />
                    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                      <span>
                        Inviate: {formatNumber(contact.engagement.sent ?? 0)} · Consegnate:{' '}
                        {formatNumber(contact.engagement.delivered ?? 0)}
                      </span>
                      <span>
                        Bounce: {formatNumber(contact.engagement.bounced ?? 0)} · Segnalazioni spam:{' '}
                        {formatNumber(contact.engagement.complaints ?? 0)}
                      </span>
                      <span className="flex items-center gap-2">
                        Reattività: <EngagementMeter engagement={contact.engagement} compact />
                      </span>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ------------------------------ Dialoghi ------------------------------ */}

      <ContactFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        contact={contact}
        clusters={clusters}
        busy={actions.pending === 'save'}
        onSubmit={actions.save}
      />

      <AddToClusterDialog
        open={clusterOpen}
        onOpenChange={setClusterOpen}
        contactIds={[contact.id]}
        clusters={clusters}
        busy={actions.pending?.startsWith('cluster:') ?? false}
        onConfirm={(cluster) => actions.addToCluster(cluster, [contact.id])}
      />

      <SendTestDialog
        open={testOpen}
        onOpenChange={setTestOpen}
        contact={contact}
        newsletters={newsletters}
      />

      <ConfirmDialog
        open={unsubscribeOpen}
        onOpenChange={setUnsubscribeOpen}
        title="Disiscrivere il contatto?"
        description={`${contact.email} smetterà di ricevere newsletter e automazioni e verrà aggiunto alla blocklist Brevo. Per rimetterlo in lista servirà un nuovo consenso documentato.`}
        confirmLabel="Disiscrivi"
        destructive
        loading={actions.pending === `unsubscribe:${contact.id}`}
        onConfirm={async () => {
          const done = await actions.unsubscribe(contact);
          if (!done) throw new Error('Disiscrizione non riuscita.');
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Eliminare definitivamente il contatto?"
        description={`${contact.email} verrà rimosso dalla rubrica e da Brevo, insieme alla sua cronologia di invii. Gli ordini restano registrati. Se vuoi solo smettere di scrivergli, usa “Disiscrivi”.`}
        confirmLabel="Elimina"
        destructive
        loading={actions.pending === `delete:${contact.id}`}
        onConfirm={async () => {
          const done = await actions.remove(contact, true);
          if (!done) throw new Error('Eliminazione non riuscita.');
          router.push(ROUTES.list);
        }}
      />
    </div>
  );
}

/** Scheletro mostrato mentre si carica la scheda del contatto. */
export function ContactDetailSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-64" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-24 w-full" />
        ))}
      </div>

      <div className={cn('grid gap-6 xl:grid-cols-[20rem_minmax(0,1fr)]')}>
        <div className="space-y-4">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-52 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
        <Skeleton className="h-[32rem] w-full" />
      </div>
    </div>
  );
}
