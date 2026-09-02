'use client';

/**
 * Anteprima dal vivo di un'email di esempio con l'identità visiva corrente.
 *
 * Non è il motore di rendering delle newsletter (quello vive nelle Functions):
 * serve a capire subito l'effetto di palette, font e footer mentre si modificano
 * le impostazioni. Per questo usa stili in linea, esattamente come farebbe
 * l'HTML spedito ai client di posta.
 */

import * as React from 'react';

import { cn } from '@/lib/utils';

export interface BrandPreviewValues {
  companyName: string;
  logoUrl?: string | null;
  websiteUrl: string;
  address: string;
  legalName: string;
  vatNumber: string;
  supportEmail: string;
  palette: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    surface: string;
    text: string;
    muted: string;
    success: string;
    danger: string;
  };
  fonts: { heading: string; body: string };
  legalFooterHtml: string;
  unsubscribeText: string;
  socialLinks: Array<{ network: string; url: string }>;
}

/**
 * Ripulisce l'HTML del footer prima di mostrarlo nell'anteprima.
 * Il contenuto è scritto da un amministratore, ma script e gestori di eventi
 * non hanno comunque senso in un'email: si rimuovono.
 */
export function sanitizeFooterHtml(html: string): string {
  return html
    .replace(/<\s*(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed)[^>]*\/?>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:/gi, '');
}

export interface EmailBrandPreviewProps {
  values: BrandPreviewValues;
  className?: string;
}

export function EmailBrandPreview({ values, className }: EmailBrandPreviewProps) {
  const { palette, fonts } = values;
  const footerHtml = React.useMemo(
    () => sanitizeFooterHtml(values.legalFooterHtml),
    [values.legalFooterHtml],
  );

  const bodyFont = `${fonts.body}, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;
  const headingFont = `${fonts.heading}, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;

  return (
    <div
      className={cn('overflow-hidden rounded-lg border border-border', className)}
      role="img"
      aria-label="Anteprima di un’email con l’identità visiva corrente"
    >
      <div style={{ backgroundColor: palette.background, padding: 20 }}>
        <div
          style={{
            backgroundColor: palette.surface,
            borderRadius: 12,
            overflow: 'hidden',
            margin: '0 auto',
            maxWidth: 480,
            fontFamily: bodyFont,
            color: palette.text,
          }}
        >
          {/* Intestazione */}
          <div
            style={{
              padding: '18px 24px',
              borderBottom: `1px solid ${palette.muted}33`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            {values.logoUrl ? (
              <img
                src={values.logoUrl}
                alt={values.companyName}
                style={{ maxHeight: 32, maxWidth: 160, objectFit: 'contain' }}
              />
            ) : (
              <span style={{ fontFamily: headingFont, fontSize: 18, fontWeight: 700, color: palette.primary }}>
                {values.companyName || 'AlphaInk'}
              </span>
            )}
            <span style={{ fontSize: 11, color: palette.muted }}>Newsletter</span>
          </div>

          {/* Corpo */}
          <div style={{ padding: '24px' }}>
            <span
              style={{
                display: 'inline-block',
                backgroundColor: palette.accent,
                color: '#0F172A',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 700,
                padding: '3px 10px',
                marginBottom: 12,
              }}
            >
              OFFERTA DELLA SETTIMANA
            </span>
            <h1
              style={{
                fontFamily: headingFont,
                fontSize: 22,
                lineHeight: 1.25,
                margin: '0 0 10px',
                color: palette.text,
              }}
            >
              Toner compatibili fino al 30% in meno
            </h1>
            <p style={{ fontSize: 14, lineHeight: 1.6, margin: '0 0 8px', color: palette.text }}>
              Ciao Mario, per la tua HP LaserJet abbiamo rifornito i toner ad alta capacità. Spedizione
              in 24 ore su tutti gli ordini.
            </p>
            <p style={{ fontSize: 13, lineHeight: 1.6, margin: '0 0 18px', color: palette.muted }}>
              Codice sconto dedicato, valido fino a domenica.
            </p>

            <a
              href={values.websiteUrl || 'https://alphaink.net'}
              onClick={(event) => event.preventDefault()}
              style={{
                display: 'inline-block',
                backgroundColor: palette.primary,
                color: '#FFFFFF',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                padding: '11px 22px',
                textDecoration: 'none',
              }}
            >
              Scopri le offerte
            </a>

            <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
              <span
                style={{
                  flex: 1,
                  border: `1px solid ${palette.success}55`,
                  backgroundColor: `${palette.success}14`,
                  borderRadius: 8,
                  padding: '8px 10px',
                  fontSize: 11,
                  color: palette.text,
                }}
              >
                Disponibile in magazzino
              </span>
              <span
                style={{
                  flex: 1,
                  border: `1px solid ${palette.danger}55`,
                  backgroundColor: `${palette.danger}14`,
                  borderRadius: 8,
                  padding: '8px 10px',
                  fontSize: 11,
                  color: palette.text,
                }}
              >
                Ultimi 3 pezzi
              </span>
            </div>
          </div>

          {/* Piè di pagina */}
          <div
            style={{
              backgroundColor: palette.background,
              padding: '16px 24px',
              fontSize: 11,
              lineHeight: 1.6,
              color: palette.muted,
            }}
          >
            {values.socialLinks.length > 0 ? (
              <p style={{ margin: '0 0 6px', color: palette.secondary, fontWeight: 600 }}>
                {values.socialLinks.map((link) => link.network).join(' · ')}
              </p>
            ) : null}
            <p style={{ margin: '0 0 4px' }}>
              {values.legalName || values.companyName}
              {values.vatNumber ? ` · P.IVA ${values.vatNumber}` : ''}
            </p>
            {values.address ? <p style={{ margin: '0 0 4px' }}>{values.address}</p> : null}
            {values.supportEmail ? <p style={{ margin: '0 0 8px' }}>{values.supportEmail}</p> : null}
            <div
              style={{ margin: '0 0 8px' }}
              // Contenuto redatto da un amministratore e già ripulito da script ed eventi.
              dangerouslySetInnerHTML={{ __html: footerHtml }}
            />
            <p style={{ margin: 0 }}>
              {values.unsubscribeText}{' '}
              <span style={{ color: palette.primary, textDecoration: 'underline' }}>
                Disiscriviti
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
