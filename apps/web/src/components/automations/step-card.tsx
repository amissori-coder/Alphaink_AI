'use client';

import { CANCEL_CONDITION_LABELS, formatNumber } from '@alphaink/shared';
import type { CancelCondition, CouponPolicy } from '@alphaink/shared';
import {
  Copy,
  Eye,
  MailWarning,
  MoreVertical,
  MousePointerClick,
  PencilLine,
  Send,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

import { CANCEL_CONDITION_OPTIONS } from './constants';
import { CouponPolicyForm } from './coupon-policy-form';
import { DelayInput } from './delay-input';
import type { AutomationStepPayload, AutomationStepReport } from './types';

export interface StepCardProps {
  step: AutomationStepPayload;
  /** Posizione nel flusso, a partire da 1. */
  index: number;
  onChange: (next: AutomationStepPayload) => void;
  onEditEmail: () => void;
  onPreview: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  /** Statistiche dello step nel periodo osservato. */
  report?: AutomationStepReport | null;
  disabled?: boolean;
  /** Falso quando lo step è l'ultimo rimasto: il flusso non può restare vuoto. */
  canRemove?: boolean;
  className?: string;
}

function StatChip({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
      <span className="text-muted-foreground [&_svg]:size-3" aria-hidden="true">
        {icon}
      </span>
      <span className="sr-only">{label}: </span>
      <span className="font-medium tabular-nums text-foreground">{value}</span>
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}

/**
 * Uno step del flusso: ritardo, contenuto, condizioni di annullamento e coupon.
 *
 * Il ritardo è sempre calcolato dal momento del trigger (non dallo step
 * precedente): è la regola del motore e la card la ripete per non indurre
 * errori di configurazione.
 */
export function StepCard({
  step,
  index,
  onChange,
  onEditEmail,
  onPreview,
  onDuplicate,
  onRemove,
  report,
  disabled = false,
  canRemove = true,
  className,
}: StepCardProps) {
  const fieldId = React.useId();
  const missingContent = !step.document && !step.templateId;

  const patch = (changes: Partial<AutomationStepPayload>) => onChange({ ...step, ...changes });

  return (
    <article
      className={cn(
        'rounded-lg border border-border bg-card p-4 shadow-card transition-colors',
        !step.enabled && 'border-dashed opacity-75',
        className,
      )}
      aria-label={`Step ${index}: ${step.name}`}
    >
      <header className="flex items-start gap-3">
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
          aria-hidden="true"
        >
          {index}
        </span>

        <div className="min-w-0 flex-1 space-y-1">
          <Label htmlFor={`${fieldId}-name`} className="sr-only">
            Nome dello step {index}
          </Label>
          <Input
            id={`${fieldId}-name`}
            value={step.name}
            disabled={disabled}
            maxLength={120}
            placeholder="Nome dello step"
            onChange={(event) => patch({ name: event.target.value })}
            className="h-8 border-transparent bg-transparent px-0 text-sm font-semibold shadow-none focus-visible:border-input focus-visible:bg-card focus-visible:px-3"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            {missingContent ? (
              <Badge variant="warning">
                <TriangleAlert aria-hidden="true" />
                Contenuto mancante
              </Badge>
            ) : null}
            {step.templateId && !step.document ? (
              <Badge variant="outline">Da template</Badge>
            ) : null}
            {step.coupon?.enabled ? <Badge variant="default">Con coupon</Badge> : null}
            {!step.enabled ? <Badge variant="secondary">Disattivato</Badge> : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Switch
            checked={step.enabled}
            disabled={disabled}
            aria-label={`${step.enabled ? 'Disattiva' : 'Attiva'} lo step ${step.name}`}
            onCheckedChange={(checked) => patch({ enabled: checked })}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={`Azioni sullo step ${step.name}`}
              >
                <MoreVertical aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onEditEmail} disabled={disabled}>
                <PencilLine aria-hidden="true" />
                Modifica email
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onPreview}>
                <Eye aria-hidden="true" />
                Anteprima
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onDuplicate} disabled={disabled}>
                <Copy aria-hidden="true" />
                Duplica step
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={onRemove}
                disabled={disabled || !canRemove}
              >
                <Trash2 aria-hidden="true" />
                Elimina step
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <DelayInput
          label="Ritardo dal trigger"
          value={step.delay}
          disabled={disabled}
          onChange={(delay) => patch({ delay })}
        />

        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-subject`} className="text-xs font-medium text-muted-foreground">
            Oggetto dell’email
          </Label>
          <Input
            id={`${fieldId}-subject`}
            value={step.subject}
            disabled={disabled}
            maxLength={200}
            placeholder="Es. Un 15% sui consumabili per la tua stampante"
            onChange={(event) => patch({ subject: event.target.value })}
          />
          <p className="text-[11px] text-muted-foreground">
            Sono ammessi i merge tag, ad esempio {'{{contact.firstName}}'}.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-preheader`} className="text-xs font-medium text-muted-foreground">
            Anteprima testuale (preheader)
          </Label>
          <Input
            id={`${fieldId}-preheader`}
            value={step.preheader ?? ''}
            disabled={disabled}
            maxLength={150}
            placeholder="Riga mostrata dopo l’oggetto nella casella di posta"
            onChange={(event) => patch({ preheader: event.target.value || null })}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-cancel`} className="text-xs font-medium text-muted-foreground">
            Annulla l’invio se…
          </Label>
          <Combobox
            id={`${fieldId}-cancel`}
            multiple
            options={CANCEL_CONDITION_OPTIONS}
            value={step.cancelIf ?? []}
            disabled={disabled}
            placeholder="Nessuna condizione"
            searchPlaceholder="Cerca una condizione…"
            emptyMessage="Nessuna condizione trovata."
            onChange={(next) =>
              patch({ cancelIf: (Array.isArray(next) ? next : [next]) as CancelCondition[] })
            }
          />
          <p className="text-[11px] text-muted-foreground">
            {(step.cancelIf ?? []).length === 0
              ? 'L’email parte comunque alla scadenza del ritardo.'
              : (step.cancelIf ?? [])
                  .map((condition) => CANCEL_CONDITION_LABELS[condition])
                  .join(' · ')}
          </p>
        </div>
      </div>

      <CouponPolicyForm
        className="mt-4"
        idPrefix={`${fieldId}-coupon`}
        value={(step.coupon ?? null) as CouponPolicy | null}
        disabled={disabled}
        onChange={(coupon) => patch({ coupon })}
      />

      <footer className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Button variant="outline" size="sm" onClick={onEditEmail} disabled={disabled}>
          <PencilLine aria-hidden="true" />
          Modifica email
        </Button>
        <Button variant="ghost" size="sm" onClick={onPreview}>
          <Eye aria-hidden="true" />
          Anteprima
        </Button>

        {report ? (
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <StatChip
              icon={<Send />}
              label="inviate"
              value={formatNumber(report.stats.sent)}
            />
            <StatChip
              icon={<MailWarning />}
              label="aperte"
              value={formatNumber(report.stats.opened)}
            />
            <StatChip
              icon={<MousePointerClick />}
              label="click"
              value={formatNumber(report.stats.clicked)}
            />
          </div>
        ) : null}
      </footer>
    </article>
  );
}
