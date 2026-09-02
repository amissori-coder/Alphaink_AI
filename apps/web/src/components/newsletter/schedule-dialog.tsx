'use client';

import type { Newsletter } from '@alphaink/shared';
import { useMutation } from '@tanstack/react-query';
import { CalendarClock, Info, TriangleAlert } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { TimePicker } from '@/components/ui/time-picker';
import { toast, toastError } from '@/lib/toast';
import { cn, formatNumber } from '@/lib/utils';

import { scheduleNewsletter } from './api';
import {
  BUSINESS_TIMEZONE,
  DEFAULT_QUIET_HOURS,
  DEFAULT_SEND_TIME,
  THROTTLE_PRESETS,
  TIMEZONE_OPTIONS,
} from './constants';
export interface ScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  newsletter: Newsletter | null;
  /** Invocata dopo una pianificazione riuscita. */
  onScheduled?: (newsletter: Newsletter) => void;
}

// -----------------------------------------------------------------------------
// Conversione fra orario locale del fuso scelto e istante UTC
// -----------------------------------------------------------------------------

/** Scarto in minuti fra il fuso indicato e UTC, all'istante dato. */
function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = formatter.formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  // `hour` può valere 24 a mezzanotte con hour12:false in alcuni motori.
  const hour = read('hour') % 24;
  const asUtc = Date.UTC(read('year'), read('month') - 1, read('day'), hour, read('minute'), read('second'));
  return (asUtc - instant.getTime()) / 60_000;
}

/** Istante UTC corrispondente a una data e a un orario letti nel fuso scelto. */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
  timeZone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, hours, minutes, 0, 0);
  const firstGuess = naive - zoneOffsetMinutes(new Date(naive), timeZone) * 60_000;
  // Secondo passaggio: copre i cambi di ora legale a cavallo dell'istante.
  const refined = naive - zoneOffsetMinutes(new Date(firstGuess), timeZone) * 60_000;
  return new Date(refined);
}

/** Data e ora formattate nel fuso scelto, in italiano esteso. */
function formatInZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('it-IT', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(instant);
}

function parseTime(value: string): { hours: number; minutes: number } {
  const [rawHours, rawMinutes] = value.split(':');
  const hours = Number.parseInt(rawHours ?? '9', 10);
  const minutes = Number.parseInt(rawMinutes ?? '0', 10);
  return {
    hours: Number.isFinite(hours) ? Math.min(Math.max(hours, 0), 23) : 9,
    minutes: Number.isFinite(minutes) ? Math.min(Math.max(minutes, 0), 59) : 0,
  };
}

/** Anno, mese (1-12) e giorno di un istante, letti nel fuso indicato. */
function civilDateInZone(
  instant: Date,
  timeZone: string,
): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  return { year: read('year'), month: read('month'), day: read('day') };
}

/**
 * Valore da dare al `DatePicker`, che ragiona sempre nell'orario del browser.
 *
 * La data scelta appartiene al fuso selezionato, non a quello del browser: per
 * non farla slittare di un giorno quando i due fusi divergono, il giorno civile
 * viene codificato come mezzogiorno locale — l'ora più lontana da entrambi i
 * bordi del giorno — e riletto poi con `getFullYear/getMonth/getDate`.
 * `Date` normalizza da sé un giorno fuori scala (es. 32 gennaio).
 */
function civilDateToPickerValue(year: number, month: number, day: number): string {
  return new Date(year, month - 1, day, 12, 0, 0, 0).toISOString();
}

/** Orario "HH:mm" di un istante, letto nel fuso indicato. */
function timeInZone(instant: Date, timeZone: string): string {
  const formatted = new Intl.DateTimeFormat('it-IT', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(instant);
  // Alcuni motori restituiscono "24:05" a cavallo della mezzanotte.
  return formatted.startsWith('24:') ? `00:${formatted.slice(3)}` : formatted;
}

// -----------------------------------------------------------------------------

/**
 * Dialogo di pianificazione dell'invio.
 *
 * Data e ora sono interpretate nel fuso scelto e convertite in un istante UTC,
 * l'unico formato che il backend accetta. Il riepilogo in fondo racconta a
 * parole quello che succederà, così l'operatore verifica prima di confermare.
 */
export function ScheduleDialog({
  open,
  onOpenChange,
  newsletter,
  onScheduled,
}: ScheduleDialogProps) {
  const [date, setDate] = React.useState<string | null>(null);
  const [time, setTime] = React.useState(DEFAULT_SEND_TIME);
  const [timezone, setTimezone] = React.useState<string>(BUSINESS_TIMEZONE);
  const [throttleOn, setThrottleOn] = React.useState(false);
  const [batchSize, setBatchSize] = React.useState(2000);
  const [intervalMinutes, setIntervalMinutes] = React.useState(15);
  const [quietOn, setQuietOn] = React.useState(false);
  const [quietStart, setQuietStart] = React.useState<string>(DEFAULT_QUIET_HOURS.start);
  const [quietEnd, setQuietEnd] = React.useState<string>(DEFAULT_QUIET_HOURS.end);
  const [optimize, setOptimize] = React.useState(false);

  const schedule = newsletter?.schedule ?? null;

  // La newsletter arriva da una sottoscrizione in tempo reale: il riferimento
  // evita che un aggiornamento del documento azzeri il modulo mentre è aperto.
  const scheduleRef = React.useRef(schedule);
  scheduleRef.current = schedule;

  // Alla riapertura si riparte sempre dai valori salvati sulla newsletter.
  React.useEffect(() => {
    if (!open) return;
    const schedule = scheduleRef.current;
    const zone = schedule?.timezone || BUSINESS_TIMEZONE;
    setTimezone(zone);

    if (schedule?.sendAt) {
      const instant = new Date(schedule.sendAt);
      if (!Number.isNaN(instant.getTime())) {
        // Data e ora vanno lette nello stesso fuso, altrimenti riaprire il
        // dialogo mostrerebbe il giorno del browser accanto all'ora del fuso
        // scelto e la conferma sposterebbe l'invio di un giorno.
        const civil = civilDateInZone(instant, zone);
        setDate(civilDateToPickerValue(civil.year, civil.month, civil.day));
        setTime(timeInZone(instant, zone));
      }
    } else {
      // Domani nel fuso scelto, non in quello del browser.
      const today = civilDateInZone(new Date(), zone);
      setDate(civilDateToPickerValue(today.year, today.month, today.day + 1));
      setTime(DEFAULT_SEND_TIME);
    }

    setThrottleOn(Boolean(schedule?.throttle));
    setBatchSize(schedule?.throttle?.batchSize ?? 2000);
    setIntervalMinutes(schedule?.throttle?.intervalMinutes ?? 15);
    setQuietOn(Boolean(schedule?.quietHours));
    setQuietStart(schedule?.quietHours?.start ?? DEFAULT_QUIET_HOURS.start);
    setQuietEnd(schedule?.quietHours?.end ?? DEFAULT_QUIET_HOURS.end);
    setOptimize(Boolean(schedule?.optimizeSendTime));
  }, [open]);

  // Primo giorno selezionabile: "oggi" nel fuso scelto, non in quello del
  // browser. Dipende da `open` perché la pagina può restare aperta oltre la
  // mezzanotte: a ogni riapertura del dialogo il limite viene ricalcolato.
  const minDate = React.useMemo(() => {
    if (!open) return undefined;
    const today = civilDateInZone(new Date(), timezone);
    return new Date(today.year, today.month - 1, today.day, 12, 0, 0, 0);
  }, [open, timezone]);

  const sendAt = React.useMemo(() => {
    if (!date) return null;
    // `date` contiene il giorno civile del fuso scelto codificato come
    // mezzogiorno locale: anno, mese e giorno si rileggono quindi con i
    // getter locali, e l'orario resta quello impostato nel fuso scelto.
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) return null;
    const { hours, minutes } = parseTime(time);
    return zonedTimeToUtc(
      parsed.getFullYear(),
      parsed.getMonth() + 1,
      parsed.getDate(),
      hours,
      minutes,
      timezone,
    );
  }, [date, time, timezone]);

  const inThePast = sendAt !== null && sendAt.getTime() < Date.now() - 60_000;
  const estimated = newsletter?.audience?.estimatedRecipients ?? 0;

  const batches =
    throttleOn && batchSize > 0 && estimated > 0 ? Math.ceil(estimated / batchSize) : 0;
  const totalMinutes = batches > 1 ? (batches - 1) * intervalMinutes : 0;

  const mutation = useMutation({ mutationFn: scheduleNewsletter });

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!newsletter || !sendAt || inThePast || mutation.isPending) return;

    try {
      const result = await mutation.mutateAsync({
        newsletterId: newsletter.id,
        sendAt: sendAt.toISOString(),
        timezone,
        throttle: throttleOn
          ? {
              batchSize: Math.min(Math.max(Math.round(batchSize), 50), 50_000),
              intervalMinutes: Math.min(Math.max(Math.round(intervalMinutes), 1), 1440),
            }
          : null,
        quietHours: quietOn ? { start: quietStart, end: quietEnd } : null,
        optimizeSendTime: optimize,
      });

      const notices = result.warnings.filter((warning) => warning.severity === 'avviso');
      toast.success(`Invio pianificato per ${formatInZone(sendAt, timezone)}.`, {
        description: `${formatNumber(result.estimatedRecipients)} destinatari stimati${
          notices.length > 0 ? ` · ${notices[0]?.message ?? ''}` : ''
        }`,
      });
      onScheduled?.(result.newsletter);
      onOpenChange(false);
    } catch (error) {
      toastError(error, 'Impossibile pianificare l’invio.');
    }
  };

  const busy = mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogContent size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarClock className="size-4 text-primary" aria-hidden="true" />
              Pianifica l’invio
            </DialogTitle>
            <DialogDescription>
              {newsletter
                ? `“${newsletter.name}” verrà spedita automaticamente al momento indicato.`
                : 'Seleziona una newsletter da pianificare.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="pianifica-data">Data</Label>
              <DatePicker
                id="pianifica-data"
                value={date}
                onChange={setDate}
                minDate={minDate}
                clearable={false}
                invalid={inThePast}
                disabled={busy}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pianifica-ora">Orario</Label>
              <TimePicker
                id="pianifica-ora"
                value={time}
                onChange={setTime}
                step={15}
                disabled={busy}
                invalid={inThePast}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pianifica-fuso">Fuso orario</Label>
              <Select value={timezone} onValueChange={setTimezone} disabled={busy}>
                <SelectTrigger id="pianifica-fuso">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {inThePast ? (
            <p className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
              Il momento scelto è già passato: indica una data futura.
            </p>
          ) : null}

          <Separator />

          {/* Invio scaglionato --------------------------------------------- */}
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <Label htmlFor="pianifica-scaglioni" className="text-sm font-medium">
                  Invio scaglionato
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Distribuisce la spedizione nel tempo per non saturare il server e la reputazione
                  del dominio.
                </p>
              </div>
              <Switch
                id="pianifica-scaglioni"
                checked={throttleOn}
                onCheckedChange={setThrottleOn}
                disabled={busy}
              />
            </div>

            {throttleOn ? (
              <div className="space-y-3 rounded-lg border border-border p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="pianifica-batch">Destinatari per scaglione</Label>
                    <Input
                      id="pianifica-batch"
                      type="number"
                      min={50}
                      max={50000}
                      step={50}
                      value={batchSize}
                      onChange={(event) => setBatchSize(Number(event.target.value))}
                      disabled={busy}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pianifica-intervallo">Intervallo (minuti)</Label>
                    <Input
                      id="pianifica-intervallo"
                      type="number"
                      min={1}
                      max={1440}
                      value={intervalMinutes}
                      onChange={(event) => setIntervalMinutes(Number(event.target.value))}
                      disabled={busy}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {THROTTLE_PRESETS.map((preset) => (
                    <Button
                      key={preset.label}
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        setBatchSize(preset.batchSize);
                        setIntervalMinutes(preset.intervalMinutes);
                      }}
                      className={cn(
                        batchSize === preset.batchSize &&
                          intervalMinutes === preset.intervalMinutes &&
                          'border-primary text-primary',
                      )}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {/* Fascia di silenzio -------------------------------------------- */}
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <Label htmlFor="pianifica-silenzio" className="text-sm font-medium">
                  Fascia di silenzio
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Gli scaglioni che cadono in questa fascia vengono rimandati all’orario utile
                  successivo.
                </p>
              </div>
              <Switch
                id="pianifica-silenzio"
                checked={quietOn}
                onCheckedChange={setQuietOn}
                disabled={busy}
              />
            </div>

            {quietOn ? (
              <div className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="pianifica-silenzio-inizio">Inizio</Label>
                  <TimePicker
                    id="pianifica-silenzio-inizio"
                    value={quietStart}
                    onChange={setQuietStart}
                    step={30}
                    disabled={busy}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pianifica-silenzio-fine">Fine</Label>
                  <TimePicker
                    id="pianifica-silenzio-fine"
                    value={quietEnd}
                    onChange={setQuietEnd}
                    step={30}
                    disabled={busy}
                  />
                </div>
              </div>
            ) : null}
          </div>

          {/* Ottimizzazione oraria ----------------------------------------- */}
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Label htmlFor="pianifica-ottimizza" className="text-sm font-medium">
                Ottimizza l’orario di invio
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Ogni contatto riceve l’email nella fascia in cui apre più spesso, entro le 24 ore
                successive al momento pianificato.
              </p>
            </div>
            <Switch
              id="pianifica-ottimizza"
              checked={optimize}
              onCheckedChange={setOptimize}
              disabled={busy}
            />
          </div>

          {/* Riepilogo ------------------------------------------------------ */}
          <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              {sendAt ? (
                <>
                  Verrà inviata <strong className="text-foreground">{formatInZone(sendAt, timezone)}</strong>
                  {throttleOn
                    ? `, a scaglioni di ${formatNumber(batchSize)} destinatari ogni ${formatNumber(
                        intervalMinutes,
                      )} minuti`
                    : ', in un’unica spedizione'}
                  {batches > 1
                    ? ` (${formatNumber(batches)} scaglioni, circa ${formatNumber(
                        Math.round(totalMinutes / 60),
                      )} ore per completare)`
                    : ''}
                  .
                  {quietOn
                    ? ` Nessun invio fra le ${quietStart} e le ${quietEnd}.`
                    : ''}
                  {optimize ? ' L’orario verrà adattato alle abitudini di ciascun contatto.' : ''}
                  {estimated > 0
                    ? ` Destinatari stimati: ${formatNumber(estimated)}.`
                    : ' La stima dei destinatari verrà calcolata alla conferma.'}
                </>
              ) : (
                'Scegli una data per vedere il riepilogo dell’invio.'
              )}
            </span>
          </p>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Annulla
            </Button>
            <Button type="submit" disabled={!newsletter || !sendAt || inThePast || busy} loading={busy}>
              Pianifica l’invio
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
