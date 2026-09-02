import type { Permission } from '@alphaink/shared';
import {
  BarChart3,
  CalendarDays,
  Images,
  LayoutDashboard,
  Mail,
  Settings,
  Users,
  Layers,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

/** Contatori dinamici mostrati come badge accanto alle voci di menu. */
export interface NavBadges {
  /** Newsletter pianificate o in coda. */
  scheduledNewsletters: number;
  /** Automazioni attive. */
  activeAutomations: number;
}

export const EMPTY_NAV_BADGES: NavBadges = {
  scheduledNewsletters: 0,
  activeAutomations: 0,
};

export interface NavItem {
  href: string;
  label: string;
  /** Descrizione breve usata nella ricerca globale. */
  description: string;
  icon: LucideIcon;
  /** Permesso minimo per vedere la voce. */
  permission: Permission;
  /** Contatore da mostrare nel badge. */
  badge?: keyof NavBadges;
  /** Parole chiave aggiuntive per la ricerca globale. */
  keywords?: string[];
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

/**
 * Struttura della navigazione principale.
 * È l'unica fonte di verità: barra laterale, briciole di pane e ricerca
 * globale leggono tutte da qui.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'panoramica',
    label: 'Panoramica',
    items: [
      {
        href: '/dashboard',
        label: 'Dashboard',
        description: 'Andamento invii, aperture, click e fatturato attribuito.',
        icon: LayoutDashboard,
        permission: 'analytics:read',
        keywords: ['home', 'panoramica', 'metriche'],
      },
      {
        href: '/calendario',
        label: 'Calendario',
        description: 'Piano editoriale degli invii mese per mese.',
        icon: CalendarDays,
        permission: 'newsletter:read',
        badge: 'scheduledNewsletters',
        keywords: ['pianificazione', 'agenda', 'invii'],
      },
    ],
  },
  {
    id: 'comunicazione',
    label: 'Comunicazione',
    items: [
      {
        href: '/newsletter',
        label: 'Newsletter',
        description: 'Bozze, campagne pianificate e newsletter inviate.',
        icon: Mail,
        permission: 'newsletter:read',
        badge: 'scheduledNewsletters',
        keywords: ['campagne', 'email', 'invii'],
      },
      {
        href: '/automazioni',
        label: 'Automazioni',
        description: 'Coupon stampante, pagamenti abbandonati e riacquisti.',
        icon: Workflow,
        permission: 'automations:read',
        badge: 'activeAutomations',
        keywords: ['workflow', 'trigger', 'riacquisto', 'carrello'],
      },
    ],
  },
  {
    id: 'pubblico',
    label: 'Pubblico',
    items: [
      {
        href: '/contatti',
        label: 'Contatti',
        description: 'Rubrica dei clienti B2C e B2B con stato di iscrizione.',
        icon: Users,
        permission: 'contacts:read',
        keywords: ['clienti', 'iscritti', 'rubrica'],
      },
      {
        href: '/cluster',
        label: 'Cluster',
        description: 'Segmenti dinamici e statici usati come destinatari.',
        icon: Layers,
        permission: 'clusters:read',
        keywords: ['segmenti', 'liste', 'target'],
      },
    ],
  },
  {
    id: 'analisi',
    label: 'Analisi e risorse',
    items: [
      {
        href: '/analytics',
        label: 'Analytics',
        description: 'Report dettagliati su consegne, click e attribuzione.',
        icon: BarChart3,
        permission: 'analytics:read',
        keywords: ['report', 'statistiche', 'attribuzione'],
      },
      {
        href: '/media',
        label: 'Media',
        description: 'Immagini e file usati nei contenuti delle email.',
        icon: Images,
        permission: 'newsletter:read',
        keywords: ['immagini', 'file', 'libreria'],
      },
    ],
  },
  {
    id: 'sistema',
    label: 'Sistema',
    items: [
      {
        href: '/impostazioni',
        label: 'Impostazioni',
        description: 'Brevo, sincronizzazione del sito, brand e tracciamento.',
        icon: Settings,
        permission: 'settings:read',
        keywords: ['brevo', 'prestashop', 'utenti', 'configurazione'],
      },
    ],
  },
];

/** Tutte le voci, in ordine di menu. */
export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

/** Etichette delle rotte note, usate dalle briciole di pane. */
export const ROUTE_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  calendario: 'Calendario',
  newsletter: 'Newsletter',
  automazioni: 'Automazioni',
  contatti: 'Contatti',
  cluster: 'Cluster',
  analytics: 'Analytics',
  media: 'Media',
  impostazioni: 'Impostazioni',
  nuovo: 'Nuovo',
  nuova: 'Nuova',
  modifica: 'Modifica',
  report: 'Report',
  importa: 'Importazione',
  esporta: 'Esportazione',
  brevo: 'Brevo',
  sito: 'Sito',
  brand: 'Brand',
  tracciamento: 'Tracciamento',
  utenti: 'Utenti',
  template: 'Template',
};

/** True se la rotta corrente appartiene alla voce di menu. */
export function isActivePath(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (pathname === href) return true;
  return pathname.startsWith(`${href}/`);
}
