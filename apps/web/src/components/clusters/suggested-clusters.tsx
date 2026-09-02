'use client';

import type { Cluster } from '@alphaink/shared';
import { Plus, Sparkles } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import { suggestedClusters } from './constants';
import type { SuggestedCluster } from './types';

export interface SuggestedClustersProps {
  /** Cluster già presenti: servono a nascondere i suggerimenti già creati. */
  existing: Cluster[];
  canWrite: boolean;
  pendingKey: string | null;
  onCreate: (suggestion: SuggestedCluster) => void;
}

/** Confronto tollerante: maiuscole, accenti e spazi non devono creare doppioni. */
function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Segmenti pronti all'uso che AlphaInk usa quasi sempre.
 * Vengono proposti solo finché non esiste già un cluster con lo stesso nome:
 * una volta creato, il suggerimento sparisce e il cluster si modifica come
 * qualunque altro.
 */
export function SuggestedClusters({
  existing,
  canWrite,
  pendingKey,
  onCreate,
}: SuggestedClustersProps) {
  const suggestions = React.useMemo(() => suggestedClusters(), []);

  const missing = React.useMemo(() => {
    const taken = new Set(existing.map((cluster) => normalizeName(cluster.name)));
    return suggestions.filter((suggestion) => !taken.has(normalizeName(suggestion.name)));
  }, [existing, suggestions]);

  if (missing.length === 0 || !canWrite) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-ink-yellow" aria-hidden="true" />
          Segmenti consigliati
        </CardTitle>
        <CardDescription>
          Cluster pronti all’uso pensati sul catalogo AlphaInk. Si creano con un click e restano
          modificabili come qualsiasi altro cluster dinamico.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {missing.map((suggestion) => (
            <li
              key={suggestion.key}
              className="flex flex-col justify-between gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-3"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: suggestion.color }}
                    aria-hidden="true"
                  />
                  <span className="truncate">{suggestion.name}</span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{suggestion.description}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                disabled={pendingKey !== null}
                loading={pendingKey === suggestion.key}
                onClick={() => onCreate(suggestion)}
              >
                <Plus aria-hidden="true" />
                Crea il cluster
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
