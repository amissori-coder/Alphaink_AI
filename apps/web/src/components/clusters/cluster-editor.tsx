'use client';

import { CLUSTER_TYPE_LABELS } from '@alphaink/shared';
import type { Cluster, ClusterType, FilterGroup } from '@alphaink/shared';
import {
  AlertTriangle,
  ArrowLeft,
  Info,
  Layers,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { ContactPicker } from '@/components/contacts/contact-picker';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ColorPicker } from '@/components/ui/color-picker';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/lib/auth-context';
import { cn, formatDateTimeIt, formatNumber } from '@/lib/utils';

import {
  CLUSTER_COLORS,
  CLUSTER_TYPE_HINTS,
  CLUSTER_TYPE_OPTIONS,
  ROUTES,
  newRuleTree,
} from './constants';
import { ClusterPreviewPanel } from './cluster-preview-panel';
import { RuleBuilder, countConditions } from './rule-builder';
import type { ClusterDraft, ClusterDraftErrors, SaveClusterInput } from './types';
import { useClusterActions } from './use-cluster-actions';
import { useClusterPreview } from './use-cluster-preview';
import { useCluster, useClusters } from './use-clusters-data';

/** Bozza iniziale di un cluster nuovo. */
function emptyDraft(): ClusterDraft {
  return {
    name: '',
    description: '',
    type: 'dynamic',
    color: CLUSTER_COLORS[0] ?? '#00AEEF',
    rules: newRuleTree(),
    contactIds: [],
    siteGroupName: '',
    brevoListId: null,
    autoRefresh: true,
    syncToBrevo: false,
  };
}

/** Converte un cluster salvato nella bozza modificabile dal modulo. */
function toDraft(cluster: Cluster): ClusterDraft {
  return {
    name: cluster.name,
    description: cluster.description ?? '',
    type: cluster.type,
    color: cluster.color,
    rules: cluster.rules ?? newRuleTree(),
    contactIds: cluster.contactIds ?? [],
    siteGroupName: cluster.siteGroupName ?? '',
    brevoListId: cluster.brevoListId ?? null,
    autoRefresh: cluster.autoRefresh,
    syncToBrevo: cluster.syncToBrevo,
  };
}

/** Controlli minimi prima di chiamare il backend. */
function validate(draft: ClusterDraft): ClusterDraftErrors {
  const errors: ClusterDraftErrors = {};
  if (draft.name.trim().length < 2) {
    errors.name = 'Il nome deve avere almeno 2 caratteri.';
  }
  if (draft.type === 'dynamic' && countConditions(draft.rules) === 0) {
    errors.rules =
      'Aggiungi almeno una condizione: senza regole il cluster comprenderebbe tutta la rubrica.';
  }
  if (draft.type === 'static' && draft.contactIds.length === 0) {
    errors.contactIds = 'Scegli almeno un contatto da includere.';
  }
  if (draft.type === 'site_group' && draft.siteGroupName.trim().length === 0) {
    errors.siteGroupName = 'Indica il nome del gruppo cliente su PrestaShop.';
  }
  if (draft.type === 'brevo_list' && (!draft.brevoListId || draft.brevoListId <= 0)) {
    errors.brevoListId = 'Indica l’id numerico della lista Brevo.';
  }
  return errors;
}

export interface ClusterEditorProps {
  /** Assente in creazione. */
  clusterId?: string;
}

/**
 * Costruttore di cluster: modulo a sinistra, anteprima live a destra.
 *
 * La stessa schermata serve la creazione (`/cluster/nuovo`) e la modifica
 * (`/cluster/[id]`): l'unica differenza è che in modifica la bozza viene
 * inizializzata dal documento e compaiono le azioni di ricalcolo ed
 * eliminazione.
 */
export function ClusterEditor({ clusterId }: ClusterEditorProps) {
  const router = useRouter();
  const { can } = useAuth();
  const canWrite = can('clusters:write');

  const { data: cluster, loading, error, exists } = useCluster(clusterId ?? null);
  const { data: allClusters } = useClusters();
  const actions = useClusterActions();

  const [draft, setDraft] = React.useState<ClusterDraft>(emptyDraft);
  const [errors, setErrors] = React.useState<ClusterDraftErrors>({});
  const [dirty, setDirty] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [forceDelete, setForceDelete] = React.useState(false);

  // Inizializzazione dal documento: solo finché l'utente non ha toccato nulla,
  // altrimenti un aggiornamento in tempo reale cancellerebbe le modifiche.
  const hydratedFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!cluster || dirty) return;
    if (hydratedFor.current === cluster.id) return;
    hydratedFor.current = cluster.id;
    setDraft(toDraft(cluster));
  }, [cluster, dirty]);

  const update = React.useCallback((patch: Partial<ClusterDraft>) => {
    setDirty(true);
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

  const setRules = React.useCallback(
    (rules: FilterGroup) => {
      update({ rules });
      setErrors((current) => ({ ...current, rules: undefined }));
    },
    [update],
  );

  const preview = useClusterPreview(draft, canWrite || can('clusters:read'));

  // Opzioni per le condizioni "appartiene al cluster": mai il cluster stesso,
  // altrimenti si creerebbe una regola ricorsiva.
  const clusterOptions: ComboboxOption[] = React.useMemo(
    () =>
      allClusters
        .filter((entry) => entry.id !== clusterId)
        .map((entry) => ({
          value: entry.id,
          label: entry.name,
          description: `${CLUSTER_TYPE_LABELS[entry.type]} · ${formatNumber(entry.contactCount)} contatti`,
        })),
    [allClusters, clusterId],
  );

  const handleSave = async () => {
    const found = validate(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const payload: SaveClusterInput = {
      id: clusterId,
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      type: draft.type,
      color: draft.color,
      rules: draft.type === 'dynamic' ? draft.rules : null,
      contactIds: draft.type === 'static' ? draft.contactIds : [],
      siteGroupName: draft.type === 'site_group' ? draft.siteGroupName.trim() : null,
      brevoListId: draft.type === 'brevo_list' ? draft.brevoListId : null,
      autoRefresh: draft.autoRefresh,
      syncToBrevo: draft.syncToBrevo,
      recompute: true,
    };

    const saved = await actions.save(payload);
    if (!saved) return;
    setDirty(false);
    if (clusterId) {
      hydratedFor.current = null;
    } else {
      router.replace(ROUTES.detail(saved.id));
    }
  };

  if (clusterId && loading) {
    return <ClusterEditorSkeleton />;
  }

  if (clusterId && !loading && !exists) {
    return (
      <EmptyState
        icon={<Layers />}
        title="Cluster non trovato"
        description={
          error?.message ??
          'Il cluster che stai cercando è stato eliminato oppure il link non è più valido.'
        }
        action={
          <Button asChild>
            <Link href={ROUTES.list}>
              <ArrowLeft aria-hidden="true" />
              Torna ai cluster
            </Link>
          </Button>
        }
      />
    );
  }

  const typeHint = CLUSTER_TYPE_HINTS[draft.type];
  const conditionCount = countConditions(draft.rules);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Link
            href={ROUTES.list}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Cluster
          </Link>
        }
        title={clusterId ? draft.name || 'Cluster senza nome' : 'Nuovo cluster'}
        description={
          clusterId && cluster?.lastComputedAt
            ? `Ultimo ricalcolo: ${formatDateTimeIt(cluster.lastComputedAt)} · ${formatNumber(
                cluster.contactCount,
              )} contatti.`
            : 'Definisci le regole e controlla in tempo reale quanti contatti rientrano nel segmento.'
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {clusterId && cluster && canWrite ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={actions.pendingId === cluster.id}
                  onClick={() => void actions.recompute(cluster)}
                >
                  <RefreshCw
                    className={cn(actions.pendingId === cluster.id && 'animate-spin')}
                    aria-hidden="true"
                  />
                  Ricalcola
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => {
                    setForceDelete(false);
                    setDeleteOpen(true);
                  }}
                >
                  <Trash2 aria-hidden="true" />
                  Elimina
                </Button>
              </>
            ) : null}
            <Button type="button" onClick={() => void handleSave()} disabled={!canWrite || actions.saving}>
              <Save aria-hidden="true" />
              {actions.saving ? 'Salvataggio…' : clusterId ? 'Salva le modifiche' : 'Crea il cluster'}
            </Button>
          </div>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>Errore di caricamento</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      ) : null}

      {!canWrite ? (
        <Alert variant="info">
          <Info aria-hidden="true" />
          <AlertTitle>Sola lettura</AlertTitle>
          <AlertDescription>
            Il tuo ruolo non consente di modificare i cluster: puoi consultare le regole e
            l’anteprima, ma non salvare.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Identità del cluster</CardTitle>
              <CardDescription>
                Nome e colore compaiono nei badge dei contatti, nel calendario editoriale e nel
                selettore del pubblico delle newsletter.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="space-y-1.5">
                  <Label htmlFor="cluster-nome">Nome</Label>
                  <Input
                    id="cluster-nome"
                    value={draft.name}
                    disabled={!canWrite}
                    invalid={Boolean(errors.name)}
                    placeholder="es. Clienti toner ultimi 60 giorni"
                    onChange={(event) => {
                      update({ name: event.target.value });
                      setErrors((current) => ({ ...current, name: undefined }));
                    }}
                    aria-describedby={errors.name ? 'cluster-nome-errore' : undefined}
                  />
                  {errors.name ? (
                    <p id="cluster-nome-errore" className="text-xs text-destructive">
                      {errors.name}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  <span className="text-sm font-medium leading-none text-foreground">Colore</span>
                  <ColorPicker
                    value={draft.color}
                    onChange={(color) => update({ color })}
                    swatches={CLUSTER_COLORS}
                    disabled={!canWrite}
                    label="Colore del cluster"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cluster-descrizione">Descrizione</Label>
                <Textarea
                  id="cluster-descrizione"
                  value={draft.description}
                  disabled={!canWrite}
                  rows={2}
                  maxLength={500}
                  placeholder="A cosa serve questo segmento e quando usarlo."
                  onChange={(event) => update({ description: event.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cluster-tipo">Tipo di cluster</Label>
                <Combobox
                  id="cluster-tipo"
                  options={CLUSTER_TYPE_OPTIONS}
                  value={draft.type}
                  onChange={(next) => update({ type: next as ClusterType })}
                  disabled={!canWrite}
                  placeholder="Scegli il tipo"
                  searchPlaceholder="Cerca…"
                  emptyMessage="Nessun tipo disponibile."
                  className="h-9 w-full sm:max-w-md"
                />
                <p className="text-xs text-muted-foreground">{typeHint}</p>
              </div>
            </CardContent>
          </Card>

          {draft.type === 'dynamic' ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Regole di appartenenza</CardTitle>
                <CardDescription>
                  {conditionCount === 0
                    ? 'Nessuna condizione impostata.'
                    : `${formatNumber(conditionCount)} ${
                        conditionCount === 1 ? 'condizione' : 'condizioni'
                      } · i contatti entrano ed escono dal cluster da soli ad ogni ricalcolo.`}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {errors.rules ? (
                  <Alert variant="destructive">
                    <AlertTriangle aria-hidden="true" />
                    <AlertDescription>{errors.rules}</AlertDescription>
                  </Alert>
                ) : null}
                <RuleBuilder
                  value={draft.rules}
                  onChange={setRules}
                  clusterOptions={clusterOptions}
                  disabled={!canWrite}
                />
              </CardContent>
            </Card>
          ) : null}

          {draft.type === 'static' ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Contatti inclusi</CardTitle>
                <CardDescription>
                  Elenco fisso: puoi aggiungere altri contatti anche dalla rubrica, selezionandoli e
                  usando “Aggiungi a un cluster”.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <ContactPicker
                  value={draft.contactIds}
                  onChange={(contactIds) => {
                    update({ contactIds });
                    setErrors((current) => ({ ...current, contactIds: undefined }));
                  }}
                  disabled={!canWrite}
                />
                {errors.contactIds ? (
                  <p className="text-xs text-destructive">{errors.contactIds}</p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {draft.type === 'site_group' ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Gruppo cliente del sito</CardTitle>
                <CardDescription>
                  Il cluster rispecchia il gruppo cliente configurato su PrestaShop: l’appartenenza
                  si aggiorna ad ogni sincronizzazione dell’anagrafica.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-1.5">
                <Label htmlFor="cluster-gruppo">Nome del gruppo</Label>
                <Input
                  id="cluster-gruppo"
                  value={draft.siteGroupName}
                  disabled={!canWrite}
                  invalid={Boolean(errors.siteGroupName)}
                  placeholder="es. Rivenditori"
                  className="sm:max-w-md"
                  onChange={(event) => {
                    update({ siteGroupName: event.target.value });
                    setErrors((current) => ({ ...current, siteGroupName: undefined }));
                  }}
                />
                {errors.siteGroupName ? (
                  <p className="text-xs text-destructive">{errors.siteGroupName}</p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {draft.type === 'brevo_list' ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Lista Brevo</CardTitle>
                <CardDescription>
                  Il cluster rispecchia una lista già esistente su Brevo. L’id numerico si legge
                  nell’URL della lista dentro il pannello Brevo.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-1.5">
                <Label htmlFor="cluster-lista">Id della lista</Label>
                <Input
                  id="cluster-lista"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={draft.brevoListId ?? ''}
                  disabled={!canWrite}
                  invalid={Boolean(errors.brevoListId)}
                  placeholder="es. 12"
                  className="sm:max-w-[12rem]"
                  onChange={(event) => {
                    const parsed = Number.parseInt(event.target.value, 10);
                    update({ brevoListId: Number.isFinite(parsed) ? parsed : null });
                    setErrors((current) => ({ ...current, brevoListId: undefined }));
                  }}
                />
                {errors.brevoListId ? (
                  <p className="text-xs text-destructive">{errors.brevoListId}</p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Aggiornamento e sincronizzazione</CardTitle>
              <CardDescription>
                Come e dove il cluster resta allineato quando la rubrica cambia.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">
                    Ricalcolo automatico
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Il job schedulato rivaluta le regole ogni sei ore. Disattivalo solo per i
                    segmenti che devono restare congelati.
                  </span>
                </span>
                <Switch
                  checked={draft.autoRefresh}
                  disabled={!canWrite || draft.type !== 'dynamic'}
                  onCheckedChange={(checked) => update({ autoRefresh: checked })}
                  aria-label="Ricalcolo automatico del cluster"
                />
              </label>

              <label className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">
                    Sincronizza su Brevo
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Crea e mantiene aggiornata una lista Brevo con gli stessi contatti, utile per
                    gli invii fatti direttamente dal pannello Brevo.
                  </span>
                </span>
                <Switch
                  checked={draft.syncToBrevo}
                  disabled={!canWrite}
                  onCheckedChange={(checked) => update({ syncToBrevo: checked })}
                  aria-label="Sincronizza il cluster come lista Brevo"
                />
              </label>
            </CardContent>
          </Card>
        </div>

        <div className="xl:sticky xl:top-4 xl:h-[calc(100vh-6rem)]">
          <ClusterPreviewPanel
            preview={preview.preview}
            loading={preview.loading}
            error={preview.error}
            stale={preview.stale}
            onRefresh={preview.refresh}
            className="h-full"
          />
        </div>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Eliminare il cluster?"
        description={
          <span className="space-y-2">
            <span className="block">
              {cluster
                ? `“${cluster.name}” verrà rimosso e i ${formatNumber(
                    cluster.contactCount,
                  )} contatti non vi apparterranno più. I contatti non vengono eliminati.`
                : 'Il cluster verrà rimosso: i contatti non vengono eliminati.'}
            </span>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={forceDelete}
                onChange={(event) => setForceDelete(event.target.checked)}
                className="size-4 rounded border-input accent-[hsl(var(--destructive))]"
              />
              Elimina anche se è usato da newsletter o automazioni
            </label>
          </span>
        }
        confirmLabel="Elimina"
        destructive
        onConfirm={async () => {
          if (!cluster) return;
          const done = await actions.remove(cluster, forceDelete);
          if (!done) throw new Error('Eliminazione non riuscita.');
          router.push(ROUTES.list);
        }}
      />
    </div>
  );
}

/** Scheletro mostrato mentre si carica il cluster da modificare. */
export function ClusterEditorSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-9 w-48" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
        <Skeleton className="h-[32rem] w-full" />
      </div>
    </div>
  );
}
