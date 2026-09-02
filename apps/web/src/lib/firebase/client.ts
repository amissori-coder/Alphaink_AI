import { type FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import { type Auth, connectAuthEmulator, getAuth } from 'firebase/auth';
import {
  type Firestore,
  connectFirestoreEmulator,
  initializeFirestore,
  getFirestore,
} from 'firebase/firestore';
import {
  type Functions,
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from 'firebase/functions';
import { type FirebaseStorage, connectStorageEmulator, getStorage } from 'firebase/storage';

/** Regione delle Cloud Functions: deve combaciare con `functions/src/lib/config.ts`. */
export const FUNCTIONS_REGION = process.env.NEXT_PUBLIC_FUNCTIONS_REGION || 'europe-west1';

const USE_EMULATORS = process.env.NEXT_PUBLIC_USE_EMULATORS === 'true';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? '',
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

/** True se le variabili minime sono presenti (evita crash in build senza .env). */
export function isFirebaseConfigured(): boolean {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
}

// -----------------------------------------------------------------------------
// Inizializzazione lazy + singleton: il modulo viene importato anche durante il
// rendering server di Next.js, dove non deve produrre effetti collaterali.
// -----------------------------------------------------------------------------

let appInstance: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let firestoreInstance: Firestore | null = null;
let storageInstance: FirebaseStorage | null = null;
let functionsInstance: Functions | null = null;

let emulatorsConnected = false;

export function getFirebaseApp(): FirebaseApp {
  if (appInstance) return appInstance;
  appInstance = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  return appInstance;
}

export function getFirebaseAuth(): Auth {
  if (authInstance) return authInstance;
  authInstance = getAuth(getFirebaseApp());
  connectEmulatorsOnce();
  return authInstance;
}

export function getDb(): Firestore {
  if (firestoreInstance) return firestoreInstance;
  const app = getFirebaseApp();
  try {
    // `long polling` automatico: alcune reti aziendali bloccano lo streaming gRPC.
    firestoreInstance = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
  } catch {
    firestoreInstance = getFirestore(app);
  }
  connectEmulatorsOnce();
  return firestoreInstance;
}

export function getFirebaseStorage(): FirebaseStorage {
  if (storageInstance) return storageInstance;
  storageInstance = getStorage(getFirebaseApp());
  connectEmulatorsOnce();
  return storageInstance;
}

export function getFunctionsClient(): Functions {
  if (functionsInstance) return functionsInstance;
  functionsInstance = getFunctions(getFirebaseApp(), FUNCTIONS_REGION);
  connectEmulatorsOnce();
  return functionsInstance;
}

/** Collega gli emulatori una sola volta, solo lato browser. */
function connectEmulatorsOnce(): void {
  if (!USE_EMULATORS || emulatorsConnected || typeof window === 'undefined') return;
  emulatorsConnected = true;
  const host = process.env.NEXT_PUBLIC_EMULATOR_HOST || '127.0.0.1';
  try {
    if (authInstance) connectAuthEmulator(authInstance, `http://${host}:9099`, { disableWarnings: true });
    if (firestoreInstance) connectFirestoreEmulator(firestoreInstance, host, 8080);
    if (storageInstance) connectStorageEmulator(storageInstance, host, 9199);
    if (functionsInstance) connectFunctionsEmulator(functionsInstance, host, 5001);
  } catch {
    // Già collegato: ignora.
  }
}

// -----------------------------------------------------------------------------
// Proxy "pigri": permettono `import { firebaseAuth } from '@/lib/firebase/client'`
// senza inizializzare Firebase al momento dell'import (importante lato server).
// -----------------------------------------------------------------------------

function lazyProxy<T extends object>(factory: () => T): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      const instance = factory() as object;
      const value = Reflect.get(instance, prop);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(instance) : value;
    },
    set(_target, prop, value) {
      return Reflect.set(factory() as object, prop, value);
    },
    has(_target, prop) {
      return Reflect.has(factory() as object, prop);
    },
    ownKeys() {
      return Reflect.ownKeys(factory() as object);
    },
    getOwnPropertyDescriptor(_target, prop) {
      const descriptor = Reflect.getOwnPropertyDescriptor(factory() as object, prop);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
  });
}

export const firebaseApp: FirebaseApp = lazyProxy(getFirebaseApp);
export const firebaseAuth: Auth = lazyProxy(getFirebaseAuth);
export const firestore: Firestore = lazyProxy(getDb);
export const firebaseStorage: FirebaseStorage = lazyProxy(getFirebaseStorage);
export const functionsClient: Functions = lazyProxy(getFunctionsClient);

// -----------------------------------------------------------------------------
// Callable tipizzate
// -----------------------------------------------------------------------------

/** Messaggi in italiano per i codici d'errore delle Cloud Functions. */
const ERROR_MESSAGES: Record<string, string> = {
  cancelled: 'Operazione annullata.',
  unknown: 'Si è verificato un errore imprevisto. Riprova.',
  'invalid-argument': 'I dati inviati non sono validi.',
  'deadline-exceeded': 'L’operazione ha impiegato troppo tempo. Riprova.',
  'not-found': 'Elemento non trovato.',
  'already-exists': 'Esiste già un elemento con questi dati.',
  'permission-denied': 'Non hai i permessi necessari per questa operazione.',
  unauthenticated: 'Sessione scaduta: effettua di nuovo l’accesso.',
  'resource-exhausted': 'Limite di utilizzo raggiunto. Riprova più tardi.',
  'failed-precondition': 'Operazione non consentita nello stato attuale.',
  aborted: 'Operazione interrotta a causa di un conflitto. Riprova.',
  'out-of-range': 'Valore fuori dall’intervallo consentito.',
  unimplemented: 'Funzionalità non ancora disponibile.',
  internal: 'Errore interno del server. Riprova tra qualche istante.',
  unavailable: 'Servizio momentaneamente non raggiungibile. Controlla la connessione.',
  'data-loss': 'Alcuni dati non sono stati recuperati correttamente.',
};

/** Errore normalizzato con messaggio leggibile in italiano. */
export class CallableError extends Error {
  readonly code: string;
  readonly details: unknown;
  readonly functionName: string;

  constructor(functionName: string, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'CallableError';
    this.code = code;
    this.details = details;
    this.functionName = functionName;
  }
}

interface RawCallableError {
  code?: string;
  message?: string;
  details?: unknown;
}

function toCallableError(functionName: string, error: unknown): CallableError {
  const raw = (error ?? {}) as RawCallableError;
  const rawCode = typeof raw.code === 'string' ? raw.code.replace(/^functions\//, '') : 'unknown';
  const serverMessage = typeof raw.message === 'string' ? raw.message.trim() : '';
  // Le Functions restituiscono messaggi già in italiano: hanno priorità sul fallback.
  const isGenericMessage =
    !serverMessage ||
    serverMessage === 'INTERNAL' ||
    serverMessage.toLowerCase() === rawCode.replace(/-/g, ' ');
  const message = isGenericMessage
    ? ERROR_MESSAGES[rawCode] ?? ERROR_MESSAGES.unknown!
    : serverMessage;
  return new CallableError(functionName, rawCode, message, raw.details);
}

/**
 * Crea una funzione tipizzata che invoca una Cloud Function callable.
 * Gli errori sono rilanciati come `CallableError` con messaggi in italiano.
 */
export function callable<TIn = void, TOut = unknown>(
  name: string,
  options?: { timeoutMs?: number },
): (data: TIn) => Promise<TOut> {
  return async (data: TIn): Promise<TOut> => {
    try {
      const fn = httpsCallable<TIn, TOut>(getFunctionsClient(), name, {
        timeout: options?.timeoutMs ?? 120_000,
      });
      const result = await fn(data);
      return result.data;
    } catch (error) {
      throw toCallableError(name, error);
    }
  };
}
