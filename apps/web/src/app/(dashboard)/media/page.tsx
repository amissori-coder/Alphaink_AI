import type { Metadata } from 'next';

import { MediaLibrary } from './media-library';

export const metadata: Metadata = {
  title: 'Media',
  description:
    'Libreria delle immagini AlphaInk usate nelle newsletter: caricamento multiplo, ricerca, cartelle, dettagli tecnici e copia dell’indirizzo pubblico.',
};

export default function MediaPage() {
  return <MediaLibrary />;
}
