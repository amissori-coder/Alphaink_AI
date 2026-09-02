'use client';

import { type AppUser, type Permission, type UserRole, hasPermission } from '@alphaink/shared';
import {
  GoogleAuthProvider,
  type User,
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import * as React from 'react';

import { callable, getDb, getFirebaseAuth, isFirebaseConfigured } from '@/lib/firebase/client';

export interface AuthContextValue {
  /** Utente Firebase Auth (null se non autenticato). */
  user: User | null;
  /** Profilo applicativo da `users/{uid}` (null finché non è caricato). */
  appUser: AppUser | null;
  /** Ruolo effettivo; `null` se l'utente non ha ancora un profilo. */
  role: UserRole | null;
  /** True durante la risoluzione iniziale della sessione. */
  loading: boolean;
  /** Errore dell'ultima operazione di autenticazione. */
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  can: (permission: Permission) => boolean;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

/** Messaggi in italiano per i codici d'errore di Firebase Auth. */
const AUTH_ERRORS: Record<string, string> = {
  'auth/invalid-email': 'Indirizzo email non valido.',
  'auth/user-disabled': 'Questo account è stato disattivato.',
  'auth/user-not-found': 'Nessun account trovato con questa email.',
  'auth/wrong-password': 'Password errata.',
  'auth/invalid-credential': 'Email o password non corretti.',
  'auth/too-many-requests': 'Troppi tentativi falliti. Riprova più tardi.',
  'auth/popup-closed-by-user': 'Finestra di accesso chiusa prima del completamento.',
  'auth/popup-blocked': 'Il browser ha bloccato la finestra di accesso.',
  'auth/cancelled-popup-request': 'Richiesta di accesso annullata.',
  'auth/network-request-failed': 'Connessione non riuscita. Verifica la rete.',
  'auth/unauthorized-domain': 'Dominio non autorizzato per l’accesso.',
  'auth/operation-not-allowed': 'Metodo di accesso non abilitato.',
};

function authErrorMessage(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  if (code && AUTH_ERRORS[code]) return AUTH_ERRORS[code]!;
  const message = (error as { message?: string } | null)?.message;
  return message?.trim() || 'Accesso non riuscito. Riprova.';
}

/** Esito della callable `bootstrapUser`. */
interface BootstrapUserResult {
  user: AppUser;
  created: boolean;
  /** Se true il token va rinfrescato per vedere i nuovi custom claim. */
  claimsUpdated: boolean;
}

const bootstrapUser = callable<void, BootstrapUserResult>('bootstrapUser');

/**
 * Allinea i custom claim del token al ruolo salvato su `users/{uid}`.
 *
 * Serve perché le regole Firestore leggono `request.auth.token.role`, mentre la
 * UI legge il documento: finché il token non viene rinfrescato i due valori
 * possono divergere fino a un'ora (durata dell'ID token). Succede al primo
 * accesso e ogni volta che un amministratore cambia il ruolo di qualcuno.
 */
async function syncRoleClaim(user: User, role: UserRole | null): Promise<void> {
  const token = await user.getIdTokenResult();
  if (token.claims.role !== role) {
    await user.getIdToken(true);
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<User | null>(null);
  const [appUser, setAppUser] = React.useState<AppUser | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Sessione Firebase Auth.
  React.useEffect(() => {
    if (!isFirebaseConfigured()) {
      setLoading(false);
      return;
    }
    const auth = getFirebaseAuth();
    const unsubscribe = onAuthStateChanged(
      auth,
      (nextUser) => {
        setUser(nextUser);
        if (!nextUser) {
          setAppUser(null);
          setLoading(false);
        }
      },
      (authError) => {
        setError(authErrorMessage(authError));
        setLoading(false);
      },
    );
    return unsubscribe;
  }, []);

  /** Uid per cui il bootstrap è già stato tentato: evita chiamate ripetute. */
  const bootstrappedFor = React.useRef<string | null>(null);

  // Profilo applicativo in tempo reale su `users/{uid}`.
  React.useEffect(() => {
    if (!user) return;
    let active = true;
    const reference = doc(getDb(), 'users', user.uid);
    const unsubscribe = onSnapshot(
      reference,
      (snapshot) => {
        if (!active) return;

        if (!snapshot.exists()) {
          // Primo accesso: il profilo non c'è ancora. Il trigger Auth lo crea solo
          // per gli account registrati dopo il deploy, quindi lo creiamo qui.
          // Senza questo passaggio l'utente resterebbe senza ruolo e senza claim,
          // e ogni lettura verrebbe respinta dalle regole Firestore.
          setAppUser(null);
          if (bootstrappedFor.current !== user.uid) {
            bootstrappedFor.current = user.uid;
            void bootstrapUser()
              .then(async (result) => {
                if (result.claimsUpdated) await user.getIdToken(true);
              })
              .catch((bootstrapError) => {
                if (active) setError(authErrorMessage(bootstrapError));
              })
              .finally(() => {
                if (active) setLoading(false);
              });
            return;
          }
          setLoading(false);
          return;
        }

        const profile = { id: snapshot.id, ...snapshot.data() } as AppUser;
        setAppUser(profile);
        setLoading(false);
        void syncRoleClaim(user, profile.disabled ? null : profile.role).catch(() => {
          // Un refresh del token fallito non deve bloccare la UI: al più le
          // letture restano governate dal claim precedente fino alla scadenza.
        });
      },
      (snapshotError) => {
        if (!active) return;
        // Regole Firestore restrittive o profilo mancante: si resta senza ruolo.
        setError(authErrorMessage(snapshotError));
        setAppUser(null);
        setLoading(false);
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [user]);

  const signIn = React.useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      const auth = getFirebaseAuth();
      await setPersistence(auth, browserLocalPersistence);
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (signInError) {
      const message = authErrorMessage(signInError);
      setError(message);
      throw new Error(message);
    }
  }, []);

  const signInWithGoogle = React.useCallback(async () => {
    setError(null);
    try {
      const auth = getFirebaseAuth();
      await setPersistence(auth, browserLocalPersistence);
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    } catch (googleError) {
      const message = authErrorMessage(googleError);
      setError(message);
      throw new Error(message);
    }
  }, []);

  const signOut = React.useCallback(async () => {
    await firebaseSignOut(getFirebaseAuth());
    setAppUser(null);
  }, []);

  const resetPassword = React.useCallback(async (email: string) => {
    setError(null);
    try {
      await sendPasswordResetEmail(getFirebaseAuth(), email.trim());
    } catch (resetError) {
      const message = authErrorMessage(resetError);
      setError(message);
      throw new Error(message);
    }
  }, []);

  const role = appUser?.disabled ? null : appUser?.role ?? null;

  const can = React.useCallback(
    (permission: Permission) => hasPermission(role, permission),
    [role],
  );

  const value = React.useMemo<AuthContextValue>(
    () => ({
      user,
      appUser,
      role,
      loading,
      error,
      signIn,
      signInWithGoogle,
      signOut,
      resetPassword,
      can,
    }),
    [user, appUser, role, loading, error, signIn, signInWithGoogle, signOut, resetPassword, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Accesso al contesto di autenticazione. Va usato dentro `<AuthProvider>`. */
export function useAuth(): AuthContextValue {
  const context = React.useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve essere usato all’interno di <AuthProvider>.');
  }
  return context;
}

export interface RequirePermissionProps {
  permission: Permission;
  /** Contenuto mostrato quando il permesso manca. Default: nulla. */
  fallback?: React.ReactNode;
  /** Contenuto mostrato durante il caricamento della sessione. */
  loadingFallback?: React.ReactNode;
  children: React.ReactNode;
}

/** Mostra i figli solo se l'utente possiede il permesso richiesto. */
export function RequirePermission({
  permission,
  fallback = null,
  loadingFallback = null,
  children,
}: RequirePermissionProps) {
  const { can, loading } = useAuth();
  if (loading) return <>{loadingFallback}</>;
  return <>{can(permission) ? children : fallback}</>;
}
