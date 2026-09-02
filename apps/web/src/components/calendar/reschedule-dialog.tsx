'use client';

import { CalendarClock, TriangleAlert } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import { TimePicker } from '@/components/ui/time-picker';
import { formatDateTimeIt } from '@/lib/utils';

import type { CalendarItem } from './types';
import { formatTime } from './utils';

export interface RescheduleDialogProps {
  item: CalendarItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Riceve il nuovo istante di invio in formato ISO. */
  onConfirm: (sendAt: string) => void | Promise<void>;
  pending?: boolean;
}

/** Tolleranza di un minuto, coerente con il controllo lato server. */
const MIN_LEAD_MS = 60_000;

/** Dialogo di ripianificazione: alternativa accessibile al trascinamento. */
export function RescheduleDialog({
  item,
  open,
  onOpenChange,
  onConfirm,
  pending = false,
}: RescheduleDialogProps) {
  const [date, setDate] = React.useState<string | null>(null);
  const [time, setTime] = React.useState<string>('09:00');
  const itemId = item?.id ?? null;

  // La voce è ricostruita a ogni aggiornamento dei dati: si legge da un ref
  // così i campi si riallineano solo all'apertura o al cambio di newsletter,
  // senza sovrascrivere quello che l'utente sta scegliendo.
  const itemRef = React.useRef(item);
  itemRef.current = item;

  React.useEffect(() => {
    const current = itemRef.current;
    if (!open || !current) return;
    setDate(current.date);
    setTime(formatTime(current.date));
  }, [itemId, open]);

  const combined = React.useMemo(() => {
    if (!date) return null;
    const base = new Date(date);
    if (Number.isNaN(base.getTime())) return null;
    const [hours, minutes] = time.split(':').map((part) => Number.parseInt(part, 10));
    base.setHours(Number.isFinite(hours) ? hours : 9, Number.isFinite(minutes) ? minutes : 0, 0, 0);
    return base;
  }, [date, time]);

  const inPast = combined ? combined.getTime() < Date.now() - MIN_LEAD_MS : false;
  const canConfirm = Boolean(combined) && !inPast && !pending;

  const handleConfirm = () => {
    if (!combined || inPast) return;
    void onConfirm(combined.toISOString());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="size-4 text-primary" aria-hidden="true" />
            Ripianifica invio
          </DialogTitle>
          <DialogDescription>
            {item
              ? `Scegli quando inviare “${item.title}”. L’orario è quello italiano.`
              : 'Scegli la nuova data di invio.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ripianifica-data">Data</Label>
            <DatePicker
              id="ripianifica-data"
              value={date}
              onChange={setDate}
              clearable={false}
              minDate={new Date()}
              invalid={inPast}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ripianifica-ora">Orario</Label>
            <TimePicker id="ripianifica-ora" value={time} onChange={setTime} step={15} invalid={inPast} />
          </div>
        </div>

        {item?.date ? (
          <p className="text-xs text-muted-foreground">
            Programmazione attuale: {formatDateTimeIt(item.date)}
          </p>
        ) : null}

        {inPast ? (
          <p className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
            La data scelta è nel passato: seleziona un momento futuro.
          </p>
        ) : combined ? (
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            Nuovo invio previsto per <strong className="text-foreground">{formatDateTimeIt(combined)}</strong>.
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Annulla
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm} loading={pending}>
            Sposta invio
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
