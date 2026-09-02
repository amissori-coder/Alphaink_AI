'use client';

import { COLLECTIONS, EMPTY_STATS, NEWSLETTER_STATUS_LABELS, safeRate } from '@alphaink/shared';
import type { Newsletter, NewsletterStats } from '@alphaink/shared';
import { limit as limitTo, orderBy } from 'firebase/firestore';
import { ArrowLeft, CircleAlert, GitCompareArrows, Info, Mail } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { EmptyState } from '@/components/ui/empty-state';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/lib/auth-context';
import { useCollectionQuery } from '@/lib/hooks/use-collection';
import { toastWarning } from '@/lib/toast';
import { formatCurrency, formatDateIt, formatNumber, formatPercent } from '@/lib/utils';

import { ComparisonBars, type ComparisonSeries } from './comparison-bars';
import { useAnalyticsPalette } from './palette';
import { useNewsletterReports } from './use-analytics-data';

/** Massimo di newsletter confrontabili: oltre, il colore smette di identificare. */
export const MAX_COMPARED = 5;

type VolumeKey = 'recipients' | 'delivered' | 'uniqueOpened' | 'uniqueClicked';
type RateKey = 'deliveryRate' | 'openRate' | 'clickRate' | 'clickToOpenRate' | 'unsubscribeRate';

const VOLUME_CATEGORIES: Array<{ key: VolumeKey; label: string }> = [
  { key: 'recipients', label: 'Destinatari' },
  { key: 'delivered', label: 'Consegnate' },
  { key: 'uniqueOpened', label: 'Aperture uniche' },
  { key: 'uniqueClicked', label: 'Click unici' },
];

const RATE_CATEGORIES: Array<{ key: RateKey; label: string }> = [
  { key: 'deliveryRate', label: 'Recapito' },
  { key: 'openRate', label: 'Apertura' },
  { key: 'clickRate', label: 'Click' },
  { key: 'clickToOpenRate', label: 'Click su apertura' },
  { key: 'unsubscribeRate', label: 'Disiscrizione' },
];

/** Confronto fra newsletter selezionate, fino a cinque. */
export function NewsletterComparison() {
  const { can } = useAuth();
  const canRead = can('analytics:read');
  const palette = useAnalyticsPalette();
  const fieldId = React.useId();

  const [selected, setSelected] = React.useState<string[]>([]);

  const { data: newsletters, loading: listLoading, error: listError } = useCollectionQuery<Newsletter>(
    COLLECTIONS.newsletters,
    [orderBy('sentAt', 'desc'), limitTo(100)],
    { enabled: canRead, key: 'analytics-confronto' },
  );

  const sentNewsletters = React.useMemo(
    () => newsletters.filter((row) => Boolean(row.sentAt)),
    [newsletters],
  );

  const options: ComboboxOption[] = React.useMemo(
    () =>
      sentNewsletters.map((row) => ({
        value: row.id,
        label: row.name,
        description: `${row.sentAt ? formatDateIt(row.sentAt) : 'Non inviata'} · ${
          NEWSLETTER_STATUS_LABELS[row.status]
        }`,
      })),
    [sentNewsletters],
  );

  const reports = useNewsletterReports(selected, {
    enabled: canRead && selected.length > 0,
    recipientsOnly: true,
  });
  const busy = reports.some((entry) => entry.loading);

  const statsById = React.useMemo(() => {
    const map = new Map<string, NewsletterStats>();
    for (const entry of reports) {
      if (entry.data) map.set(entry.newsletterId, { ...EMPTY_STATS, ...entry.data.stats });
    }
    return map;
  }, [reports]);

  const series: ComparisonSeries[] = React.useMemo(
    () =>
      selected.map((id) => {
        const fromReport = reports.find((entry) => entry.newsletterId === id)?.data?.newsletter;
        const fromList = sentNewsletters.find((row) => row.id === id);
        return { id, label: fromReport?.name ?? fromList?.name ?? id };
      }),
    [selected, reports, sentNewsletters],
  );

  const volumeValue = React.useCallback(
    (category: string, id: string) => statsById.get(id)?.[category as VolumeKey] ?? 0,
    [statsById],
  );
  const rateValue = React.useCallback(
    (category: string, id: string) => statsById.get(id)?.[category as RateKey] ?? 0,
    [statsById],
  );
  const ordersValue = React.useCallback(
    (_category: string, id: string) => statsById.get(id)?.orders ?? 0,
    [statsById],
  );
  const revenueValue = React.useCallback(
    (category: string, id: string) => {
      const stats = statsById.get(id);
      if (!stats) return 0;
      return category === 'revenuePerRecipient'
        ? safeRate(stats.revenue, stats.recipients)
        : stats.revenue;
    },
    [statsById],
  );

  const currency = React.useMemo(() => {
    for (const id of selected) {
      const stats = statsById.get(id);
      if (stats?.currency) return stats.currency;
    }
    return 'EUR';
  }, [selected, statsById]);

  const handleSelection = (next: string | string[]) => {
    const ids = Array.isArray(next) ? next : [next];
    if (ids.length > MAX_COMPARED) {
      toastWarning(`Si possono confrontare al massimo ${MAX_COMPARED} newsletter.`);
      setSelected(ids.slice(0, MAX_COMPARED));
      return;
    }
    setSelected(ids);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Link
            href="/analytics"
            className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
          >
            <ArrowLeft className="size-3" aria-hidden="true" />
            Torna ad Analytics
          </Link>
        }
        title="Confronto fra newsletter"
        description="Metti a confronto fino a cinque campagne inviate e osserva dove cambiano volumi, tassi e risultati commerciali."
      />

      {!canRead ? (
        <Alert variant="info">
          <Info aria-hidden="true" />
          <AlertTitle>Statistiche non disponibili</AlertTitle>
          <AlertDescription>
            Il tuo ruolo non consente di consultare i report di invio.
          </AlertDescription>
        </Alert>
      ) : null}

      {listError ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>Impossibile caricare l’elenco delle newsletter</AlertTitle>
          <AlertDescription>{listError.message}</AlertDescription>
        </Alert>
      ) : null}

      {canRead ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <GitCompareArrows className="size-4 text-primary" aria-hidden="true" />
              Newsletter da confrontare
            </CardTitle>
            <CardDescription>
              Solo le campagne già inviate hanno statistiche consolidate.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Label htmlFor={`${fieldId}-picker`} className="sr-only">
              Newsletter da confrontare
            </Label>
            <Combobox
              id={`${fieldId}-picker`}
              multiple
              options={options}
              value={selected}
              disabled={listLoading || options.length === 0}
              placeholder={
                options.length === 0 ? 'Nessuna newsletter inviata' : 'Seleziona le newsletter…'
              }
              searchPlaceholder="Cerca per nome…"
              emptyMessage="Nessuna newsletter trovata."
              onChange={handleSelection}
            />

            {series.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {series.map((item, index) => (
                  <li key={item.id}>
                    <Badge variant="outline" className="gap-1.5">
                      <span
                        className="size-2 rounded-full"
                        style={{
                          backgroundColor: palette.series[index % palette.series.length],
                        }}
                        aria-hidden="true"
                      />
                      {item.label}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">
                Seleziona almeno una newsletter per vedere il confronto.
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {canRead && selected.length === 0 ? (
        <EmptyState
          icon={<Mail />}
          title="Nessuna newsletter selezionata"
          description="Scegli fino a cinque campagne inviate: i grafici mostrano le stesse metriche affiancate, con un asse per unità di misura."
          action={
            <Button variant="outline" asChild>
              <Link href="/newsletter">Vai alle newsletter</Link>
            </Button>
          }
        />
      ) : null}

      {canRead && selected.length > 0 ? (
        <>
          <div className="grid gap-4 xl:grid-cols-2">
            <ComparisonBars
              title="Volumi di invio"
              description="Destinatari e interazioni in valore assoluto."
              categories={VOLUME_CATEGORIES}
              series={series}
              value={volumeValue}
              loading={busy}
            />
            <ComparisonBars
              title="Tassi"
              description="Percentuali calcolate sulle email effettivamente consegnate."
              categories={RATE_CATEGORIES}
              series={series}
              value={rateValue}
              format="percent"
              loading={busy}
            />
            <ComparisonBars
              title="Ordini attribuiti"
              description="Acquisti ricondotti alla campagna secondo il modello di attribuzione attivo."
              categories={[{ key: 'orders', label: 'Ordini' }]}
              series={series}
              value={ordersValue}
              loading={busy}
              height={240}
            />
            <ComparisonBars
              title="Fatturato attribuito"
              description="Ricavo totale e ricavo medio per destinatario."
              categories={[
                { key: 'revenue', label: 'Fatturato' },
                { key: 'revenuePerRecipient', label: 'Per destinatario' },
              ]}
              series={series}
              value={revenueValue}
              format="currency"
              currency={currency}
              loading={busy}
              height={240}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tabella di confronto</CardTitle>
              <CardDescription>
                Gli stessi valori dei grafici, leggibili anche senza colore.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Newsletter</TableHead>
                      <TableHead className="text-right">Destinatari</TableHead>
                      <TableHead className="text-right">Consegnate</TableHead>
                      <TableHead className="text-right">Apertura</TableHead>
                      <TableHead className="text-right">Click</TableHead>
                      <TableHead className="text-right">Disiscrizioni</TableHead>
                      <TableHead className="text-right">Ordini</TableHead>
                      <TableHead className="text-right">Fatturato</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {series.map((item, index) => {
                      const stats = statsById.get(item.id);
                      return (
                        <TableRow key={item.id}>
                          <TableCell>
                            <span className="flex items-center gap-2">
                              <span
                                className="size-2 shrink-0 rounded-full"
                                style={{
                                  backgroundColor:
                                    palette.series[index % palette.series.length],
                                }}
                                aria-hidden="true"
                              />
                              <Link
                                href={`/newsletter/${item.id}`}
                                className="truncate font-medium text-foreground hover:underline"
                              >
                                {item.label}
                              </Link>
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatNumber(stats?.recipients ?? 0)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatNumber(stats?.delivered ?? 0)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatPercent(stats?.openRate ?? 0)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatPercent(stats?.clickRate ?? 0)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatNumber(stats?.unsubscribed ?? 0)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatNumber(stats?.orders ?? 0)}
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {formatCurrency(stats?.revenue ?? 0, stats?.currency || currency)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
