'use client';

/**
 * Colonna di destra dell'editor.
 *
 * Due schede: **Selezione** (blocco o sezione su cui si sta lavorando) e
 * **Documento** (impostazioni globali). Restano separate perché sono due
 * mestieri diversi: la prima si usa di continuo, la seconda una volta sola a
 * inizio campagna.
 */

import { MousePointerSquareDashed, Settings2, SlidersHorizontal } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

import { findBlock, findSection, useEditor } from '../editor-store';
import { BlockInspector } from './block-inspector';
import { GlobalInspector } from './global-inspector';
import { SectionInspector } from './section-inspector';

export interface InspectorProps {
  className?: string;
}

export function Inspector({ className }: InspectorProps) {
  const { state, actions } = useEditor();

  const selectedBlock = React.useMemo(
    () => (state.selection.kind === 'block' ? findBlock(state.document, state.selection.blockId) : null),
    [state.document, state.selection],
  );

  const selectedSection = React.useMemo(
    () => findSection(state.document, state.selection.sectionId),
    [state.document, state.selection.sectionId],
  );

  const sectionIndex = React.useMemo(
    () =>
      selectedSection
        ? state.document.sections.findIndex((section) => section.id === selectedSection.id)
        : -1,
    [state.document.sections, selectedSection],
  );

  const tab = state.panel === 'globale' ? 'documento' : 'selezione';

  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-card', className)}>
      <Tabs
        value={tab}
        onValueChange={(value) => actions.setPanel(value === 'documento' ? 'globale' : 'contenuto')}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="px-3 pt-3">
          <TabsList className="w-full">
            <TabsTrigger value="selezione" className="flex-1">
              <Settings2 aria-hidden="true" />
              Selezione
            </TabsTrigger>
            <TabsTrigger value="documento" className="flex-1">
              <SlidersHorizontal aria-hidden="true" />
              Documento
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="selezione" className="mt-0 min-h-0 flex-1">
          <ScrollArea className="h-full">
            {selectedBlock ? (
              <BlockInspector found={selectedBlock} />
            ) : selectedSection && state.selection.kind === 'section' ? (
              <SectionInspector section={selectedSection} index={sectionIndex} />
            ) : (
              <div className="p-4">
                <EmptyState
                  compact
                  icon={<MousePointerSquareDashed />}
                  title="Nessuna selezione"
                  description="Fai clic su un blocco o su una sezione del canvas per modificarne le proprietà."
                  action={
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => actions.setPanel('globale')}
                    >
                      Stile del documento
                    </Button>
                  }
                />
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="documento" className="mt-0 min-h-0 flex-1">
          <ScrollArea className="h-full">
            <GlobalInspector />
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export { BlockInspector } from './block-inspector';
export { GlobalInspector } from './global-inspector';
export { SectionInspector } from './section-inspector';
export * from './controls';
