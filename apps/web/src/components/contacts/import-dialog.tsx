'use client';

import { isValidEmail, normalizeEmail } from '@alphaink/shared';
import type { Cluster } from '@alphaink/shared';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileSpreadsheet,
  Upload,
  X,
} from 'lucide-react';
import Papa from 'papaparse';
import * as React from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toastError } from '@/lib/toast';
import { bytesToSize, cn, formatNumber } from '@/lib/utils';

import { importContacts } from './api';
import {
  CSV_FIELDS,
  CSV_IGNORE,
  IMPORT_CHUNK_SIZE,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  IMPORT_PREVIEW_ROWS,
  guessField,
  parseSegment,
  parseStatus,
  parseTags,
} from './constants';
import { SubscriptionStatusBadge } from './status-badge';
import type {
  ContactCsvField,
  ImportIssue,
  ImportPreparation,
  ImportRow,
  ImportStep,
  ImportSummary,
} from './types';

/** Mappatura colonna CSV → campo del contatto (o `CSV_IGNORE`). */
type ColumnMapping = Record<string, ContactCsvField | typeof CSV_IGNORE>;

const STEPS: Array<{ id: ImportStep; label: string }> = [
  { id: 'file', label: 'File' },
  { id: 'mappatura', label: 'Colonne e anteprima' },
  { id: 'esecuzione', label: 'Importazione' },
];

const EMPTY_SUMMARY: ImportSummary = {
  total: 0,
  created: 0,
  updated: 0,
  skipped: 0,
  invalid: [],
  warnings: [],
  addedToClusters: [],
};

/** Testo di una cella, sempre come stringa ripulita. */
function cellText(row: Record<string, unknown>, header: string): string {
  const value = row[header];
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/**
 * Trasforma le righe grezze del CSV in righe pronte per la callable.
 *
 * La validazione lato client anticipa quella del backend: l'operatore vede
 * subito quali righe verrebbero scartate e perché, senza aspettare l'esito di
 * un import da migliaia di indirizzi.
 */
function prepareRows(
  raw: Array<Record<string, unknown>>,
  mapping: ColumnMapping,
  defaults: { segment: 'b2c' | 'b2b'; language: string },
): ImportPreparation {
  const columnFor = new Map<ContactCsvField, string>();
  for (const [header, field] of Object.entries(mapping)) {
    if (field !== CSV_IGNORE && !columnFor.has(field)) columnFor.set(field, header);
  }

  const emailColumn = columnFor.get('email');
  const rows: ImportRow[] = [];
  const issues: ImportIssue[] = [];
  const preview: ImportPreparation['preview'] = [];
  const seen = new Map<string, number>();
  let duplicatesInFile = 0;

  raw.forEach((entry, index) => {
    const rowNumber = index + 1;
    const rawEmail = emailColumn ? cellText(entry, emailColumn) : '';
    const email = normalizeEmail(rawEmail);

    if (!email) {
      issues.push({ row: rowNumber, email: rawEmail, reason: 'Indirizzo email mancante' });
      return;
    }
    if (!isValidEmail(email)) {
      issues.push({ row: rowNumber, email: rawEmail, reason: 'Indirizzo email non valido' });
      return;
    }
    const firstSeen = seen.get(email);
    if (firstSeen !== undefined) {
      duplicatesInFile += 1;
      issues.push({
        row: rowNumber,
        email,
        reason: `Duplicato della riga ${firstSeen}: viene importata solo la prima`,
      });
      return;
    }
    seen.set(email, rowNumber);

    const read = (field: ContactCsvField): string => {
      const header = columnFor.get(field);
      return header ? cellText(entry, header) : '';
    };

    const segmentText = read('segment');
    const statusText = read('status');
    const languageText = read('language');
    const tagsText = read('tags');

    const row: ImportRow = {
      email,
      firstName: read('firstName') || null,
      lastName: read('lastName') || null,
      phone: read('phone') || null,
      company: read('company') || null,
      vatNumber: read('vatNumber') || null,
      language: (languageText || defaults.language).slice(0, 5).toLowerCase() || 'it',
      segment: parseSegment(segmentText) ?? defaults.segment,
      tags: tagsText ? parseTags(tagsText) : [],
      clusterIds: [],
      status: parseStatus(statusText) ?? 'subscribed',
      notes: read('notes') || null,
    };

    rows.push(row);
    if (preview.length < IMPORT_PREVIEW_ROWS) preview.push({ row: rowNumber, data: row });
  });

  return { rows, issues, preview, duplicatesInFile };
}

export interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Cluster statici a cui i contatti importati possono essere aggiunti. */
  clusters: Cluster[];
}

/**
 * Import CSV in tre passi: caricamento del file, mappatura delle colonne con
 * anteprima, esecuzione a blocchi con barra di avanzamento.
 *
 * Le righe vengono inviate a `importContacts` in blocchi da 500: il backend
 * accetta al massimo 5.000 righe per chiamata e blocchi più piccoli tengono
 * bassa la latenza percepita, aggiornando la barra a ogni risposta.
 */
export function ImportDialog({ open, onOpenChange, clusters }: ImportDialogProps) {
  const [step, setStep] = React.useState<ImportStep>('file');
  const [fileName, setFileName] = React.useState('');
  const [fileSize, setFileSize] = React.useState(0);
  const [parsing, setParsing] = React.useState(false);
  const [parseError, setParseError] = React.useState<string | null>(null);
  const [headers, setHeaders] = React.useState<string[]>([]);
  const [rawRows, setRawRows] = React.useState<Array<Record<string, unknown>>>([]);
  const [mapping, setMapping] = React.useState<ColumnMapping>({});

  const [updateExisting, setUpdateExisting] = React.useState(true);
  const [targetClusterIds, setTargetClusterIds] = React.useState<string[]>([]);
  const [defaultSegment, setDefaultSegment] = React.useState<'b2c' | 'b2b'>('b2c');

  const [running, setRunning] = React.useState(false);
  const [processed, setProcessed] = React.useState(0);
  const [summary, setSummary] = React.useState<ImportSummary>(EMPTY_SUMMARY);
  const [finished, setFinished] = React.useState(false);

  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);

  const reset = React.useCallback(() => {
    setStep('file');
    setFileName('');
    setFileSize(0);
    setParsing(false);
    setParseError(null);
    setHeaders([]);
    setRawRows([]);
    setMapping({});
    setUpdateExisting(true);
    setTargetClusterIds([]);
    setDefaultSegment('b2c');
    setRunning(false);
    setProcessed(0);
    setSummary(EMPTY_SUMMARY);
    setFinished(false);
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  const handleClose = (next: boolean) => {
    if (running) return;
    onOpenChange(next);
    if (!next) {
      // Il ripristino è differito: evita di svuotare il riepilogo mentre il
      // dialogo sta ancora eseguendo l'animazione di chiusura.
      window.setTimeout(reset, 250);
    }
  };

  const readFile = (file: File) => {
    if (file.size > IMPORT_MAX_BYTES) {
      setParseError(
        `Il file pesa ${bytesToSize(file.size)}: il limite è ${bytesToSize(IMPORT_MAX_BYTES)}. Dividilo in più file.`,
      );
      return;
    }

    setParsing(true);
    setParseError(null);
    setFileName(file.name);
    setFileSize(file.size);

    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      // Il separatore viene dedotto: gli export italiani usano spesso il punto e virgola.
      delimiter: '',
      transformHeader: (header) => header.trim(),
      complete: (result) => {
        setParsing(false);
        const fields = (result.meta.fields ?? []).filter((field) => field.length > 0);
        if (fields.length === 0) {
          setParseError('Il file non ha una riga di intestazione riconoscibile.');
          return;
        }
        const data = result.data.slice(0, IMPORT_MAX_ROWS);
        if (data.length === 0) {
          setParseError('Il file non contiene righe di dati.');
          return;
        }

        const guessed: ColumnMapping = {};
        const used = new Set<ContactCsvField>();
        for (const field of fields) {
          const candidate = guessField(field);
          if (candidate && !used.has(candidate)) {
            guessed[field] = candidate;
            used.add(candidate);
          } else {
            guessed[field] = CSV_IGNORE;
          }
        }

        setHeaders(fields);
        setRawRows(data);
        setMapping(guessed);
        setStep('mappatura');
      },
      error: (error) => {
        setParsing(false);
        setParseError(error.message || 'Lettura del file non riuscita.');
      },
    });
  };

  const preparation = React.useMemo(
    () =>
      step === 'file'
        ? { rows: [], issues: [], preview: [], duplicatesInFile: 0 }
        : prepareRows(rawRows, mapping, { segment: defaultSegment, language: 'it' }),
    [step, rawRows, mapping, defaultSegment],
  );

  const emailMapped = Object.values(mapping).includes('email');
  const clusterOptions: ComboboxOption[] = React.useMemo(
    () =>
      clusters
        .filter((cluster) => cluster.type === 'static')
        .map((cluster) => ({
          value: cluster.id,
          label: cluster.name,
          description: `${formatNumber(cluster.contactCount)} contatti`,
        })),
    [clusters],
  );

  const totalChunks = Math.max(1, Math.ceil(preparation.rows.length / IMPORT_CHUNK_SIZE));
  const progress =
    preparation.rows.length === 0 ? 0 : (processed / preparation.rows.length) * 100;

  const run = async () => {
    if (preparation.rows.length === 0) return;
    setStep('esecuzione');
    setRunning(true);
    setFinished(false);
    setProcessed(0);

    const accumulated: ImportSummary = {
      ...EMPTY_SUMMARY,
      invalid: [...preparation.issues],
      total: preparation.rows.length,
    };
    setSummary(accumulated);

    try {
      for (let index = 0; index < preparation.rows.length; index += IMPORT_CHUNK_SIZE) {
        const chunk = preparation.rows.slice(index, index + IMPORT_CHUNK_SIZE);
        const result = await importContacts({
          rows: chunk,
          addToClusterIds: targetClusterIds,
          updateExisting,
          source: 'csv',
        });

        accumulated.created += result.created;
        accumulated.updated += result.updated;
        accumulated.skipped += result.skipped;
        accumulated.addedToClusters = Array.from(
          new Set([...accumulated.addedToClusters, ...result.addedToClusters]),
        );
        for (const warning of result.warnings) {
          if (!accumulated.warnings.includes(warning)) accumulated.warnings.push(warning);
        }
        for (const invalid of result.invalid) {
          accumulated.invalid.push({
            // Il backend numera le righe del blocco: si riporta al file intero.
            row: index + invalid.row,
            email: invalid.email,
            reason: invalid.reason,
          });
        }

        setProcessed(Math.min(index + chunk.length, preparation.rows.length));
        setSummary({ ...accumulated, invalid: [...accumulated.invalid] });
      }
      setFinished(true);
    } catch (error) {
      toastError(error, 'Importazione interrotta.');
      setSummary({ ...accumulated, invalid: [...accumulated.invalid] });
    } finally {
      setRunning(false);
    }
  };

  const stepIndex = STEPS.findIndex((entry) => entry.id === step);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent size="xl" className="max-h-[92vh]">
        <DialogHeader>
          <DialogTitle>Importa contatti da CSV</DialogTitle>
          <DialogDescription>
            Carica un file esportato dal gestionale, da PrestaShop o da Brevo: le colonne vengono
            riconosciute in automatico e puoi correggerle prima di procedere.
          </DialogDescription>
        </DialogHeader>

        <ol className="flex items-center gap-2" aria-label="Passi dell’importazione">
          {STEPS.map((entry, index) => {
            const active = entry.id === step;
            const done = index < stepIndex;
            return (
              <li key={entry.id} className="flex flex-1 items-center gap-2">
                <span
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
                    active && 'border-primary bg-primary text-primary-foreground',
                    done && 'border-success bg-success/10 text-success',
                    !active && !done && 'border-border text-muted-foreground',
                  )}
                  aria-current={active ? 'step' : undefined}
                >
                  {done ? <CheckCircle2 className="size-3.5" aria-hidden="true" /> : index + 1}
                </span>
                <span
                  className={cn(
                    'truncate text-xs font-medium',
                    active ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {entry.label}
                </span>
                {index < STEPS.length - 1 ? (
                  <span className="h-px flex-1 bg-border" aria-hidden="true" />
                ) : null}
              </li>
            );
          })}
        </ol>

        {/* ------------------------------------------------------------------ */}
        {/* Passo 1 — file                                                     */}
        {/* ------------------------------------------------------------------ */}
        {step === 'file' ? (
          <div className="space-y-3">
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                const file = event.dataTransfer.files?.[0];
                if (file) readFile(file);
              }}
              className={cn(
                'flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors',
                dragging ? 'border-primary bg-primary/5' : 'border-border bg-muted/30',
              )}
            >
              <FileSpreadsheet className="size-8 text-muted-foreground" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  Trascina qui il file CSV oppure scegli dal computer
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Separatore virgola o punto e virgola, prima riga con le intestazioni. Massimo{' '}
                  {formatNumber(IMPORT_MAX_ROWS)} righe e {bytesToSize(IMPORT_MAX_BYTES)}.
                </p>
              </div>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,text/csv,text/plain"
                className="sr-only"
                id="import-file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) readFile(file);
                }}
              />
              <Button
                type="button"
                variant="outline"
                loading={parsing}
                onClick={() => inputRef.current?.click()}
              >
                <Upload aria-hidden="true" />
                Scegli un file
              </Button>
            </div>

            {parseError ? (
              <Alert variant="destructive">
                <AlertTriangle aria-hidden="true" />
                <AlertTitle>File non leggibile</AlertTitle>
                <AlertDescription>{parseError}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        ) : null}

        {/* ------------------------------------------------------------------ */}
        {/* Passo 2 — mappatura e anteprima                                     */}
        {/* ------------------------------------------------------------------ */}
        {step === 'mappatura' ? (
          <div className="min-h-0 space-y-4 overflow-y-auto">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
              <span className="flex items-center gap-2 text-sm">
                <FileSpreadsheet className="size-4 text-muted-foreground" aria-hidden="true" />
                <span className="font-medium text-foreground">{fileName}</span>
                <span className="text-muted-foreground">
                  {formatNumber(rawRows.length)} righe · {bytesToSize(fileSize)}
                </span>
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={reset}>
                <X aria-hidden="true" />
                Cambia file
              </Button>
            </div>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Abbinamento delle colonne</h3>
              <p className="text-xs text-muted-foreground">
                Ogni campo del contatto può essere associato a una sola colonna. Le colonne lasciate
                su “Non importare” vengono ignorate.
              </p>
              <ScrollArea className="max-h-56 rounded-md border border-border">
                <ul className="divide-y divide-border">
                  {headers.map((header) => {
                    const current = mapping[header] ?? CSV_IGNORE;
                    const takenElsewhere = new Set(
                      Object.entries(mapping)
                        .filter(([key, value]) => key !== header && value !== CSV_IGNORE)
                        .map(([, value]) => value as ContactCsvField),
                    );
                    const options: ComboboxOption[] = [
                      { value: CSV_IGNORE, label: 'Non importare' },
                      ...CSV_FIELDS.map((definition) => ({
                        value: definition.field,
                        label: definition.label,
                        description: definition.hint,
                        disabled: takenElsewhere.has(definition.field),
                      })),
                    ];
                    const sample = rawRows.slice(0, 3).map((row) => cellText(row, header)).find(Boolean);

                    return (
                      <li
                        key={header}
                        className="grid items-center gap-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">{header}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {sample ? `es. ${sample}` : 'colonna vuota nelle prime righe'}
                          </p>
                        </div>
                        <Combobox
                          options={options}
                          value={current}
                          onChange={(next) =>
                            setMapping((state) => ({
                              ...state,
                              [header]: next as ContactCsvField | typeof CSV_IGNORE,
                            }))
                          }
                          clearable={false}
                          placeholder="Campo di destinazione"
                          searchPlaceholder="Cerca un campo…"
                          emptyMessage="Nessun campo."
                          className="h-9 w-full"
                          contentClassName="min-w-[16rem]"
                        />
                      </li>
                    );
                  })}
                </ul>
              </ScrollArea>

              {!emailMapped ? (
                <Alert variant="destructive">
                  <AlertTriangle aria-hidden="true" />
                  <AlertTitle>Manca la colonna Email</AlertTitle>
                  <AlertDescription>
                    L’indirizzo email è obbligatorio: è la chiave con cui i contatti vengono
                    riconosciuti ed eventualmente aggiornati.
                  </AlertDescription>
                </Alert>
              ) : null}
            </section>

            {emailMapped ? (
              <>
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground">
                    Anteprima delle prime {IMPORT_PREVIEW_ROWS} righe valide
                  </h3>
                  <div className="overflow-x-auto rounded-md border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">#</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Nome</TableHead>
                          <TableHead>Azienda</TableHead>
                          <TableHead>Segmento</TableHead>
                          <TableHead>Stato</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {preparation.preview.map(({ row, data }) => (
                          <TableRow key={`${row}-${data.email}`}>
                            <TableCell className="text-xs text-muted-foreground">{row}</TableCell>
                            <TableCell className="font-medium">{data.email}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {[data.firstName, data.lastName].filter(Boolean).join(' ') || '—'}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {data.company || '—'}
                            </TableCell>
                            <TableCell className="uppercase text-muted-foreground">
                              {data.segment}
                            </TableCell>
                            <TableCell>
                              <SubscriptionStatusBadge status={data.status} />
                            </TableCell>
                          </TableRow>
                        ))}
                        {preparation.preview.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center text-muted-foreground">
                              Nessuna riga valida con l’abbinamento attuale.
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="flex flex-wrap gap-2 text-xs">
                    <Badge variant="success">
                      {formatNumber(preparation.rows.length)} righe importabili
                    </Badge>
                    {preparation.duplicatesInFile > 0 ? (
                      <Badge variant="warning">
                        {formatNumber(preparation.duplicatesInFile)} duplicati nel file
                      </Badge>
                    ) : null}
                    {preparation.issues.length > 0 ? (
                      <Badge variant="destructive">
                        {formatNumber(preparation.issues.length)} righe scartate
                      </Badge>
                    ) : null}
                  </div>

                  {preparation.issues.length > 0 ? (
                    <details className="rounded-md border border-border">
                      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-foreground">
                        Vedi le righe scartate
                      </summary>
                      <ScrollArea className="max-h-40 border-t border-border">
                        <ul className="divide-y divide-border text-xs">
                          {preparation.issues.slice(0, 200).map((issue, index) => (
                            <li
                              key={`${issue.row}-${index}`}
                              className="flex items-baseline gap-2 px-3 py-1.5"
                            >
                              <span className="w-12 shrink-0 text-muted-foreground">
                                riga {issue.row}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-foreground">
                                {issue.email || '(email vuota)'}
                              </span>
                              <span className="shrink-0 text-destructive">{issue.reason}</span>
                            </li>
                          ))}
                        </ul>
                      </ScrollArea>
                      {preparation.issues.length > 200 ? (
                        <p className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
                          e altre {formatNumber(preparation.issues.length - 200)} righe.
                        </p>
                      ) : null}
                    </details>
                  ) : null}
                </section>

                <section className="space-y-3">
                  <h3 className="text-sm font-semibold text-foreground">Opzioni</h3>

                  <label className="flex items-start gap-3 rounded-md border border-border p-3">
                    <Checkbox
                      checked={updateExisting}
                      onCheckedChange={(checked) => setUpdateExisting(checked === true)}
                      aria-label="Aggiorna i contatti già presenti"
                      className="mt-0.5"
                    />
                    <span>
                      <span className="block text-sm font-medium text-foreground">
                        Aggiorna i contatti già presenti
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        Se disattivo, gli indirizzi già in rubrica vengono saltati senza modifiche.
                        Un contatto disiscritto non viene mai riattivato dall’import.
                      </span>
                    </span>
                  </label>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="import-cluster">Aggiungi a un cluster statico</Label>
                      <Combobox
                        id="import-cluster"
                        multiple
                        options={clusterOptions}
                        value={targetClusterIds}
                        onChange={(next) => setTargetClusterIds(next as string[])}
                        disabled={clusterOptions.length === 0}
                        placeholder={
                          clusterOptions.length === 0
                            ? 'Nessun cluster statico disponibile'
                            : 'Nessuno'
                        }
                        searchPlaceholder="Cerca un cluster…"
                        emptyMessage="Nessun cluster statico."
                        className="h-9 w-full"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="import-segmento">Segmento predefinito</Label>
                      <Combobox
                        id="import-segmento"
                        options={[
                          { value: 'b2c', label: 'B2C — privati' },
                          { value: 'b2b', label: 'B2B — rivenditori' },
                        ]}
                        value={defaultSegment}
                        onChange={(next) => setDefaultSegment(next as 'b2c' | 'b2b')}
                        clearable={false}
                        placeholder="Segmento"
                        searchPlaceholder="Cerca…"
                        emptyMessage="Nessun segmento."
                        className="h-9 w-full"
                      />
                      <p className="text-xs text-muted-foreground">
                        Usato per le righe senza una colonna di segmento riconoscibile.
                      </p>
                    </div>
                  </div>
                </section>
              </>
            ) : null}
          </div>
        ) : null}

        {/* ------------------------------------------------------------------ */}
        {/* Passo 3 — esecuzione e riepilogo                                    */}
        {/* ------------------------------------------------------------------ */}
        {step === 'esecuzione' ? (
          <div className="min-h-0 space-y-4 overflow-y-auto">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {running
                    ? `Importazione in corso… blocco ${Math.min(
                        Math.floor(processed / IMPORT_CHUNK_SIZE) + 1,
                        totalChunks,
                      )} di ${totalChunks}`
                    : finished
                      ? 'Importazione completata.'
                      : 'Importazione interrotta.'}
                </span>
                <span className="font-medium tabular-nums text-foreground">
                  {formatNumber(processed)} / {formatNumber(preparation.rows.length)}
                </span>
              </div>
              <Progress
                value={progress}
                tone={finished ? 'success' : running ? 'primary' : 'warning'}
                aria-label="Avanzamento dell’importazione"
              />
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: 'Creati', value: summary.created, tone: 'text-success' },
                { label: 'Aggiornati', value: summary.updated, tone: 'text-primary' },
                { label: 'Saltati', value: summary.skipped, tone: 'text-muted-foreground' },
                { label: 'Scartati', value: summary.invalid.length, tone: 'text-destructive' },
              ].map((metric) => (
                <div key={metric.label} className="rounded-md border border-border px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {metric.label}
                  </p>
                  <p className={cn('text-xl font-semibold tabular-nums', metric.tone)}>
                    {formatNumber(metric.value)}
                  </p>
                </div>
              ))}
            </div>

            {summary.warnings.length > 0 ? (
              <Alert variant="warning">
                <AlertTriangle aria-hidden="true" />
                <AlertTitle>Avvisi</AlertTitle>
                <AlertDescription>
                  <ul className="list-inside list-disc space-y-1">
                    {summary.warnings.map((warning, index) => (
                      <li key={index}>{warning}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}

            {finished && summary.invalid.length === 0 ? (
              <Alert variant="success">
                <CheckCircle2 aria-hidden="true" />
                <AlertTitle>Tutte le righe sono state importate</AlertTitle>
                <AlertDescription>
                  {formatNumber(summary.created)} contatti creati e{' '}
                  {formatNumber(summary.updated)} aggiornati. I cluster dinamici si aggiorneranno al
                  prossimo ricalcolo.
                </AlertDescription>
              </Alert>
            ) : null}

            {summary.invalid.length > 0 ? (
              <details className="rounded-md border border-border" open={finished}>
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-foreground">
                  {formatNumber(summary.invalid.length)} righe non importate
                </summary>
                <ScrollArea className="max-h-48 border-t border-border">
                  <ul className="divide-y divide-border text-xs">
                    {summary.invalid.slice(0, 300).map((issue, index) => (
                      <li
                        key={`${issue.row}-${index}`}
                        className="flex items-baseline gap-2 px-3 py-1.5"
                      >
                        <span className="w-14 shrink-0 text-muted-foreground">riga {issue.row}</span>
                        <span className="min-w-0 flex-1 truncate text-foreground">
                          {issue.email || '(email vuota)'}
                        </span>
                        <span className="shrink-0 text-destructive">{issue.reason}</span>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              </details>
            ) : null}
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            disabled={running}
            onClick={() => {
              if (step === 'mappatura') reset();
              else handleClose(false);
            }}
          >
            {step === 'mappatura' ? (
              <>
                <ArrowLeft aria-hidden="true" />
                Indietro
              </>
            ) : (
              'Chiudi'
            )}
          </Button>

          {step === 'mappatura' ? (
            <Button
              type="button"
              disabled={!emailMapped || preparation.rows.length === 0}
              onClick={() => void run()}
            >
              Importa {formatNumber(preparation.rows.length)} contatti
              <ArrowRight aria-hidden="true" />
            </Button>
          ) : null}

          {step === 'esecuzione' && !running ? (
            <Button type="button" onClick={() => handleClose(false)}>
              <CheckCircle2 aria-hidden="true" />
              Fine
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
