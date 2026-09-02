import type { ProductFamily } from '../types/site';
import type { FamilyRule } from '../types/settings';

/**
 * Regole di default per classificare i prodotti AlphaInk nelle famiglie usate
 * dalle automazioni di riacquisto. Sono sovrascrivibili da `settings/site`.
 * Priorità crescente = valutata prima.
 */
export const DEFAULT_FAMILY_RULES: FamilyRule[] = [
  {
    id: 'stampanti',
    family: 'stampanti',
    priority: 100,
    categoryPatterns: ['*stampant*', '*printer*', '*multifunzion*'],
    skuPatterns: ['PRN-*', 'STAMP-*'],
    namePatterns: ['*stampante*', '*multifunzione*', '*printer*'],
  },
  {
    id: 'toner',
    family: 'toner',
    priority: 90,
    categoryPatterns: ['*toner*', '*laser*'],
    skuPatterns: ['TN-*', 'TON-*', 'CE*', 'CF*', 'CRG*'],
    namePatterns: ['*toner*', '*tamburo*', '*drum*'],
  },
  {
    id: 'cartucce',
    family: 'cartucce',
    priority: 80,
    categoryPatterns: ['*cartucc*', '*inkjet*', '*ink*'],
    skuPatterns: ['CT-*', 'INK-*', 'T0*', 'LC*'],
    namePatterns: ['*cartuccia*', '*cartucce*', '*inkjet*'],
  },
  {
    id: 'carta',
    family: 'carta',
    priority: 70,
    categoryPatterns: ['*carta*', '*paper*', '*risme*'],
    skuPatterns: ['PAP-*', 'CAR-*'],
    namePatterns: ['*carta*', '*risma*', '*risme*', '*a4*', '*a3*'],
  },
  {
    id: 'nastri',
    family: 'nastri',
    priority: 60,
    categoryPatterns: ['*nastr*', '*ribbon*'],
    skuPatterns: ['RIB-*', 'NAS-*'],
    namePatterns: ['*nastro*', '*ribbon*'],
  },
  {
    id: 'accessori',
    family: 'accessori',
    priority: 50,
    categoryPatterns: ['*accessor*', '*ricambi*'],
    skuPatterns: ['ACC-*'],
    namePatterns: ['*fusore*', '*rullo*', '*cavo*', '*accessorio*'],
  },
];

/** Cicli di riacquisto stimati (giorni) usati come default dalle automazioni. */
export const DEFAULT_REPURCHASE_CYCLE_DAYS: Record<ProductFamily, number> = {
  toner: 60,        // 1440 ore — default richiesto per "Riacquisto Toner e Cartucce"
  cartucce: 60,
  carta: 45,
  stampanti: 900,
  nastri: 120,
  accessori: 180,
  altro: 120,
};

/** Converte un pattern con `*` in espressione regolare case-insensitive. */
export function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

function matchesAny(value: string | undefined | null, patterns: string[]): boolean {
  if (!value || patterns.length === 0) return false;
  return patterns.some((p) => patternToRegExp(p).test(value));
}

/**
 * Classifica un articolo in una famiglia AlphaInk.
 * La prima regola che combacia (per priorità decrescente) vince.
 */
export function classifyProductFamily(
  item: { sku?: string | null; name?: string | null; categoryPath?: string[] | null },
  rules: FamilyRule[] = DEFAULT_FAMILY_RULES,
): ProductFamily {
  const sorted = [...rules].sort((a, b) => b.priority - a.priority);
  const categories = (item.categoryPath ?? []).join(' > ');
  for (const rule of sorted) {
    if (
      matchesAny(item.sku, rule.skuPatterns) ||
      matchesAny(item.name, rule.namePatterns) ||
      matchesAny(categories, rule.categoryPatterns) ||
      (item.categoryPath ?? []).some((c) => matchesAny(c, rule.categoryPatterns))
    ) {
      return rule.family as ProductFamily;
    }
  }
  return 'altro';
}

/**
 * Estrae i modelli di stampante citati nel nome di un consumabile.
 * Esempio: "Toner compatibile per HP LaserJet Pro M404dn" → ["M404dn"].
 */
export function extractPrinterModels(productName: string): string[] {
  const matches = productName.match(/\b([A-Z]{1,4}[- ]?\d{2,5}[A-Za-z]{0,4})\b/g);
  if (!matches) return [];
  const blacklist = new Set(['A4', 'A3', 'A5', 'ISO', 'PDF']);
  return Array.from(new Set(matches.map((m) => m.trim().toUpperCase()))).filter((m) => !blacklist.has(m));
}

const KNOWN_BRANDS = [
  'HP', 'Canon', 'Epson', 'Brother', 'Samsung', 'Lexmark', 'Xerox', 'Kyocera',
  'Ricoh', 'OKI', 'Dell', 'Sharp', 'Panasonic', 'Olivetti', 'Konica Minolta',
];

/** Riconosce la marca della stampante dal nome del prodotto. */
export function extractPrinterBrand(productName: string): string | null {
  const upper = productName.toUpperCase();
  for (const brand of KNOWN_BRANDS) {
    if (upper.includes(brand.toUpperCase())) return brand;
  }
  return null;
}
