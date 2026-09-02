'use client';

import { delayToMinutes, randomId } from '@alphaink/shared';
import type { AutomationKey } from '@alphaink/shared';
import { ArrowDownUp, Info, Plus } from 'lucide-react';
import * as React from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { MAX_STEPS, automationIcon } from './constants';
import { FlowDiagram } from './flow-diagram';
import { StepCard } from './step-card';
import type { AutomationPayload, AutomationStepPayload, AutomationStepReport } from './types';

/** Step vuoto proposto quando si allunga il flusso. */
function newStep(index: number): AutomationStepPayload {
  return {
    id: `step-${randomId(8).toLowerCase()}`,
    name: `Nuovo step ${index}`,
    enabled: false,
    delay: { value: 1, unit: 'days' },
    subject: '',
    preheader: null,
    document: null,
    templateId: null,
    cancelIf: ['contact_unsubscribed'],
    coupon: null,
  };
}

/** Copia profonda di uno step, con nuovo id e nome distinguibile. */
function duplicateStep(step: AutomationStepPayload): AutomationStepPayload {
  const copy = JSON.parse(JSON.stringify(step)) as AutomationStepPayload;
  return {
    ...copy,
    id: `step-${randomId(8).toLowerCase()}`,
    name: `${step.name} (copia)`,
    enabled: false,
  };
}

export interface FlowTabProps {
  draft: AutomationPayload;
  automationKey: AutomationKey;
  disabled?: boolean;
  /** Statistiche per step, indicizzate per id. */
  stepReports?: Map<string, AutomationStepReport>;
  onStepsChange: (steps: AutomationStepPayload[]) => void;
  onStepChange: (stepId: string, patch: Partial<AutomationStepPayload>) => void;
  onEditEmail: (step: AutomationStepPayload) => void;
  onPreview: (step: AutomationStepPayload) => void;
  className?: string;
}

/**
 * Scheda "Flusso": il diagramma verticale dal trigger agli invii.
 *
 * Ogni ritardo è calcolato dal momento del trigger, non dallo step precedente:
 * per questo l'ordine di visualizzazione può essere riallineato con il pulsante
 * di riordino invece di essere imposto a ogni modifica.
 */
export function FlowTab({
  draft,
  automationKey,
  disabled = false,
  stepReports,
  onStepsChange,
  onStepChange,
  onEditEmail,
  onPreview,
  className,
}: FlowTabProps) {
  const steps = draft.steps;
  const outOfOrder = React.useMemo(
    () =>
      steps.some(
        (step, index) =>
          index > 0 && delayToMinutes(step.delay) < delayToMinutes(steps[index - 1]!.delay),
      ),
    [steps],
  );

  const handleAdd = () => {
    if (steps.length >= MAX_STEPS) return;
    onStepsChange([...steps, newStep(steps.length + 1)]);
  };

  const handleDuplicate = (step: AutomationStepPayload) => {
    if (steps.length >= MAX_STEPS) return;
    const index = steps.findIndex((row) => row.id === step.id);
    const copy = duplicateStep(step);
    const next = [...steps];
    next.splice(index + 1, 0, copy);
    onStepsChange(next);
  };

  const handleRemove = (step: AutomationStepPayload) => {
    if (steps.length <= 1) return;
    onStepsChange(steps.filter((row) => row.id !== step.id));
  };

  const handleSort = () => {
    onStepsChange(
      [...steps].sort((a, b) => delayToMinutes(a.delay) - delayToMinutes(b.delay)),
    );
  };

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {steps.length} {steps.length === 1 ? 'step configurato' : 'step configurati'} su{' '}
          {MAX_STEPS} disponibili.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={handleSort}
          disabled={disabled || steps.length < 2}
        >
          <ArrowDownUp aria-hidden="true" />
          Riordina per ritardo
        </Button>
      </div>

      {outOfOrder ? (
        <Alert variant="info">
          <Info aria-hidden="true" />
          <AlertTitle>Gli step non sono in ordine di tempo</AlertTitle>
          <AlertDescription>
            I ritardi si misurano sempre dal trigger: usa «Riordina per ritardo» per leggere il
            flusso nella sequenza reale di invio.
          </AlertDescription>
        </Alert>
      ) : null}

      <FlowDiagram
        trigger={draft.trigger}
        steps={steps}
        icon={automationIcon(automationKey)}
        renderStep={(step, index) => (
          <StepCard
            step={step}
            index={index + 1}
            disabled={disabled}
            canRemove={steps.length > 1}
            report={stepReports?.get(step.id) ?? null}
            onChange={(next) => onStepChange(step.id, next)}
            onEditEmail={() => onEditEmail(step)}
            onPreview={() => onPreview(step)}
            onDuplicate={() => handleDuplicate(step)}
            onRemove={() => handleRemove(step)}
          />
        )}
        footer={
          <Button
            variant="outline"
            onClick={handleAdd}
            disabled={disabled || steps.length >= MAX_STEPS}
          >
            <Plus aria-hidden="true" />
            Aggiungi step
          </Button>
        }
      />
    </div>
  );
}
