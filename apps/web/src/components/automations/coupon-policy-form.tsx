'use client';

import type { CouponPolicy, ProductFamily } from '@alphaink/shared';
import { BadgePercent } from 'lucide-react';
import * as React from 'react';

import { Combobox } from '@/components/ui/combobox';
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
import { cn } from '@/lib/utils';

import {
  COUPON_MODE_LABELS,
  DISCOUNT_TYPE_LABELS,
  PRODUCT_FAMILY_OPTIONS,
  defaultCouponPolicy,
  discountLabel,
} from './constants';

export interface CouponPolicyFormProps {
  value: CouponPolicy | null;
  /** `null` disattiva del tutto il coupon per lo step. */
  onChange: (next: CouponPolicy | null) => void;
  disabled?: boolean;
  className?: string;
  /** Identificativo di base dei campi: serve a tenere uniche le label. */
  idPrefix?: string;
}

/** Riepilogo in chiaro della politica, mostrato accanto all'interruttore. */
export function couponSummary(coupon: CouponPolicy): string {
  const parts = [
    `Sconto ${discountLabel(coupon)}`,
    `valido ${coupon.validForDays} ${coupon.validForDays === 1 ? 'giorno' : 'giorni'}`,
    coupon.mode === 'unique_per_contact'
      ? `codice unico con prefisso ${coupon.prefix || 'ALPHA'}`
      : `codice condiviso ${coupon.sharedCode || '(da definire)'}`,
  ];
  return parts.join(' · ');
}

/**
 * Politica coupon di uno step.
 *
 * Il codice non vive nel documento email: il motore lo emette per destinatario
 * al momento dell'invio e lo sostituisce nel merge tag `{{coupon.code}}`.
 */
export function CouponPolicyForm({
  value,
  onChange,
  disabled = false,
  className,
  idPrefix,
}: CouponPolicyFormProps) {
  const reactId = React.useId();
  const base = idPrefix ?? `coupon-${reactId}`;
  const active = Boolean(value?.enabled);

  const patch = (changes: Partial<CouponPolicy>) => {
    const current = value ?? defaultCouponPolicy();
    onChange({ ...current, ...changes });
  };

  const numericPatch = (
    field: 'discountValue' | 'validForDays',
    raw: string,
    fallback: number,
  ) => {
    const parsed = Number.parseFloat(raw.replace(',', '.'));
    patch({ [field]: Number.isFinite(parsed) ? Math.max(0, parsed) : fallback } as Partial<CouponPolicy>);
  };

  return (
    <div className={cn('rounded-lg border border-border bg-muted/30 p-3', className)}>
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
          aria-hidden="true"
        >
          <BadgePercent className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <Label htmlFor={`${base}-enabled`} className="text-sm font-medium text-foreground">
            Coupon dedicato
          </Label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {active && value
              ? couponSummary(value)
              : 'Nessun coupon: l’email viene inviata senza codice sconto.'}
          </p>
        </div>
        <Switch
          id={`${base}-enabled`}
          checked={active}
          disabled={disabled}
          aria-label="Genera un coupon per questo invio"
          onCheckedChange={(checked) =>
            checked ? onChange(defaultCouponPolicy()) : onChange(null)
          }
        />
      </div>

      {active && value ? (
        <div className="mt-4 grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${base}-mode`} className="text-xs text-muted-foreground">
              Tipo di codice
            </Label>
            <Select
              value={value.mode}
              disabled={disabled}
              onValueChange={(mode) => patch({ mode: mode as CouponPolicy['mode'] })}
            >
              <SelectTrigger id={`${base}-mode`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(COUPON_MODE_LABELS) as CouponPolicy['mode'][]).map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {COUPON_MODE_LABELS[mode]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {value.mode === 'shared' ? (
            <div className="space-y-1.5">
              <Label htmlFor={`${base}-shared`} className="text-xs text-muted-foreground">
                Codice condiviso
              </Label>
              <Input
                id={`${base}-shared`}
                value={value.sharedCode ?? ''}
                disabled={disabled}
                maxLength={40}
                placeholder="ALPHA10"
                onChange={(event) =>
                  patch({ sharedCode: event.target.value.toUpperCase().trim() || null })
                }
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor={`${base}-prefix`} className="text-xs text-muted-foreground">
                Prefisso del codice
              </Label>
              <Input
                id={`${base}-prefix`}
                value={value.prefix}
                disabled={disabled}
                maxLength={12}
                placeholder="ALPHA"
                onChange={(event) => patch({ prefix: event.target.value.toUpperCase().trim() })}
              />
              <p className="text-[11px] text-muted-foreground">
                Esempio: {(value.prefix || 'ALPHA').toUpperCase()}-A1B2-C3D4
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor={`${base}-discount-type`} className="text-xs text-muted-foreground">
              Tipo di sconto
            </Label>
            <Select
              value={value.discountType}
              disabled={disabled}
              onValueChange={(type) =>
                patch({ discountType: type as CouponPolicy['discountType'] })
              }
            >
              <SelectTrigger id={`${base}-discount-type`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(DISCOUNT_TYPE_LABELS) as CouponPolicy['discountType'][]).map(
                  (type) => (
                    <SelectItem key={type} value={type}>
                      {DISCOUNT_TYPE_LABELS[type]}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${base}-discount-value`} className="text-xs text-muted-foreground">
              Valore dello sconto
            </Label>
            <Input
              id={`${base}-discount-value`}
              type="number"
              inputMode="decimal"
              min={0}
              max={value.discountType === 'percent' ? 100 : 100000}
              step={value.discountType === 'percent' ? 1 : 0.5}
              value={String(value.discountValue)}
              disabled={disabled}
              endIcon={<span className="text-xs">{value.discountType === 'percent' ? '%' : '€'}</span>}
              onChange={(event) => numericPatch('discountValue', event.target.value, 0)}
              className="tabular-nums"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${base}-validity`} className="text-xs text-muted-foreground">
              Validità
            </Label>
            <Input
              id={`${base}-validity`}
              type="number"
              inputMode="numeric"
              min={1}
              max={365}
              step={1}
              value={String(value.validForDays)}
              disabled={disabled}
              endIcon={<span className="text-xs">giorni</span>}
              onChange={(event) => numericPatch('validForDays', event.target.value, 30)}
              className="tabular-nums"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${base}-min-total`} className="text-xs text-muted-foreground">
              Spesa minima
            </Label>
            <Input
              id={`${base}-min-total`}
              type="number"
              inputMode="decimal"
              min={0}
              step={1}
              value={value.minOrderTotal === null || value.minOrderTotal === undefined ? '' : String(value.minOrderTotal)}
              disabled={disabled}
              placeholder="Nessuna"
              endIcon={<span className="text-xs">€</span>}
              onChange={(event) => {
                const raw = event.target.value.trim();
                if (!raw) {
                  patch({ minOrderTotal: null });
                  return;
                }
                const parsed = Number.parseFloat(raw.replace(',', '.'));
                patch({ minOrderTotal: Number.isFinite(parsed) ? Math.max(0, parsed) : null });
              }}
              className="tabular-nums"
            />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={`${base}-families`} className="text-xs text-muted-foreground">
              Limita alle famiglie di prodotto
            </Label>
            <Combobox
              id={`${base}-families`}
              multiple
              options={PRODUCT_FAMILY_OPTIONS}
              value={(value.restrictToFamilies ?? []) as string[]}
              disabled={disabled}
              placeholder="Tutto il catalogo"
              searchPlaceholder="Cerca una famiglia…"
              emptyMessage="Nessuna famiglia trovata."
              onChange={(next) =>
                patch({ restrictToFamilies: (Array.isArray(next) ? next : [next]) as ProductFamily[] })
              }
            />
          </div>

          <div className="flex items-start gap-3 sm:col-span-2">
            <Switch
              id={`${base}-compatible`}
              checked={value.restrictToCompatibleSkus ?? false}
              disabled={disabled}
              onCheckedChange={(checked) => patch({ restrictToCompatibleSkus: checked })}
            />
            <div className="min-w-0">
              <Label htmlFor={`${base}-compatible`} className="text-sm">
                Solo consumabili compatibili
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Il coupon vale solo sugli articoli compatibili con la stampante acquistata dal
                cliente.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 sm:col-span-2">
            <Switch
              id={`${base}-on-site`}
              checked={value.createOnSite}
              disabled={disabled}
              onCheckedChange={(checked) => patch({ createOnSite: checked })}
            />
            <div className="min-w-0">
              <Label htmlFor={`${base}-on-site`} className="text-sm">
                Crea il codice sul negozio
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Senza questa opzione il codice compare nell’email ma non è spendibile su
                PrestaShop.
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
