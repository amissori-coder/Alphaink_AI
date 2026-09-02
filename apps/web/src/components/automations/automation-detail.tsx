'use client';

import { AUTOMATION_DESCRIPTIONS, isValidEmail } from '@alphaink/shared';
import {
  BarChart3,
  CircleAlert,
  Clock,
  Info,
  RotateCcw,
  Save,
  Send,
  Undo2,
  Users,
  Workflow,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/lib/auth-context';
import { relativeTimeIt } from '@/lib/utils';

import { AudienceTab } from './audience-tab';
import { LIST_RECENT_LIMIT, REPORT_RANGE_DAYS, ROUTES, automationLabel } from './constants';
import { FlowTab } from './flow-tab';
import { ScheduleTab } from './schedule-tab';
import { SenderTab } from './sender-tab';
import { StatsTab } from './stats-tab';
import { StepEditorDialog, type StepEmailPatch } from './step-editor-dialog';
import { StepPreviewDialog } from './step-preview-dialog';
import { TestModeCard } from './test-mode-card';
import type { AutomationPayload } from './types';
import {
  useResetAutomation,
  useSaveAutomation,
  useToggleAutomation,
} from './use-automation-actions';
import { useAutomationDraft } from './use-automation-draft';
import { useAutomation, useAutomationReport } from './use-automations-data';

/** Controlli minimi che il backend applicherebbe comunque: qui evitano un errore inutile. */
function validate(draft: AutomationPayload): string[] {
  const problems: string[] = [];
  if (draft.name.trim().length < 2) problems.push('Il nome deve avere almeno due caratteri.');
  if (!draft.fromName.trim()) problems.push('Il nome del mittente è obbligatorio.');
  if (!isValidEmail(draft.fromEmail)) problems.push('L’email del mittente non è valida.');
  if (draft.replyTo && !isValidEmail(draft.replyTo)) {
    problems.push('L’indirizzo per le risposte non è valido.');
  }
  if (draft.steps.length === 0) problems.push('Serve almeno uno step.');
  for (const [index, step] of draft.steps.entries()) {
    if (!step.name.trim()) problems.push(`Lo step ${index + 1} non ha un nome.`);
    if (!step.subject.trim()) problems.push(`Lo step «${step.name || index + 1}» non ha un oggetto.`);
  }
  return problems;
}

export interface AutomationDetailProps {
  /** Id del documento: coincide con la chiave dell'automazione. */
  automationId: string;
}

/**
 * Configurazione completa di un'automazione.
 *
 * La bozza resta locale finché non si salva: si può riorganizzare il flusso, i
 * tempi e i contenuti senza toccare un'automazione già in funzione.
 */
export function AutomationDetail({ automationId }: AutomationDetailProps) {
  const { can } = useAuth();
  const canRead = can('automations:read');
  const canWrite = can('automations:write');
  const canToggle = can('automations:toggle');

  const { data: automation, loading, error } = useAutomation(automationId, canRead);
  const { draft, dirty, update, setSteps, updateStep, reset, commit } =
    useAutomationDraft(automation);

  const save = useSaveAutomation({ onSaved: commit });
  const toggle = useToggleAutomation();
  const resetDefaults = useResetAutomation();

  const report = useAutomationReport({
    automationId,
    days: REPORT_RANGE_DAYS,
    recentLimit: LIST_RECENT_LIMIT,
    enabled: canRead,
  });
  const stepReports = React.useMemo(
    () => new Map((report.data?.steps ?? []).map((step) => [step.id, step])),
    [report.data],
  );

  const [editingStepId, setEditingStepId] = React.useState<string | null>(null);
  const [previewStepId, setPreviewStepId] = React.useState<string | null>(null);
  const [confirmReset, setConfirmReset] = React.useState(false);

  const editingStep = draft?.steps.find((step) => step.id === editingStepId) ?? null;
  const previewStep = draft?.steps.find((step) => step.id === previewStepId) ?? null;

  const problems = draft ? validate(draft) : [];
  const canSave = canWrite && draft !== null && dirty && problems.length === 0;

  const persist = React.useCallback(
    async (next: AutomationPayload) => {
      if (!automation) return;
      await save.mutateAsync({ ...next, id: automation.id, key: automation.key });
    },
    [automation, save],
  );

  const handleSave = () => {
    if (!draft) return;
    void persist(draft);
  };

  const handleStepEmailSave = async (patch: StepEmailPatch) => {
    if (!draft || !editingStepId) return;
    const steps = draft.steps.map((step) =>
      step.id === editingStepId
        ? { ...step, document: patch.document, subject: patch.subject, preheader: patch.preheader }
        : step,
    );
    setSteps(steps);
    await persist({ ...draft, steps });
    setEditingStepId(null);
  };

  if (!canRead) {
    return (
      <Alert variant="info">
        <Info aria-hidden="true" />
        <AlertTitle>Automazione non accessibile</AlertTitle>
        <AlertDescription>
          Il tuo ruolo non consente di consultare le automazioni.
        </AlertDescription>
      </Alert>
    );
  }

  if (loading || (!automation && !error)) {
    return (
      <div className="space-y-6" aria-busy="true">
        <div className="space-y-2 border-b border-border pb-4">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-9 w-96 max-w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <CircleAlert aria-hidden="true" />
        <AlertTitle>Impossibile caricare l’automazione</AlertTitle>
        <AlertDescription>{error.message}</AlertDescription>
      </Alert>
    );
  }

  if (!automation || !draft) {
    return (
      <EmptyState
        icon={<Workflow />}
        title="Automazione non trovata"
        description="L’automazione richiesta non esiste o è stata eliminata."
        action={
          <Button asChild>
            <Link href={ROUTES.list}>Torna alle automazioni</Link>
          </Button>
        }
      />
    );
  }

  const label = automationLabel(automation);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Link href={ROUTES.list} className="hover:text-foreground hover:underline">
            Automazioni
          </Link>
        }
        title={label}
        description={
          automation.description || AUTOMATION_DESCRIPTIONS[automation.key] || undefined
        }
        actions={
          <>
            {dirty ? <Badge variant="warning">Modifiche non salvate</Badge> : null}
            <div className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5">
              <Switch
                id="automazione-attiva"
                checked={automation.enabled}
                disabled={!canToggle || toggle.isPending}
                onCheckedChange={(enabled) => toggle.mutate({ automationId: automation.id, enabled })}
              />
              <Label htmlFor="automazione-attiva" className="text-xs">
                {automation.enabled ? 'Attiva' : 'Spenta'}
              </Label>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={reset}
              disabled={!dirty || save.isPending}
            >
              <Undo2 aria-hidden="true" />
              Annulla modifiche
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmReset(true)}
              disabled={!canWrite || resetDefaults.isPending}
            >
              <RotateCcw aria-hidden="true" />
              Ripristina predefinite
            </Button>
            <Button size="sm" onClick={handleSave} disabled={!canSave} loading={save.isPending}>
              <Save aria-hidden="true" />
              Salva
            </Button>
          </>
        }
      />

      {!canWrite ? (
        <Alert variant="info">
          <Info aria-hidden="true" />
          <AlertTitle>Sola lettura</AlertTitle>
          <AlertDescription>
            Il tuo ruolo consente di consultare la configurazione ma non di modificarla.
          </AlertDescription>
        </Alert>
      ) : null}

      {automation.lastError ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>Ultima esecuzione fallita</AlertTitle>
          <AlertDescription>
            {automation.lastError}
            {automation.lastErrorAt ? ` (${relativeTimeIt(automation.lastErrorAt)})` : ''}
          </AlertDescription>
        </Alert>
      ) : null}

      {dirty && problems.length > 0 ? (
        <Alert variant="warning">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>Correggi questi punti prima di salvare</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <Tabs defaultValue="flusso">
        <TabsList variant="underline" className="overflow-x-auto">
          <TabsTrigger value="flusso">
            <Workflow aria-hidden="true" />
            Flusso
          </TabsTrigger>
          <TabsTrigger value="pubblico">
            <Users aria-hidden="true" />
            Pubblico
          </TabsTrigger>
          <TabsTrigger value="programmazione">
            <Clock aria-hidden="true" />
            Programmazione
          </TabsTrigger>
          <TabsTrigger value="mittente">
            <Send aria-hidden="true" />
            Mittente
          </TabsTrigger>
          <TabsTrigger value="statistiche">
            <BarChart3 aria-hidden="true" />
            Statistiche
          </TabsTrigger>
        </TabsList>

        <TabsContent value="flusso" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Identità dell’automazione</CardTitle>
              <CardDescription>
                Nome e descrizione compaiono nell’elenco e nei report interni.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="automazione-nome" required>
                  Nome
                </Label>
                <Input
                  id="automazione-nome"
                  value={draft.name}
                  disabled={!canWrite}
                  maxLength={160}
                  onChange={(event) => update({ name: event.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="automazione-descrizione">Descrizione</Label>
                <Textarea
                  id="automazione-descrizione"
                  value={draft.description ?? ''}
                  disabled={!canWrite}
                  maxLength={600}
                  rows={2}
                  placeholder={AUTOMATION_DESCRIPTIONS[automation.key] ?? ''}
                  onChange={(event) => update({ description: event.target.value || null })}
                />
              </div>
            </CardContent>
          </Card>

          <FlowTab
            draft={draft}
            automationKey={automation.key}
            disabled={!canWrite}
            stepReports={stepReports}
            onStepsChange={setSteps}
            onStepChange={updateStep}
            onEditEmail={(step) => setEditingStepId(step.id)}
            onPreview={(step) => setPreviewStepId(step.id)}
          />

          <TestModeCard
            automationId={automation.id}
            draft={draft}
            dirty={dirty}
            disabled={!canWrite}
            onChange={update}
          />
        </TabsContent>

        <TabsContent value="pubblico">
          <AudienceTab draft={draft} disabled={!canWrite} onChange={update} />
        </TabsContent>

        <TabsContent value="programmazione">
          <ScheduleTab draft={draft} disabled={!canWrite} onChange={update} />
        </TabsContent>

        <TabsContent value="mittente">
          <SenderTab draft={draft} disabled={!canWrite} onChange={update} />
        </TabsContent>

        <TabsContent value="statistiche">
          <StatsTab automationId={automation.id} />
        </TabsContent>
      </Tabs>

      <StepEditorDialog
        open={editingStepId !== null}
        onOpenChange={(open) => {
          if (!open) setEditingStepId(null);
        }}
        step={editingStep}
        automationName={label}
        saving={save.isPending}
        onSave={handleStepEmailSave}
      />

      <StepPreviewDialog
        open={previewStepId !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewStepId(null);
        }}
        automationId={automation.id}
        step={previewStep}
        dirty={dirty}
      />

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Ripristinare le impostazioni predefinite?"
        description="Contenuti, tempi, condizioni e politiche coupon tornano alla configurazione di fabbrica. Lo stato di attivazione e le statistiche restano invariati."
        confirmLabel="Ripristina"
        destructive
        loading={resetDefaults.isPending}
        onConfirm={async () => {
          const restored = await resetDefaults.mutateAsync({
            automationId: automation.id,
            resetAudience: true,
          });
          commit(restored);
        }}
      />
    </div>
  );
}
