'use client';

/**
 * Pannello proprietà del blocco selezionato.
 *
 * La parte alta cambia con il tipo di blocco (contenuto), quella bassa è comune
 * a tutti (spaziatura, sfondo, bordo, allineamento, visibilità). Ogni modifica
 * è immediata sul canvas: non ci sono moduli da confermare.
 */

import { BLOCK_LABELS, MERGE_TAGS } from '@alphaink/shared';
import type {
  BlockContent,
  ButtonBlockContent,
  CountdownBlockContent,
  CouponBlockContent,
  DividerBlockContent,
  EmailBlock,
  FooterBlockContent,
  HeadingBlockContent,
  HtmlBlockContent,
  ImageBlockContent,
  MenuBlockContent,
  ProductBlockContent,
  ProductGridBlockContent,
  SocialBlockContent,
  SocialNetwork,
  SpacerBlockContent,
  TextBlockContent,
  UnsubscribeBlockContent,
  VideoBlockContent,
} from '@alphaink/shared';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Eye,
  Image as ImageIcon,
  Layers,
  Palette,
  Plus,
  Trash2,
  Type as TypeIcon,
} from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import type { FoundBlock } from '../editor-store';
import { useEditor } from '../editor-store';
import { MediaPickerDialog } from '../media-picker';
import { SOCIAL_LABELS } from '../blocks/social-block';
import { DYNAMIC_SOURCE_LABELS } from '../blocks/product-grid-block';
import { fileNameFromUrl, normalizeUrl } from '../utils';
import {
  AlignField,
  BorderField,
  ColorField,
  DateTimeField,
  Field,
  InspectorGroups,
  InspectorSection,
  NumberField,
  SelectField,
  SpacingField,
  SwitchField,
  TextAreaField,
  TextField,
  TypographyFields,
} from './controls';

// -----------------------------------------------------------------------------
// Aiutanti comuni
// -----------------------------------------------------------------------------

/** Riga di una lista modificabile (voci di menu, profili social, prodotti). */
function ListRow({
  title,
  onMoveUp,
  onMoveDown,
  onDuplicate,
  onRemove,
  children,
}: {
  title: string;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onDuplicate?: () => void;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2 rounded-md border border-border/70 bg-muted/30 p-2.5">
      <div className="flex items-center justify-between gap-1">
        <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        <span className="flex items-center gap-0.5">
          {onMoveUp ? (
            <SimpleTooltip content="Sposta su">
              <Button type="button" variant="ghost" size="icon" className="size-6" onClick={onMoveUp}>
                <ArrowUp aria-hidden="true" />
                <span className="sr-only">Sposta su</span>
              </Button>
            </SimpleTooltip>
          ) : null}
          {onMoveDown ? (
            <SimpleTooltip content="Sposta giù">
              <Button type="button" variant="ghost" size="icon" className="size-6" onClick={onMoveDown}>
                <ArrowDown aria-hidden="true" />
                <span className="sr-only">Sposta giù</span>
              </Button>
            </SimpleTooltip>
          ) : null}
          {onDuplicate ? (
            <SimpleTooltip content="Duplica">
              <Button type="button" variant="ghost" size="icon" className="size-6" onClick={onDuplicate}>
                <Copy aria-hidden="true" />
                <span className="sr-only">Duplica</span>
              </Button>
            </SimpleTooltip>
          ) : null}
          <SimpleTooltip content="Rimuovi">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 hover:text-destructive"
              onClick={onRemove}
            >
              <Trash2 aria-hidden="true" />
              <span className="sr-only">Rimuovi</span>
            </Button>
          </SimpleTooltip>
        </span>
      </div>
      {children}
    </div>
  );
}

/** Sposta un elemento di un array, restituendone una copia. */
function moved<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/** Selettore di immagine con anteprima, usato da più blocchi. */
function ImageField({
  label,
  value,
  alt,
  onPick,
  hint,
}: {
  label: string;
  value: string;
  alt?: string;
  onPick: (selection: { src: string; storagePath: string | null; width: number | null; alt: string }) => void;
  hint?: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            'flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted transition-colors',
            'hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
          aria-label={`${label}: scegli un'immagine`}
        >
          {value ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={value} alt={alt ?? ''} className="size-full object-contain" />
          ) : (
            <ImageIcon className="size-4 text-muted-foreground" aria-hidden="true" />
          )}
        </button>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate text-xs text-muted-foreground">
            {value ? fileNameFromUrl(value) : 'Nessuna immagine'}
          </p>
          <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => setOpen(true)}>
            {value ? 'Cambia' : 'Scegli'}
          </Button>
        </div>
      </div>

      <MediaPickerDialog
        open={open}
        onOpenChange={setOpen}
        currentSrc={value || null}
        currentAlt={alt ?? null}
        onSelect={(selection) =>
          onPick({
            src: selection.src,
            storagePath: selection.storagePath,
            width: selection.width,
            alt: selection.alt,
          })
        }
      />
    </Field>
  );
}

// -----------------------------------------------------------------------------
// Editor di contenuto per tipo
// -----------------------------------------------------------------------------

type Update = (patch: Partial<BlockContent>) => void;

function TextContent({ content, update }: { content: TextBlockContent; update: Update }) {
  return (
    <>
      <p className="rounded-md bg-muted/60 px-2.5 py-2 text-[11px] leading-snug text-muted-foreground">
        Il testo si scrive direttamente sul canvas. Qui imposti la tipografia di tutto il blocco.
      </p>
      <TypographyFields
        value={content.typography}
        onChange={(typography) => update({ typography })}
      />
    </>
  );
}

function HeadingContent({ content, update }: { content: HeadingBlockContent; update: Update }) {
  return (
    <>
      <TextField
        label="Testo del titolo"
        value={content.text}
        onChange={(text) => update({ text })}
        placeholder="Il titolo della sezione"
        mergeTags
      />
      <SelectField
        label="Livello"
        inline
        value={String(content.level) as '1' | '2' | '3' | '4'}
        onChange={(level) =>
          update({ level: Number(level) as HeadingBlockContent['level'] })
        }
        options={[
          { value: '1', label: 'H1 — titolo principale' },
          { value: '2', label: 'H2 — titolo di sezione' },
          { value: '3', label: 'H3 — sottotitolo' },
          { value: '4', label: 'H4 — occhiello' },
        ]}
      />
      <Separator />
      <TypographyFields value={content.typography} onChange={(typography) => update({ typography })} />
    </>
  );
}

function ImageContent({ content, update }: { content: ImageBlockContent; update: Update }) {
  return (
    <>
      <ImageField
        label="Immagine"
        value={content.src}
        alt={content.alt}
        onPick={(selection) =>
          update({
            src: selection.src,
            storagePath: selection.storagePath,
            alt: selection.alt || content.alt,
            width: selection.width ?? content.width ?? null,
          })
        }
      />
      <TextField
        label="Testo alternativo"
        value={content.alt}
        onChange={(alt) => update({ alt })}
        placeholder="Descrivi l’immagine"
        hint="Mostrato quando il client blocca le immagini: influisce anche sulla consegna."
      />
      <SwitchField
        label="Larghezza automatica"
        checked={!content.width}
        onChange={(checked) => update({ width: checked ? null : 600 })}
        hint="L’immagine occupa tutta la colonna."
      />
      {content.width ? (
        <NumberField
          label="Larghezza"
          value={content.width}
          min={16}
          max={1200}
          onChange={(width) => update({ width })}
        />
      ) : null}
      <NumberField
        label="Angoli arrotondati"
        value={content.borderRadius ?? 0}
        min={0}
        max={48}
        onChange={(borderRadius) => update({ borderRadius })}
      />
      <TextField
        label="Link"
        type="url"
        value={content.href ?? ''}
        onChange={(href) => update({ href: href ? normalizeUrl(href) : null })}
        placeholder="https://alphaink.net/promo"
      />
      <SwitchField
        label="Traccia i clic"
        checked={content.trackClick !== false}
        onChange={(trackClick) => update({ trackClick })}
      />
    </>
  );
}

function ButtonContent({ content, update }: { content: ButtonBlockContent; update: Update }) {
  return (
    <>
      <TextField
        label="Etichetta"
        value={content.label}
        onChange={(label) => update({ label })}
        placeholder="Scopri l’offerta"
        mergeTags
      />
      <TextField
        label="Indirizzo"
        type="url"
        value={content.href}
        onChange={(href) => update({ href })}
        placeholder="https://alphaink.net/offerte"
        hint="Obbligatorio: senza un indirizzo valido il pulsante non viene inviato."
      />
      <SwitchField
        label="Traccia i clic"
        checked={content.trackClick !== false}
        onChange={(trackClick) => update({ trackClick })}
      />
      <Separator />
      <ColorField
        label="Colore di sfondo"
        value={content.backgroundColor}
        onChange={(backgroundColor) => update({ backgroundColor: backgroundColor ?? '#00AEEF' })}
      />
      <ColorField
        label="Colore del testo"
        value={content.textColor}
        onChange={(textColor) => update({ textColor: textColor ?? '#FFFFFF' })}
      />
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Dimensione"
          value={content.fontSize}
          min={10}
          max={32}
          onChange={(fontSize) => update({ fontSize })}
        />
        <SelectField
          label="Peso"
          value={String(content.fontWeight) as '400' | '500' | '600' | '700' | '800' | '900'}
          onChange={(weight) =>
            update({ fontWeight: Number(weight) as ButtonBlockContent['fontWeight'] })
          }
          options={[
            { value: '400', label: 'Normale' },
            { value: '500', label: 'Medio' },
            { value: '600', label: 'Semi-grassetto' },
            { value: '700', label: 'Grassetto' },
            { value: '800', label: 'Extra' },
          ]}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Padding orizz."
          value={content.paddingX}
          min={0}
          max={80}
          onChange={(paddingX) => update({ paddingX })}
        />
        <NumberField
          label="Padding vert."
          value={content.paddingY}
          min={0}
          max={60}
          onChange={(paddingY) => update({ paddingY })}
        />
      </div>
      <NumberField
        label="Angoli arrotondati"
        value={content.borderRadius}
        min={0}
        max={40}
        onChange={(borderRadius) => update({ borderRadius })}
      />
      <SwitchField
        label="Larghezza piena"
        checked={content.fullWidth}
        onChange={(fullWidth) => update({ fullWidth })}
      />
      <BorderField
        label="Bordo del pulsante"
        value={content.border}
        onChange={(border) => update({ border })}
      />
    </>
  );
}

function DividerContent({ content, update }: { content: DividerBlockContent; update: Update }) {
  return (
    <>
      <ColorField
        label="Colore"
        value={content.color}
        onChange={(color) => update({ color: color ?? '#E2E8F0' })}
      />
      <NumberField
        label="Spessore"
        value={content.thickness}
        min={1}
        max={12}
        onChange={(thickness) => update({ thickness })}
      />
      <SelectField
        label="Stile"
        inline
        value={content.style}
        onChange={(style) => update({ style })}
        options={[
          { value: 'solid', label: 'Continuo' },
          { value: 'dashed', label: 'Tratteggiato' },
          { value: 'dotted', label: 'Punteggiato' },
        ]}
      />
      <NumberField
        label="Larghezza"
        value={content.widthPercent}
        min={10}
        max={100}
        suffix="%"
        slider
        onChange={(widthPercent) => update({ widthPercent })}
      />
    </>
  );
}

function SpacerContent({ content, update }: { content: SpacerBlockContent; update: Update }) {
  return (
    <NumberField
      label="Altezza"
      value={content.height}
      min={1}
      max={200}
      slider
      onChange={(height) => update({ height })}
    />
  );
}

const SOCIAL_OPTIONS = (Object.keys(SOCIAL_LABELS) as SocialNetwork[]).map((network) => ({
  value: network,
  label: SOCIAL_LABELS[network],
}));

function SocialContent({ content, update }: { content: SocialBlockContent; update: Update }) {
  const items = content.items ?? [];
  const setItems = (next: SocialBlockContent['items']) => update({ items: next });

  return (
    <>
      <div className="space-y-2">
        {items.map((item, index) => (
          <ListRow
            key={index}
            title={SOCIAL_LABELS[item.network] ?? item.network}
            onMoveUp={index > 0 ? () => setItems(moved(items, index, index - 1)) : undefined}
            onMoveDown={
              index < items.length - 1 ? () => setItems(moved(items, index, index + 1)) : undefined
            }
            onRemove={() => setItems(items.filter((_, i) => i !== index))}
          >
            <SelectField
              label="Rete"
              inline
              value={item.network}
              onChange={(network) =>
                setItems(items.map((entry, i) => (i === index ? { ...entry, network } : entry)))
              }
              options={SOCIAL_OPTIONS}
            />
            <TextField
              label="Indirizzo"
              type="url"
              value={item.url}
              onChange={(url) =>
                setItems(items.map((entry, i) => (i === index ? { ...entry, url } : entry)))
              }
              placeholder="https://facebook.com/alphaink"
            />
          </ListRow>
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => setItems([...items, { network: 'website', url: 'https://alphaink.net' }])}
      >
        <Plus aria-hidden="true" />
        Aggiungi profilo
      </Button>

      <Separator />
      <NumberField
        label="Dimensione icone"
        value={content.iconSize}
        min={16}
        max={64}
        onChange={(iconSize) => update({ iconSize })}
      />
      <NumberField
        label="Spazio fra le icone"
        value={content.spacing}
        min={0}
        max={40}
        onChange={(spacing) => update({ spacing })}
      />
      <SelectField
        label="Stile"
        inline
        value={content.iconStyle}
        onChange={(iconStyle) => update({ iconStyle })}
        options={[
          { value: 'color', label: 'A colori' },
          { value: 'dark', label: 'Scuro' },
          { value: 'light', label: 'Chiaro' },
          { value: 'outline', label: 'Contorno' },
        ]}
      />
    </>
  );
}

function VideoContent({ content, update }: { content: VideoBlockContent; update: Update }) {
  return (
    <>
      <TextField
        label="Indirizzo del video"
        type="url"
        value={content.url}
        onChange={(url) => update({ url })}
        placeholder="https://www.youtube.com/watch?v=…"
      />
      <ImageField
        label="Miniatura"
        value={content.thumbnailUrl}
        alt={content.alt}
        hint="Le email non riproducono video: si mostra un’immagine cliccabile."
        onPick={(selection) => update({ thumbnailUrl: selection.src })}
      />
      <TextField
        label="Testo alternativo"
        value={content.alt}
        onChange={(alt) => update({ alt })}
        placeholder="Guarda il video"
      />
      <SwitchField
        label="Invito sotto la miniatura"
        checked={content.showPlayIcon}
        onChange={(showPlayIcon) => update({ showPlayIcon })}
      />
    </>
  );
}

function HtmlContent({ content, update }: { content: HtmlBlockContent; update: Update }) {
  return (
    <TextAreaField
      label="HTML"
      mono
      rows={12}
      value={content.html}
      onChange={(html) => update({ html })}
      hint="Script, iframe e attributi evento vengono rimossi prima dell’invio."
    />
  );
}

/** Campi di una scheda prodotto, riusati dal blocco singolo e dalla griglia. */
function ProductFields({
  product,
  onChange,
  withLayout = true,
}: {
  product: ProductBlockContent;
  onChange: (next: ProductBlockContent) => void;
  withLayout?: boolean;
}) {
  return (
    <>
      <ImageField
        label="Immagine"
        value={product.imageUrl}
        alt={product.name}
        onPick={(selection) => onChange({ ...product, imageUrl: selection.src })}
      />
      <TextField
        label="Nome"
        value={product.name}
        onChange={(name) => onChange({ ...product, name })}
        placeholder="Toner compatibile XL"
      />
      <TextField
        label="Codice (SKU)"
        value={product.sku}
        onChange={(sku) => onChange({ ...product, sku })}
        placeholder="TN-2420XL"
      />
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Prezzo"
          value={product.price}
          min={0}
          max={100000}
          step={0.01}
          suffix="€"
          onChange={(price) => onChange({ ...product, price })}
        />
        <NumberField
          label="Prezzo pieno"
          value={product.compareAtPrice ?? 0}
          min={0}
          max={100000}
          step={0.01}
          suffix="€"
          onChange={(compareAtPrice) =>
            onChange({ ...product, compareAtPrice: compareAtPrice > 0 ? compareAtPrice : null })
          }
        />
      </div>
      <TextField
        label="Indirizzo prodotto"
        type="url"
        value={product.url}
        onChange={(url) => onChange({ ...product, url })}
        placeholder="https://alphaink.net/prodotto"
      />
      <TextField
        label="Etichetta del pulsante"
        value={product.ctaLabel}
        onChange={(ctaLabel) => onChange({ ...product, ctaLabel })}
        placeholder="Acquista ora"
      />
      <SwitchField
        label="Mostra il prezzo"
        checked={product.showPrice}
        onChange={(showPrice) => onChange({ ...product, showPrice })}
      />
      <SwitchField
        label="Badge sconto"
        checked={product.showDiscountBadge}
        onChange={(showDiscountBadge) => onChange({ ...product, showDiscountBadge })}
        hint="Visibile solo se il prezzo pieno è superiore a quello attuale."
      />
      {withLayout ? (
        <SelectField
          label="Disposizione"
          inline
          value={product.layout}
          onChange={(layout) => onChange({ ...product, layout })}
          options={[
            { value: 'horizontal', label: 'Immagine a sinistra' },
            { value: 'vertical', label: 'Immagine in alto' },
          ]}
        />
      ) : null}
    </>
  );
}

function ProductContent({ content, update }: { content: ProductBlockContent; update: Update }) {
  return (
    <ProductFields
      product={content}
      onChange={(next) => update({ ...next, type: 'product' } as Partial<BlockContent>)}
    />
  );
}

function ProductGridContent({
  content,
  update,
}: {
  content: ProductGridBlockContent;
  update: Update;
}) {
  const products = content.products ?? [];
  const setProducts = (next: ProductBlockContent[]) => update({ products: next });
  const dynamic = content.dynamicSource;

  return (
    <>
      <SelectField
        label="Colonne"
        inline
        value={String(content.columns) as '2' | '3'}
        onChange={(columns) =>
          update({ columns: Number(columns) as ProductGridBlockContent['columns'] })
        }
        options={[
          { value: '2', label: '2 per riga' },
          { value: '3', label: '3 per riga' },
        ]}
      />

      <SwitchField
        label="Prodotti automatici"
        checked={Boolean(dynamic)}
        hint="Scelti al momento dell’invio, diversi per ogni destinatario."
        onChange={(checked) =>
          update({
            dynamicSource: checked
              ? { type: 'bestsellers', categoryPath: null, limit: content.columns ?? 3 }
              : null,
          })
        }
      />

      {dynamic ? (
        <div className="space-y-3 rounded-md border border-border/70 bg-muted/30 p-2.5">
          <SelectField
            label="Criterio"
            value={dynamic.type}
            onChange={(type) => update({ dynamicSource: { ...dynamic, type } })}
            options={(
              Object.keys(DYNAMIC_SOURCE_LABELS) as Array<keyof typeof DYNAMIC_SOURCE_LABELS>
            ).map((key) => ({ value: key, label: DYNAMIC_SOURCE_LABELS[key] }))}
          />
          {dynamic.type === 'category' ? (
            <TextField
              label="Categoria"
              value={dynamic.categoryPath ?? ''}
              onChange={(categoryPath) => update({ dynamicSource: { ...dynamic, categoryPath } })}
              placeholder="toner/compatibili"
            />
          ) : null}
          <NumberField
            label="Numero massimo"
            value={dynamic.limit}
            min={1}
            max={12}
            suffix=""
            onChange={(limit) => update({ dynamicSource: { ...dynamic, limit } })}
          />
        </div>
      ) : null}

      <Separator />

      <div className="space-y-2">
        {products.map((product, index) => (
          <ListRow
            key={index}
            title={product.name || `Prodotto ${index + 1}`}
            onMoveUp={index > 0 ? () => setProducts(moved(products, index, index - 1)) : undefined}
            onMoveDown={
              index < products.length - 1
                ? () => setProducts(moved(products, index, index + 1))
                : undefined
            }
            onDuplicate={() =>
              setProducts([...products.slice(0, index + 1), { ...product }, ...products.slice(index + 1)])
            }
            onRemove={() => setProducts(products.filter((_, i) => i !== index))}
          >
            <ProductFields
              withLayout={false}
              product={product}
              onChange={(next) => setProducts(products.map((entry, i) => (i === index ? next : entry)))}
            />
          </ListRow>
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() =>
          setProducts([
            ...products,
            {
              type: 'product',
              sku: '',
              name: 'Nuovo prodotto',
              imageUrl: '',
              price: 0,
              compareAtPrice: null,
              currency: 'EUR',
              url: 'https://alphaink.net',
              ctaLabel: 'Acquista',
              showPrice: true,
              showDiscountBadge: true,
              layout: 'vertical',
            } as ProductBlockContent,
          ])
        }
      >
        <Plus aria-hidden="true" />
        Aggiungi prodotto
      </Button>
    </>
  );
}

function CouponContent({ content, update }: { content: CouponBlockContent; update: Update }) {
  return (
    <>
      <SwitchField
        label="Codice per destinatario"
        checked={content.dynamic}
        hint="Ogni contatto riceve un codice unico, generato all’invio."
        onChange={(dynamic) => update({ dynamic })}
      />
      {content.dynamic ? (
        <TextField
          label="Prefisso dei codici"
          value={content.codePrefix ?? ''}
          onChange={(codePrefix) => update({ codePrefix })}
          placeholder="ALPHA"
        />
      ) : (
        <TextField
          label="Codice"
          value={content.code ?? ''}
          onChange={(code) => update({ code })}
          placeholder="ALPHA10"
        />
      )}
      <TextField
        label="Sconto"
        value={content.discountLabel}
        onChange={(discountLabel) => update({ discountLabel })}
        placeholder="10% di sconto"
        mergeTags
      />
      <TextField
        label="Descrizione"
        value={content.description ?? ''}
        onChange={(description) => update({ description })}
        placeholder="Usa il codice al checkout."
      />
      <DateTimeField
        label="Valido fino al"
        value={content.expiresAt ?? null}
        onChange={(expiresAt) => update({ expiresAt })}
      />
      <Separator />
      <ColorField
        label="Sfondo del riquadro"
        value={content.backgroundColor}
        onChange={(backgroundColor) => update({ backgroundColor: backgroundColor ?? '#F8FAFC' })}
      />
      <ColorField
        label="Colore del testo"
        value={content.textColor}
        onChange={(textColor) => update({ textColor: textColor ?? '#0F172A' })}
      />
      <SelectField
        label="Cornice"
        inline
        value={content.borderStyle}
        onChange={(borderStyle) => update({ borderStyle })}
        options={[
          { value: 'dashed', label: 'Tratteggiata' },
          { value: 'solid', label: 'Continua' },
        ]}
      />
      <Separator />
      <TextField
        label="Etichetta pulsante"
        value={content.ctaLabel ?? ''}
        onChange={(ctaLabel) => update({ ctaLabel: ctaLabel || null })}
        placeholder="Usa il coupon"
      />
      <TextField
        label="Indirizzo pulsante"
        type="url"
        value={content.ctaHref ?? ''}
        onChange={(ctaHref) => update({ ctaHref: ctaHref || null })}
        placeholder="https://alphaink.net"
      />
    </>
  );
}

function CountdownContent({ content, update }: { content: CountdownBlockContent; update: Update }) {
  return (
    <>
      <TextField
        label="Etichetta"
        value={content.label}
        onChange={(label) => update({ label })}
        placeholder="L’offerta scade fra"
      />
      <DateTimeField
        label="Scadenza"
        clearable={false}
        value={content.endsAt}
        onChange={(endsAt) => update({ endsAt: endsAt ?? content.endsAt })}
        hint="Il valore è calcolato al momento dell’invio: l’email resta statica."
      />
      <SwitchField
        label="Mostra i giorni"
        checked={content.showDays !== false}
        onChange={(showDays) => update({ showDays })}
      />
      <SwitchField
        label="Mostra le ore"
        checked={Boolean(content.showHours)}
        onChange={(showHours) => update({ showHours })}
      />
      <ColorField
        label="Colore dei riquadri"
        value={content.accentColor}
        onChange={(accentColor) => update({ accentColor: accentColor ?? '#EC008C' })}
      />
    </>
  );
}

function MenuContent({ content, update }: { content: MenuBlockContent; update: Update }) {
  const items = content.items ?? [];
  const setItems = (next: MenuBlockContent['items']) => update({ items: next });

  return (
    <>
      <div className="space-y-2">
        {items.map((item, index) => (
          <ListRow
            key={index}
            title={item.label || `Voce ${index + 1}`}
            onMoveUp={index > 0 ? () => setItems(moved(items, index, index - 1)) : undefined}
            onMoveDown={
              index < items.length - 1 ? () => setItems(moved(items, index, index + 1)) : undefined
            }
            onRemove={() => setItems(items.filter((_, i) => i !== index))}
          >
            <TextField
              label="Etichetta"
              value={item.label}
              onChange={(label) =>
                setItems(items.map((entry, i) => (i === index ? { ...entry, label } : entry)))
              }
            />
            <TextField
              label="Indirizzo"
              type="url"
              value={item.href}
              onChange={(href) =>
                setItems(items.map((entry, i) => (i === index ? { ...entry, href } : entry)))
              }
            />
          </ListRow>
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => setItems([...items, { label: 'Nuova voce', href: 'https://alphaink.net' }])}
      >
        <Plus aria-hidden="true" />
        Aggiungi voce
      </Button>

      <TextField
        label="Separatore"
        value={content.separator}
        onChange={(separator) => update({ separator })}
        placeholder="·"
      />
      <Separator />
      <TypographyFields value={content.typography} onChange={(typography) => update({ typography })} />
    </>
  );
}

function FooterContent({ content, update }: { content: FooterBlockContent; update: Update }) {
  return (
    <>
      <TextField
        label="Ragione sociale"
        value={content.companyName}
        onChange={(companyName) => update({ companyName })}
        placeholder="AlphaInk"
      />
      <TextField
        label="Indirizzo"
        value={content.address}
        onChange={(address) => update({ address })}
        placeholder="Via… — Italia"
      />
      <TextField
        label="Riga fiscale"
        value={content.vatLine ?? ''}
        onChange={(vatLine) => update({ vatLine })}
        placeholder="P. IVA 00000000000"
      />
      <TextAreaField
        label="HTML aggiuntivo"
        mono
        rows={3}
        value={content.extraHtml ?? ''}
        onChange={(extraHtml) => update({ extraHtml })}
        hint="Solo tag di testo: grassetto, corsivo, link e a capo."
      />
      <Separator />
      <TypographyFields value={content.typography} onChange={(typography) => update({ typography })} />
    </>
  );
}

function UnsubscribeContent({
  content,
  update,
}: {
  content: UnsubscribeBlockContent;
  update: Update;
}) {
  return (
    <>
      <p className="rounded-md bg-muted/60 px-2.5 py-2 text-[11px] leading-snug text-muted-foreground">
        Gli indirizzi di disiscrizione e preferenze sono generati e firmati per ogni destinatario al
        momento dell’invio.
      </p>
      <TextField
        label="Testo introduttivo"
        value={content.text}
        onChange={(text) => update({ text })}
      />
      <TextField
        label="Etichetta disiscrizione"
        value={content.linkLabel}
        onChange={(linkLabel) => update({ linkLabel })}
        placeholder="Disiscriviti"
      />
      <SwitchField
        label="Link alle preferenze"
        checked={content.showPreferencesLink}
        onChange={(showPreferencesLink) => update({ showPreferencesLink })}
      />
      {content.showPreferencesLink ? (
        <TextField
          label="Etichetta preferenze"
          value={content.preferencesLabel ?? ''}
          onChange={(preferencesLabel) => update({ preferencesLabel })}
          placeholder="Gestisci le preferenze"
        />
      ) : null}
      <Separator />
      <TypographyFields value={content.typography} onChange={(typography) => update({ typography })} />
    </>
  );
}

/** Sceglie l'editor di contenuto in base al tipo del blocco. */
function ContentEditor({ block, update }: { block: EmailBlock; update: Update }) {
  const content = block.content;
  switch (content.type) {
    case 'text':
      return <TextContent content={content} update={update} />;
    case 'heading':
      return <HeadingContent content={content} update={update} />;
    case 'image':
      return <ImageContent content={content} update={update} />;
    case 'button':
      return <ButtonContent content={content} update={update} />;
    case 'divider':
      return <DividerContent content={content} update={update} />;
    case 'spacer':
      return <SpacerContent content={content} update={update} />;
    case 'social':
      return <SocialContent content={content} update={update} />;
    case 'video':
      return <VideoContent content={content} update={update} />;
    case 'html':
      return <HtmlContent content={content} update={update} />;
    case 'product':
      return <ProductContent content={content} update={update} />;
    case 'product_grid':
      return <ProductGridContent content={content} update={update} />;
    case 'coupon':
      return <CouponContent content={content} update={update} />;
    case 'countdown':
      return <CountdownContent content={content} update={update} />;
    case 'menu':
      return <MenuContent content={content} update={update} />;
    case 'footer':
      return <FooterContent content={content} update={update} />;
    case 'unsubscribe':
      return <UnsubscribeContent content={content} update={update} />;
    default:
      return (
        <p className="text-xs text-muted-foreground">
          Questo tipo di blocco non ha impostazioni di contenuto.
        </p>
      );
  }
}

// -----------------------------------------------------------------------------
// Visibilità condizionale
// -----------------------------------------------------------------------------

const VISIBILITY_FIELDS = MERGE_TAGS.filter((tag) => tag.group !== 'sistema').map((tag) => ({
  value: tag.token.replace(/[{}\s]/g, ''),
  label: tag.label,
}));

const VISIBILITY_OPERATORS: Array<{
  value: NonNullable<EmailBlock['visibilityRule']>['operator'];
  label: string;
}> = [
  { value: 'eq', label: 'è uguale a' },
  { value: 'neq', label: 'è diverso da' },
  { value: 'gt', label: 'è maggiore di' },
  { value: 'lt', label: 'è minore di' },
  { value: 'is_not_empty', label: 'è valorizzato' },
  { value: 'is_empty', label: 'è vuoto' },
];

function VisibilityRuleEditor({ block }: { block: EmailBlock }) {
  const { actions } = useEditor();
  const rule = block.visibilityRule ?? null;
  const needsValue = rule ? !['is_empty', 'is_not_empty'].includes(rule.operator) : false;

  return (
    <div className="space-y-3">
      <SwitchField
        label="Mostra solo se…"
        checked={Boolean(rule)}
        hint="Il blocco appare unicamente ai destinatari che soddisfano la condizione."
        onChange={(checked) =>
          actions.updateBlockMeta(block.id, {
            visibilityRule: checked
              ? { field: 'contact.ordersCount', operator: 'gt', value: 0 }
              : null,
          })
        }
      />

      {rule ? (
        <div className="space-y-3 rounded-md border border-border/70 bg-muted/30 p-2.5">
          <SelectField
            label="Campo"
            value={rule.field}
            onChange={(field) => actions.updateBlockMeta(block.id, { visibilityRule: { ...rule, field } })}
            options={VISIBILITY_FIELDS}
          />
          <SelectField
            label="Condizione"
            value={rule.operator}
            onChange={(operator) =>
              actions.updateBlockMeta(block.id, { visibilityRule: { ...rule, operator } })
            }
            options={VISIBILITY_OPERATORS}
          />
          {needsValue ? (
            <Field label="Valore">
              <Input
                value={rule.value === null || rule.value === undefined ? '' : String(rule.value)}
                onChange={(event) => {
                  const raw = event.target.value;
                  const numeric = raw !== '' && !Number.isNaN(Number(raw));
                  actions.updateBlockMeta(block.id, {
                    visibilityRule: { ...rule, value: numeric ? Number(raw) : raw },
                  });
                }}
                className="h-8 text-sm"
              />
            </Field>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Pannello
// -----------------------------------------------------------------------------

export function BlockInspector({ found }: { found: FoundBlock }) {
  const { actions } = useEditor();
  const { block } = found;

  const update = React.useCallback<Update>(
    (patch) => actions.updateBlock(block.id, patch),
    [actions, block.id],
  );

  const type = (block.content?.type ?? block.type) as keyof typeof BLOCK_LABELS;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{BLOCK_LABELS[type]}</p>
          <p className="truncate font-mono text-[10px] text-muted-foreground">{block.id}</p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <SimpleTooltip content="Duplica blocco">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => actions.duplicateBlock(block.id)}
            >
              <Copy aria-hidden="true" />
              <span className="sr-only">Duplica blocco</span>
            </Button>
          </SimpleTooltip>
          <SimpleTooltip content="Elimina blocco">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 hover:text-destructive"
              onClick={() => actions.removeBlock(block.id)}
            >
              <Trash2 aria-hidden="true" />
              <span className="sr-only">Elimina blocco</span>
            </Button>
          </SimpleTooltip>
        </div>
      </div>

      <InspectorGroups defaultValue={['contenuto', 'aspetto']}>
        <InspectorSection value="contenuto" title="Contenuto" icon={<TypeIcon />}>
          <ContentEditor block={block} update={update} />
        </InspectorSection>

        <InspectorSection value="aspetto" title="Aspetto" icon={<Palette />}>
          <SpacingField
            label="Spaziatura interna"
            value={block.style.padding}
            onChange={(padding) => actions.updateBlockStyle(block.id, { padding })}
          />
          <ColorField
            allowEmpty
            label="Sfondo del blocco"
            value={block.style.backgroundColor}
            onChange={(backgroundColor) => actions.updateBlockStyle(block.id, { backgroundColor })}
          />
          <AlignField
            value={block.style.align ?? 'left'}
            onChange={(align) => actions.updateBlockStyle(block.id, { align })}
          />
          <BorderField
            value={block.style.border}
            onChange={(border) => actions.updateBlockStyle(block.id, { border })}
          />
        </InspectorSection>

        <InspectorSection value="visibilita" title="Visibilità" icon={<Eye />}>
          <SwitchField
            label="Nascondi su mobile"
            checked={Boolean(block.style.hideOnMobile)}
            onChange={(hideOnMobile) => actions.updateBlockStyle(block.id, { hideOnMobile })}
          />
          <SwitchField
            label="Nascondi su desktop"
            checked={Boolean(block.style.hideOnDesktop)}
            onChange={(hideOnDesktop) => actions.updateBlockStyle(block.id, { hideOnDesktop })}
          />
          <Separator />
          <VisibilityRuleEditor block={block} />
        </InspectorSection>

        <InspectorSection value="avanzate" title="Avanzate" icon={<Layers />}>
          <SwitchField
            label="Blocca la posizione"
            checked={Boolean(block.locked)}
            hint="Impedisce di trascinare il blocco per errore."
            onChange={(locked) => actions.updateBlockMeta(block.id, { locked })}
          />
          <Field
            label="Identificatore"
            hint="Compare negli avvisi di validazione dell’anteprima: utile per individuare il blocco segnalato."
          >
            <Input readOnly value={block.id} className="h-8 font-mono text-[11px]" />
          </Field>
          <Field label="Posizione" hint="Sezione e colonna che contengono il blocco.">
            <p className="rounded-md bg-muted/60 px-2.5 py-2 font-mono text-[11px] text-muted-foreground">
              {found.location.sectionId} · {found.location.columnId} · #{found.location.index + 1}
            </p>
          </Field>
        </InspectorSection>
      </InspectorGroups>
    </div>
  );
}
