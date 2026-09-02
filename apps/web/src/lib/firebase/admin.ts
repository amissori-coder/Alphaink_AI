// -----------------------------------------------------------------------------
// ⚠️  MODULO RISERVATO AL SERVER
// Questo file usa il Firebase Admin SDK e non deve MAI essere importato da un
// componente client (`'use client'`) né da codice che finisce nel bundle del
// browser: esporrebbe credenziali con privilegi completi.
// Usalo solo in Server Component, Route Handler o Server Action.
// (`server-only` non è tra le dipendenze del progetto: questo commento è la guardia.)
// -----------------------------------------------------------------------------

import { type App, applicationDefault, cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { type Auth, getAuth } from 'firebase-admin/auth';
import { type Firestore, getFirestore } from 'firebase-admin/firestore';

const ADMIN_APP_NAME = 'alphaink-admin';

let appInstance: App | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;

/** Credenziali: service account JSON inline se presente, altrimenti ADC. */
function resolveCredential() {
  const inlineJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (inlineJson) {
    try {
      const parsed = JSON.parse(inlineJson) as {
        project_id?: string;
        client_email?: string;
        private_key?: string;
      };
      if (parsed.project_id && parsed.client_email && parsed.private_key) {
        return cert({
          projectId: parsed.project_id,
          clientEmail: parsed.client_email,
          // Le newline vengono spesso salvate come "\n" letterali nelle variabili d'ambiente.
          privateKey: parsed.private_key.replace(/\\n/g, '\n'),
        });
      }
    } catch {
      // JSON malformato: si ricade sulle credenziali di default dell'ambiente.
    }
  }
  return applicationDefault();
}

/** App Admin singleton (evita il doppio init con l'hot reload di Next.js). */
export function getAdminApp(): App {
  if (appInstance) return appInstance;
  const existing = getApps().find((app) => app.name === ADMIN_APP_NAME);
  appInstance =
    existing ??
    initializeApp(
      {
        credential: resolveCredential(),
        projectId:
          process.env.FIREBASE_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? undefined,
        storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? undefined,
      },
      ADMIN_APP_NAME,
    );
  return appInstance;
}

export function getAdminAuth(): Auth {
  if (!authInstance) authInstance = getAuth(getAdminApp());
  return authInstance;
}

export function getAdminDb(): Firestore {
  if (!dbInstance) {
    dbInstance = getFirestore(getAdminApp());
    try {
      dbInstance.settings({ ignoreUndefinedProperties: true });
    } catch {
      // `settings()` è già stato chiamato su questa istanza: ignora.
    }
  }
  return dbInstance;
}

function lazyProxy<T extends object>(factory: () => T): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      const instance = factory() as object;
      const value = Reflect.get(instance, prop);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(instance) : value;
    },
    has(_target, prop) {
      return Reflect.has(factory() as object, prop);
    },
  });
}

export const adminApp: App = lazyProxy(getAdminApp);
export const adminAuth: Auth = lazyProxy(getAdminAuth);
export const adminDb: Firestore = lazyProxy(getAdminDb);

/**
 * Verifica un ID token e restituisce l'utente, oppure `null` se non valido.
 * Utile nei Route Handler per proteggere gli endpoint server.
 */
export async function verifyIdToken(idToken: string | null | undefined) {
  if (!idToken) return null;
  try {
    return await getAdminAuth().verifyIdToken(idToken.replace(/^Bearer\s+/i, ''), true);
  } catch {
    return null;
  }
}

/** Usa `getApp()` solo se serve l'app di default (compatibilità). */
export function getDefaultAdminApp(): App | null {
  return getApps().length > 0 ? getApp() : null;
}
