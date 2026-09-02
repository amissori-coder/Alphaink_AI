'use client';

import type { Automation } from '@alphaink/shared';
import * as React from 'react';

import { toAutomationPayload } from './types';
import type { AutomationPayload, AutomationStepPayload } from './types';

export interface AutomationDraft {
  /** Configurazione in lavorazione; `null` finché il documento non è caricato. */
  draft: AutomationPayload | null;
  /** Vero quando ci sono modifiche non ancora salvate. */
  dirty: boolean;
  /** Applica una modifica parziale alla configurazione. */
  update: (patch: Partial<AutomationPayload>) => void;
  /** Sostituisce l'elenco degli step. */
  setSteps: (steps: AutomationPayload['steps']) => void;
  /** Modifica un singolo step per id. */
  updateStep: (stepId: string, patch: Partial<AutomationStepPayload>) => void;
  /** Riporta la bozza all'ultima versione salvata. */
  reset: () => void;
  /** Adotta come base la versione appena salvata dal server. */
  commit: (automation: Automation) => void;
}

/**
 * Bozza locale della configurazione.
 *
 * Il documento arriva in tempo reale da Firestore: finché non ci sono modifiche
 * pendenti la bozza segue il documento, mentre in presenza di modifiche non
 * salvate resta intoccata — un aggiornamento remoto non deve cancellare il
 * lavoro in corso.
 */
export function useAutomationDraft(automation: Automation | null): AutomationDraft {
  const baseline = React.useMemo(
    () => (automation ? toAutomationPayload(automation) : null),
    [automation],
  );
  const baselineJson = React.useMemo(() => (baseline ? JSON.stringify(baseline) : ''), [baseline]);

  const [draft, setDraft] = React.useState<AutomationPayload | null>(baseline);
  const draftRef = React.useRef<AutomationPayload | null>(draft);
  draftRef.current = draft;
  const savedJsonRef = React.useRef<string>('');

  React.useEffect(() => {
    if (!baseline) return;
    const current = draftRef.current;
    const hasPendingChanges =
      current !== null && savedJsonRef.current !== '' && JSON.stringify(current) !== savedJsonRef.current;
    if (hasPendingChanges) return;
    setDraft(baseline);
    savedJsonRef.current = baselineJson;
  }, [baseline, baselineJson]);

  const dirty =
    draft !== null && savedJsonRef.current !== '' && JSON.stringify(draft) !== savedJsonRef.current;

  const update = React.useCallback((patch: Partial<AutomationPayload>) => {
    setDraft((previous) => (previous ? { ...previous, ...patch } : previous));
  }, []);

  const setSteps = React.useCallback((steps: AutomationPayload['steps']) => {
    setDraft((previous) => (previous ? { ...previous, steps } : previous));
  }, []);

  const updateStep = React.useCallback((stepId: string, patch: Partial<AutomationStepPayload>) => {
    setDraft((previous) => {
      if (!previous) return previous;
      return {
        ...previous,
        steps: previous.steps.map((step) => (step.id === stepId ? { ...step, ...patch } : step)),
      };
    });
  }, []);

  const reset = React.useCallback(() => {
    if (!savedJsonRef.current) return;
    setDraft(JSON.parse(savedJsonRef.current) as AutomationPayload);
  }, []);

  const commit = React.useCallback((saved: Automation) => {
    const payload = toAutomationPayload(saved);
    savedJsonRef.current = JSON.stringify(payload);
    setDraft(payload);
  }, []);

  return { draft, dirty, update, setSteps, updateStep, reset, commit };
}
