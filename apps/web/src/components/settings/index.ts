/** Punto di ingresso dell'area Impostazioni. */

export { SettingsView } from './settings-view';
export { BrevoSettingsPanel } from './brevo-settings';
export { SiteSettingsPanel } from './site-settings';
export { TrackingSettingsPanel } from './tracking-settings';
export { BrandingSettingsPanel } from './branding-settings';
export { UsersSettingsPanel } from './users-settings';
export { SystemSettingsPanel } from './system-settings';

export { StoreCard } from './store-card';
export { SyncHistory } from './sync-history';
export { PermissionsMatrix } from './permissions-matrix';
export { FamilyRulesEditor, RepurchaseCyclesEditor } from './family-rules-editor';
export { CustomerGroupMapping, OrderStateMapping } from './mapping-editors';
export { EmailBrandPreview, sanitizeFooterHtml } from './email-brand-preview';
export type { BrandPreviewValues } from './email-brand-preview';

export {
  CheckResult,
  ConfiguredBadge,
  CopyButton,
  InlineSpinner,
  LoadError,
  ReadOnlyNotice,
  SaveBar,
  SectionSkeleton,
  SettingsField,
  SettingsGrid,
  SettingsSection,
  ToggleRow,
} from './settings-shell';

export {
  useBrandingSettings,
  useBrevoSettings,
  useSettingsForm,
  useSiteSettings,
  useSyncJobs,
  useTrackingSettings,
  useUsersList,
} from './use-settings';

export * from './types';
export { SETTINGS_TABS, isSettingsTab } from './constants';
