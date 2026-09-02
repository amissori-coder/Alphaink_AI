'use client';

import {
  AUTOMATION_LABELS,
  type Automation,
  type AutomationKey,
  COLLECTIONS,
  CORE_AUTOMATION_KEYS,
  EMPTY_AUTOMATION_STATS,
} from '@alphaink/shared';
import { TriangleAlert, Workflow } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { DashboardPanel } from '@/components/dashboard/panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/lib/auth-context';
import { useCollectionQuery } from '@/lib/hooks/use-collection';
import { useToggleAutomation } from '@/lib/hooks/use-callables';
import { formatCurrency, formatNumber } from '@/lib/utils';

/** Le automazioni obbligatorie restano in cima, nell'ordine previsto. */
function sortAutomations(rows: Automation[]): Automation[] {
  const rank = (key: AutomationKey) => {
    const index = CORE_AUTOMATION_KEYS.indexOf(key);
    return index === -1 ? CORE_AUTOMATION_KEYS.length : index;
  };
  return [...rows].sort((a, b) => rank(a.key) - rank(b.key) || a.name.localeCompare(b.name, 'it'));
}

export interface AutomationsStatusProps {
  className?: string;
}

/** Stato delle automazioni con attivazione rapida. */
export function AutomationsStatus({ className }: AutomationsStatusProps) {
  const { can } = useAuth();
  const canRead = can('automations:read');
  const canToggle = can('automations:toggle');

  const { data, loading, error } = useCollectionQuery<Automation>(COLLECTIONS.automations, [], {
    enabled: canRead,
    key: 'dashboard-automazioni',
  });

  const toggle = useToggleAutomation();
  const pendingId = toggle.isPending ? toggle.variables?.automationId : undefined;

  const rows = React.useMemo(() => sortAutomations(data), [data]);
  const activeCount = rows.filter((automation) => automation.enabled).length;

  return (
    <DashboardPanel
      className={className}
      icon={<Workflow />}
      title="Stato automazioni"
      description={
        rows.length > 0
          ? `${activeCount} attive su ${rows.length} configurate.`
          : 'Percorsi automatici collegati al comportamento dei clienti.'
      }
      actions={
        canRead ? (
          <Button variant="ghost" size="sm" asChild>
            <Link href="/automazioni">Gestisci</Link>
          </Button>
        ) : null
      }
    >
      {!canRead ? (
        <p className="text-sm text-muted-foreground">Non hai i permessi per vedere le automazioni.</p>
      ) : loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">{error.message}</p>
      ) : rows.length === 0 ? (
        <EmptyState
          compact
          icon={<Workflow />}
          title="Nessuna automazione configurata"
          description="Esegui la configurazione iniziale per creare le quattro automazioni di base."
          action={
            can('settings:write') ? (
              <Button size="sm" asChild>
                <Link href="/impostazioni">Vai alle impostazioni</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((automation) => {
            const stats = { ...EMPTY_AUTOMATION_STATS, ...(automation.stats ?? {}) };
            const label = automation.name || AUTOMATION_LABELS[automation.key] || automation.key;
            const busy = pendingId === automation.id;

            return (
              <li key={automation.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{label}</span>
                    {automation.isCore ? <Badge variant="outline">Core</Badge> : null}
                    {automation.testMode ? <Badge variant="warning">Test</Badge> : null}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {formatNumber(stats.sent)} invii ·{' '}
                    {formatCurrency(stats.revenue, stats.currency || 'EUR')} generati
                  </p>
                  {automation.lastError ? (
                    <p className="mt-1 flex items-center gap-1 truncate text-xs text-destructive">
                      <TriangleAlert className="size-3 shrink-0" aria-hidden="true" />
                      {automation.lastError}
                    </p>
                  ) : null}
                </div>
                <Switch
                  checked={automation.enabled}
                  disabled={!canToggle || busy}
                  aria-label={`${automation.enabled ? 'Disattiva' : 'Attiva'} ${label}`}
                  onCheckedChange={(checked) =>
                    toggle.mutate({ automationId: automation.id, enabled: checked })
                  }
                />
              </li>
            );
          })}
        </ul>
      )}
    </DashboardPanel>
  );
}
