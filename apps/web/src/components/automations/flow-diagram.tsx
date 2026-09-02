'use client';

import { PRODUCT_FAMILY_LABELS, formatCurrency } from '@alphaink/shared';
import type { ProductFamily, TriggerConfig } from '@alphaink/shared';
import { ArrowDown, Zap, type LucideIcon } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

import { TRIGGER_DESCRIPTIONS, TRIGGER_LABELS } from './constants';
import { humanizeDelay } from './delay-input';
import type { AutomationStepPayload } from './types';

export interface TriggerNodeProps {
  trigger: TriggerConfig;
  icon?: LucideIcon;
  className?: string;
}

/** Nodo iniziale del flusso: l'evento che arruola il contatto. */
export function TriggerNode({ trigger, icon: Icon = Zap, className }: TriggerNodeProps) {
  const families = (trigger.productFamilies ?? []) as ProductFamily[];
  const skus = trigger.skuPatterns ?? [];
  const categories = trigger.categoryPaths ?? [];

  return (
    <div
      className={cn(
        'rounded-lg border border-primary/30 bg-primary/5 p-4 shadow-card',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary"
          aria-hidden="true"
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-primary">Trigger</p>
          <h3 className="mt-0.5 text-sm font-semibold text-foreground">
            {TRIGGER_LABELS[trigger.type]}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {TRIGGER_DESCRIPTIONS[trigger.type]}
          </p>

          {families.length > 0 ||
          skus.length > 0 ||
          categories.length > 0 ||
          trigger.minOrderTotal ||
          trigger.inactivityDays ? (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {families.map((family) => (
                <li key={`famiglia-${family}`}>
                  <Badge variant="outline">{PRODUCT_FAMILY_LABELS[family] ?? family}</Badge>
                </li>
              ))}
              {skus.map((sku) => (
                <li key={`sku-${sku}`}>
                  <Badge variant="secondary">SKU {sku}</Badge>
                </li>
              ))}
              {categories.map((path) => (
                <li key={`categoria-${path}`}>
                  <Badge variant="secondary">{path}</Badge>
                </li>
              ))}
              {trigger.minOrderTotal ? (
                <li>
                  <Badge variant="outline">
                    Ordine da almeno {formatCurrency(trigger.minOrderTotal)}
                  </Badge>
                </li>
              ) : null}
              {trigger.inactivityDays ? (
                <li>
                  <Badge variant="outline">Inattivo da {trigger.inactivityDays} giorni</Badge>
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export interface FlowDiagramProps {
  trigger: TriggerConfig;
  steps: AutomationStepPayload[];
  /** Contenuto di ogni nodo: di norma una `<StepCard>`. */
  renderStep: (step: AutomationStepPayload, index: number) => React.ReactNode;
  /** Azioni finali, ad esempio "Aggiungi step". */
  footer?: React.ReactNode;
  icon?: LucideIcon;
  className?: string;
}

/**
 * Diagramma verticale del flusso: trigger in cima, poi gli step in ordine di
 * ritardo crescente. Il binario a sinistra tiene insieme i nodi e ogni
 * passaggio dichiara quanto si attende **dal trigger**, non dallo step prima.
 */
export function FlowDiagram({
  trigger,
  steps,
  renderStep,
  footer,
  icon,
  className,
}: FlowDiagramProps) {
  return (
    <div className={cn('relative', className)}>
      {/* Binario verticale: puramente decorativo, l'ordine reale è quello della lista. */}
      <span
        className="absolute left-[15px] top-4 hidden w-px bg-border sm:block"
        style={{ height: 'calc(100% - 2rem)' }}
        aria-hidden="true"
      />

      <ol className="space-y-4">
        <li className="relative sm:pl-12">
          <span
            className="absolute left-0 top-3 hidden size-8 items-center justify-center rounded-full border border-primary/30 bg-card text-primary sm:flex"
            aria-hidden="true"
          >
            <Zap className="size-4" />
          </span>
          <TriggerNode trigger={trigger} icon={icon} />
        </li>

        {steps.map((step, index) => (
          <li key={step.id} className="relative sm:pl-12">
            <span
              className="absolute left-0 top-9 hidden size-8 items-center justify-center rounded-full border border-border bg-card text-xs font-semibold text-foreground sm:flex"
              aria-hidden="true"
            >
              {index + 1}
            </span>

            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <ArrowDown className="size-3.5" aria-hidden="true" />
              {humanizeDelay(step.delay) === 'subito'
                ? 'Invio immediato'
                : `Attendi ${humanizeDelay(step.delay)}`}
            </p>

            {renderStep(step, index)}
          </li>
        ))}
      </ol>

      {footer ? <div className="mt-4 sm:pl-12">{footer}</div> : null}
    </div>
  );
}
