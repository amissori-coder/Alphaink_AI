/**
 * Contratto comune dei componenti di rendering dei blocchi.
 *
 * Ogni blocco riceve solo ciò che non può dedurre da solo: il modello, la
 * larghezza reale della colonna che lo ospita (serve a immagini e griglie) e lo
 * stato di selezione. Stili globali, viewport e valori di anteprima dei merge
 * tag arrivano dal contesto dell'editor.
 */

import type { EmailBlock } from '@alphaink/shared';

export interface BlockViewProps {
  block: EmailBlock;
  /** Larghezza utile in pixel dentro la colonna, al netto dei padding. */
  width: number;
  /** Il blocco è quello selezionato nel canvas. */
  selected: boolean;
}
