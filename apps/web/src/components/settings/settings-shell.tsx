'use client';

/**
 * Elementi di impaginazione condivisi da tutte le sezioni delle Impostazioni:
 * riquadri, righe campo con etichetta ed errore, barra di salvataggio e
 * indicatori di stato. Tenere qui la struttura evita che ogni scheda inventi
 * spaziature diverse.
 */

import { AlertCircle, Check, Copy, Eye, Loader2, RotateCcw, Save, X } from 'lucide-react';
import * as React from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

// -----------------------------------------------------------------------------
// Riquadro di sezione
// -----------------------------------------------------------------------------

export interface SettingsSectionProps {
  title: string;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  /** Azioni a destra dell'intestazione. */
  actions?: React.ReactNode;
  /** Contenuto in fondo al riquadro (barra di salvataggio, note). */
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}

export function SettingsSection({
  title,
  description,
  icon,
  actions,
  footer,
  children,
  className,
  contentClassName,
}: SettingsSectionProps) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="gap-1">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            {icon ? (
              <span
                className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary [&_svg]:size-4"
                aria-hidden="true"
              >
                {icon}
              </span>
            ) : null}
            <div className="min-w-0 space-y-1">
              <CardTitle className="text-base">{title}</CardTitle>
              {description ? <CardDescription>{description}</CardDescription> : null}
            </div>
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      </CardHeader>
      <CardContent className={cn('space-y-5', contentClassName)}>{children}</CardContent>
      {footer ? (
        <div className="border-t border-border bg-muted/40 px-6 py-3">{footer}</div>
      ) : null}
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Riga di campo
// -----------------------------------------------------------------------------

export interface SettingsFieldProps {
  /** Id del controllo: collega etichetta, descrizione ed errore. */
  htmlFor?: string;
  label: React.ReactNode;
  description?: React.ReactNode;
  error?: string | null;
  required?: boolean;
  /** Occupa l'intera larghezza nella griglia a due colonne. */
  wide?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function SettingsField({
  htmlFor,
  label,
  description,
  error,
  required,
  wide,
  className,
  children,
}: SettingsFieldProps) {
  const describedBy = htmlFor ? `${htmlFor}-descrizione` : undefined;
  const errorId = htmlFor ? `${htmlFor}-errore` : undefined;

  return (
    <div className={cn('space-y-1.5', wide && 'sm:col-span-2', className)}>
      <Label htmlFor={htmlFor} className="flex items-center gap-1">
        {label}
        {required ? (
          <span className="text-destructive" aria-hidden="true">
            *
          </span>
        ) : null}
      </Label>
      {children}
      {description ? (
        <p id={describedBy} className="text-xs text-muted-foreground">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="flex items-center gap-1 text-xs font-medium text-destructive">
          <AlertCircle className="size-3.5" aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Griglia responsiva a due colonne usata dentro i riquadri. */
export function SettingsGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn('grid gap-4 sm:grid-cols-2', className)}>{children}</div>;
}

/** Riga con interruttore, etichetta e descrizione. */
export interface ToggleRowProps {
  id: string;
  label: React.ReactNode;
  description?: React.ReactNode;
  control: React.ReactNode;
  className?: string;
}

export function ToggleRow({ id, label, description, control, className }: ToggleRowProps) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 rounded-lg border border-border bg-card p-3',
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        <Label htmlFor={id} className="cursor-pointer">
          {label}
        </Label>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <div className="shrink-0 pt-0.5">{control}</div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Barra di salvataggio
// -----------------------------------------------------------------------------

export interface SaveBarProps {
  dirty: boolean;
  saving: boolean;
  /** Disabilita il salvataggio (permessi mancanti). */
  disabled?: boolean;
  onSave: () => void;
  onReset: () => void;
  /** Testo informativo a sinistra (es. ultimo salvataggio). */
  hint?: React.ReactNode;
  saveLabel?: string;
  /** Azione aggiuntiva mostrata a sinistra del salvataggio. */
  extraActions?: React.ReactNode;
}

export function SaveBar({
  dirty,
  saving,
  disabled = false,
  onSave,
  onReset,
  hint,
  saveLabel = 'Salva modifiche',
  extraActions,
}: SaveBarProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-muted-foreground" role="status">
        {disabled ? (
          'Non hai i permessi per modificare questa sezione.'
        ) : dirty ? (
          <span className="flex items-center gap-1.5 font-medium text-warning-foreground">
            <span className="size-1.5 rounded-full bg-warning" aria-hidden="true" />
            Modifiche non salvate
          </span>
        ) : (
          hint ?? 'Tutte le modifiche sono salvate.'
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {extraActions}
        <Button variant="ghost" size="sm" onClick={onReset} disabled={!dirty || saving || disabled}>
          <RotateCcw aria-hidden="true" />
          Annulla
        </Button>
        <Button size="sm" onClick={onSave} loading={saving} disabled={disabled || (!dirty && !saving)}>
          {saving ? null : <Save aria-hidden="true" />}
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Indicatori
// -----------------------------------------------------------------------------

/** Pallino di stato "configurato / da configurare". */
export function ConfiguredBadge({
  configured,
  configuredLabel = 'Configurato',
  missingLabel = 'Da configurare',
}: {
  configured: boolean;
  configuredLabel?: string;
  missingLabel?: string;
}) {
  return (
    <Badge variant={configured ? 'success' : 'warning'}>
      {configured ? <Check aria-hidden="true" /> : <AlertCircle aria-hidden="true" />}
      {configured ? configuredLabel : missingLabel}
    </Badge>
  );
}

/** Esito di una verifica: riquadro verde o rosso con il messaggio del server. */
export function CheckResult({
  ok,
  message,
  className,
}: {
  ok: boolean;
  message: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-md border p-3 text-sm',
        ok ? 'border-success/30 bg-success/10' : 'border-destructive/30 bg-destructive/5',
        className,
      )}
      role="status"
    >
      {ok ? (
        <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
      ) : (
        <X className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
      )}
      <span className="min-w-0 break-words text-foreground">{message}</span>
    </div>
  );
}

/** Avviso mostrato a chi può solo consultare le impostazioni. */
export function ReadOnlyNotice({ className }: { className?: string }) {
  return (
    <Alert variant="info" className={className}>
      <Eye aria-hidden="true" />
      <AlertTitle>Sola lettura</AlertTitle>
      <AlertDescription>
        Il tuo ruolo consente di consultare la configurazione ma non di modificarla. Chiedi a un
        amministratore di AlphaInk le modifiche necessarie.
      </AlertDescription>
    </Alert>
  );
}

/** Riquadro d'errore uniforme per i caricamenti falliti. */
export function LoadError({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <AlertCircle aria-hidden="true" />
      <AlertTitle>Impossibile caricare le impostazioni</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

/** Scheletro di una sezione in caricamento. */
export function SectionSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Card aria-busy="true">
      <CardHeader className="gap-2">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: rows * 2 }).map((_, index) => (
          <div key={index} className="space-y-2">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** Indicatore compatto di operazione in corso. */
export function InlineSpinner({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
      {label}
    </span>
  );
}

// -----------------------------------------------------------------------------
// Copia negli appunti
// -----------------------------------------------------------------------------

export interface CopyButtonProps {
  value: string;
  /** Etichetta accessibile e testo del suggerimento. */
  label?: string;
  size?: 'sm' | 'default' | 'icon';
  variant?: 'ghost' | 'outline' | 'secondary';
  className?: string;
  children?: React.ReactNode;
}

/**
 * Copia un valore negli appunti mostrando una spunta per due secondi.
 * `navigator.clipboard` non è disponibile in contesti non sicuri: in quel caso
 * si ricade sulla selezione manuale del testo, senza rompere nulla.
 */
export function CopyButton({
  value,
  label = 'Copia negli appunti',
  size = 'icon',
  variant = 'ghost',
  className,
  children,
}: CopyButtonProps) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Contesto non sicuro o permesso negato: il valore resta selezionabile.
      setCopied(false);
    }
  };

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={handleCopy}
      aria-label={label}
      title={label}
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {children}
    </Button>
  );
}
