'use client';

import { CalendarClock, Gauge, Globe2, MoonStar } from 'lucide-react';
import * as React from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { TimePicker } from '@/components/ui/time-picker';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';

import { ALL_WEEKDAYS, TIMEZONE_OPTIONS, WEEKDAY_OPTIONS } from './constants';
import type { AutomationPayload } from './types';

const DEFAULT_QUIET_HOURS = { start: '21:00', end: '08:00' };

export interface ScheduleTabProps {
  draft: AutomationPayload;
  disabled?: boolean;
  onChange: (patch: Partial<AutomationPayload>) => void;
  className?: string;
}

/**
 * Scheda "Programmazione": quando è lecito spedire.
 *
 * Un invio che cade fuori dalle finestre consentite non viene perso: il motore
 * lo rimanda al primo momento utile.
 */
export function ScheduleTab({ draft, disabled = false, onChange, className }: ScheduleTabProps) {
  const fieldId = React.useId();
  const quietHours = draft.quietHours ?? null;
  const weekdays = draft.allowedWeekdays ?? ALL_WEEKDAYS;

  return (
    <div className={cn('space-y-4', className)}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MoonStar className="size-4 text-primary" aria-hidden="true" />
            Fascia di silenzio
          </CardTitle>
          <CardDescription>
            Nessun invio in questa fascia oraria locale: le email in scadenza vengono rimandate al
            termine della finestra.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3">
            <Switch
              id={`${fieldId}-quiet`}
              checked={Boolean(quietHours)}
              disabled={disabled}
              onCheckedChange={(checked) =>
                onChange({ quietHours: checked ? { ...DEFAULT_QUIET_HOURS } : null })
              }
            />
            <div className="min-w-0">
              <Label htmlFor={`${fieldId}-quiet`} className="text-sm">
                Rispetta una fascia di silenzio
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Consigliata la notte: evita di svegliare la casella dei clienti e migliora
                l’apertura.
              </p>
            </div>
          </div>

          {quietHours ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${fieldId}-quiet-start`}>Inizio</Label>
                <TimePicker
                  id={`${fieldId}-quiet-start`}
                  value={quietHours.start}
                  disabled={disabled}
                  step={30}
                  onChange={(start) => onChange({ quietHours: { ...quietHours, start } })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${fieldId}-quiet-end`}>Fine</Label>
                <TimePicker
                  id={`${fieldId}-quiet-end`}
                  value={quietHours.end}
                  disabled={disabled}
                  step={30}
                  onChange={(end) => onChange({ quietHours: { ...quietHours, end } })}
                />
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="size-4 text-primary" aria-hidden="true" />
            Giorni consentiti
          </CardTitle>
          <CardDescription>
            Nei giorni non selezionati gli invii restano in attesa. Deve restare selezionato almeno
            un giorno.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ToggleGroup
            type="multiple"
            size="sm"
            className="flex-wrap justify-start"
            value={weekdays.map(String)}
            disabled={disabled}
            aria-label="Giorni della settimana consentiti"
            onValueChange={(next: string[]) => {
              if (next.length === 0) return;
              onChange({ allowedWeekdays: next.map((value) => Number(value)).sort() });
            }}
          >
            {WEEKDAY_OPTIONS.map((day) => (
              <ToggleGroupItem key={day.value} value={String(day.value)} className="px-3">
                <span className="sr-only">{day.label}</span>
                <span aria-hidden="true">{day.short}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Gauge className="size-4 text-primary" aria-hidden="true" />
              Limite di invii all’ora
            </CardTitle>
            <CardDescription>
              Distribuisce le partenze per non saturare la reputazione del dominio.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5">
            <Label htmlFor={`${fieldId}-max-hour`} className="sr-only">
              Limite di invii all’ora
            </Label>
            <Input
              id={`${fieldId}-max-hour`}
              type="number"
              inputMode="numeric"
              min={1}
              max={100000}
              step={10}
              value={draft.maxSendsPerHour === null || draft.maxSendsPerHour === undefined ? '' : String(draft.maxSendsPerHour)}
              disabled={disabled}
              placeholder="Nessun limite"
              endIcon={<span className="text-xs">/ ora</span>}
              className="tabular-nums"
              onChange={(event) => {
                const raw = event.target.value.trim();
                if (!raw) {
                  onChange({ maxSendsPerHour: null });
                  return;
                }
                const parsed = Number.parseInt(raw, 10);
                onChange({
                  maxSendsPerHour: Number.isFinite(parsed)
                    ? Math.min(Math.max(parsed, 1), 100_000)
                    : null,
                });
              }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Globe2 className="size-4 text-primary" aria-hidden="true" />
              Fuso orario
            </CardTitle>
            <CardDescription>
              Riferimento di fascia di silenzio, giorni consentiti e statistiche giornaliere.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5">
            <Label htmlFor={`${fieldId}-timezone`} className="sr-only">
              Fuso orario
            </Label>
            <Select
              value={draft.timezone}
              disabled={disabled}
              onValueChange={(timezone) => onChange({ timezone })}
            >
              <SelectTrigger id={`${fieldId}-timezone`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONE_OPTIONS.some((option) => option.value === draft.timezone) ? null : (
                  <SelectItem value={draft.timezone}>{draft.timezone}</SelectItem>
                )}
                {TIMEZONE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
