# Guida all'installazione

Procedura completa per portare la AlphaInk Newsletter Suite da zero a un ambiente funzionante.
Segui i passi nell'ordine: alcuni dipendono da quelli precedenti.

Tempo indicativo: 45-60 minuti, escluse le attese di propagazione DNS per la verifica del dominio
su Brevo (vedi [`BREVO.md`](BREVO.md)).

---

## 1. Prerequisiti locali

```bash
node --version      # deve essere >= 20
npm --version       # >= 10
firebase --version  # se manca:  npm i -g firebase-tools
```

Accedi alla CLI Firebase e verifica di vedere il tuo account:

```bash
firebase login
firebase projects:list
```

---

## 2. Creazione del progetto Firebase

1. Vai su <https://console.firebase.google.com> e crea un nuovo progetto.
   L'id di progetto atteso dalla configurazione del repository è **`alphaink-newsletter`**
   (`.firebaserc`). Se ne usi uno diverso, allinealo con:

   ```bash
   firebase use --add        # scegli il progetto e assegnagli l'alias "default"
   ```

2. **Passa al piano Blaze** (Impostazioni → Utilizzo e fatturazione → Dettagli e impostazioni →
   Modifica piano). È obbligatorio: le Cloud Functions di seconda generazione e le chiamate HTTP
   in uscita verso Brevo e PrestaShop non sono disponibili sul piano Spark.

3. Imposta la **regione predefinita delle risorse** su `europe-west1`. Deve coincidere con la
   costante `REGION` di `functions/src/lib/config.ts`, altrimenti la web app chiamerà endpoint
   inesistenti.

---

## 3. Servizi da abilitare

Nella console Firebase, in quest'ordine.

### 3.1 Authentication

1. Build → Authentication → Inizia.
2. Abilita i metodi che vuoi usare. Il minimo funzionante è **Email/Password**; se il team usa
   Google Workspace, abilita anche **Google**.
3. In Impostazioni → Domini autorizzati, aggiungi il dominio della web app
   (`newsletter.alphaink.net` o quello che userai).

### 3.2 Cloud Firestore

1. Build → Firestore Database → Crea database.
2. Modalità **produzione** (le regole del repository verranno caricate al passo 8).
3. Posizione: **`eur3`** o **`europe-west1`**. La posizione non è più modificabile dopo la
   creazione: sceglila con attenzione.

### 3.3 Cloud Storage

1. Build → Storage → Inizia.
2. Modalità produzione, stessa regione europea.
3. Annota il nome del bucket (`<progetto>.appspot.com` oppure `<progetto>.firebasestorage.app`):
   ti serve per `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`.

### 3.4 Cloud Functions

Non c'è nulla da abilitare a mano: il primo `firebase deploy --only functions` attiva le API
necessarie (Cloud Functions, Cloud Build, Artifact Registry, Cloud Scheduler, Secret Manager,
Eventarc). La prima esecuzione chiede conferma per abilitarle — accetta.

### 3.5 Hosting (opzionale ma consigliato)

`firebase.json` configura l'hosting con `source: apps/web` e il framework backend in
`europe-west1`. Se preferisci pubblicare la web app altrove (Vercel, Cloud Run) puoi farlo: in
quel caso salta il deploy dell'hosting al passo 8 e imposta `APP_URL` sul dominio reale.

---

## 4. Registrazione dell'app web e chiavi pubbliche

1. Console Firebase → icona ingranaggio → Impostazioni progetto → Le tue app → **Web** (`</>`).
2. Registra l'app (non serve attivare Firebase Hosting da qui se l'hai già).
3. Copia l'oggetto `firebaseConfig`: contiene `apiKey`, `authDomain`, `projectId`,
   `storageBucket`, `messagingSenderId`, `appId` e a volte `measurementId`.

Questi valori sono **pubblici per progettazione** (finiscono nel bundle JavaScript del browser):
la sicurezza è garantita dalle regole Firestore e Storage, non dalla segretezza di queste chiavi.

---

## 5. Variabili d'ambiente della web app

Crea `apps/web/.env.local` partendo dal modello nella radice:

```bash
cp .env.example apps/web/.env.local
```

Compila almeno queste voci:

```dotenv
# --- Firebase (client, pubbliche) -------------------------------------------
NEXT_PUBLIC_FIREBASE_API_KEY=AIza...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=alphaink-newsletter.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=alphaink-newsletter
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=alphaink-newsletter.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=000000000000
NEXT_PUBLIC_FIREBASE_APP_ID=1:000000000000:web:xxxxxxxxxxxx
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=G-XXXXXXXXXX

# Deve combaciare con REGION in functions/src/lib/config.ts
NEXT_PUBLIC_FUNCTIONS_REGION=europe-west1

# true solo in sviluppo con gli emulatori attivi
NEXT_PUBLIC_USE_EMULATORS=false

# Dominio pubblico della web app: usato nei link tracciati e nel footer
NEXT_PUBLIC_APP_URL=https://newsletter.alphaink.net
```

**Solo per lo sviluppo locale**, se usi le route `/api/*` (anteprima ed esportazione) fuori dagli
emulatori, servono anche le credenziali dell'Admin SDK:

```dotenv
GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json
FIREBASE_PROJECT_ID=alphaink-newsletter
```

Scarica il file da Impostazioni progetto → Account di servizio → Genera nuova chiave privata.
**Non committarlo**: è già coperto da `.gitignore`. In produzione (App Hosting o Cloud Run) le
credenziali sono automatiche (ADC) e queste due righe non servono.

> Le variabili `BREVO_*` e `PRESTASHOP_*` presenti in `.env.example` sono lì come promemoria della
> configurazione complessiva. Le Cloud Functions **non** le leggono da `.env.local`: le prendono da
> Secret Manager e dai parametri, come descritto nei prossimi due paragrafi.

---

## 6. Secret delle Cloud Functions

Sono otto, tutti dichiarati con `defineSecret` in `functions/src/lib/config.ts`. Si impostano una
volta con la CLI; il comando chiede il valore in modo interattivo, senza farlo comparire nella
cronologia della shell.

| Secret | Contenuto | Obbligatorio |
| --- | --- | --- |
| `BREVO_API_KEY` | Chiave API v3 dell'account Brevo | **Sì** |
| `BREVO_WEBHOOK_SECRET` | Token condiviso verificato sui webhook Brevo in ingresso | **Sì** |
| `SITE_WEBHOOK_SECRET` | Token condiviso per firmare i webhook inviati dai due PrestaShop | Sì se usi i webhook del sito |
| `LINK_SIGNING_KEY` | Chiave HMAC per link tracciati, pixel e token di disiscrizione | **Sì** |
| `PRESTASHOP_B2C_WS_KEY` | Chiave Webservice del negozio B2C | Sì in modalità `webservice` |
| `PRESTASHOP_B2B_WS_KEY` | Chiave Webservice del negozio B2B | Sì in modalità `webservice` |
| `PRESTASHOP_B2C_DB_PASSWORD` | Password dell'utente MySQL in sola lettura, B2C | Sì in modalità `mysql` |
| `PRESTASHOP_B2B_DB_PASSWORD` | Password dell'utente MySQL in sola lettura, B2B | Sì in modalità `mysql` |

Comandi:

```bash
firebase functions:secrets:set BREVO_API_KEY
firebase functions:secrets:set BREVO_WEBHOOK_SECRET
firebase functions:secrets:set SITE_WEBHOOK_SECRET
firebase functions:secrets:set LINK_SIGNING_KEY
firebase functions:secrets:set PRESTASHOP_B2C_WS_KEY
firebase functions:secrets:set PRESTASHOP_B2B_WS_KEY
firebase functions:secrets:set PRESTASHOP_B2C_DB_PASSWORD
firebase functions:secrets:set PRESTASHOP_B2B_DB_PASSWORD
```

Anche i secret che non userai subito (per esempio le password MySQL se parti in modalità
Webservice) vanno creati con un valore segnaposto: una funzione che dichiara un secret inesistente
non si avvia.

Genera i due segreti "nostri" — `LINK_SIGNING_KEY` e `SITE_WEBHOOK_SECRET` — con un valore
casuale lungo, mai a mano:

```bash
openssl rand -base64 48
```

`BREVO_WEBHOOK_SECRET` finisce nella query string dell'URL registrato su Brevo: usa un valore
casuale **senza caratteri da codificare** (solo lettere, cifre, `-` e `_`):

```bash
openssl rand -hex 32
```

Comandi utili per la manutenzione:

```bash
firebase functions:secrets:access BREVO_API_KEY      # legge il valore corrente
firebase functions:secrets:prune                     # elimina le versioni non più referenziate
```

> **Rotazione di `LINK_SIGNING_KEY`**: cambiarla invalida le firme dei link già spediti. I
> redirector continuano comunque a reindirizzare (per non rompere l'esperienza del cliente) ma non
> registrano più il click, e i token di disiscrizione già inviati smettono di funzionare. Ruotala
> solo in caso di compromissione.

---

## 7. Parametri non sensibili delle Functions

Sono dichiarati con `defineString` e hanno un valore predefinito. Vanno indicati solo se il tuo
ambiente differisce dal default.

| Parametro | Default | A cosa serve |
| --- | --- | --- |
| `APP_URL` | `https://newsletter.alphaink.net` | Base dei link tracciati, del footer e delle pagine pubbliche |
| `PRESTASHOP_B2C_BASE_URL` | `https://alphaink.net` | URL del negozio B2C |
| `PRESTASHOP_B2C_DB_HOST` | *(vuoto)* | Host MySQL B2C |
| `PRESTASHOP_B2C_DB_PORT` | `3306` | Porta MySQL B2C |
| `PRESTASHOP_B2C_DB_USER` | *(vuoto)* | Utente MySQL B2C |
| `PRESTASHOP_B2C_DB_NAME` | *(vuoto)* | Nome del database B2C |
| `PRESTASHOP_B2B_BASE_URL` | `https://b2b.alphaink.net` | URL del negozio B2B |
| `PRESTASHOP_B2B_DB_HOST` | *(vuoto)* | Host MySQL B2B |
| `PRESTASHOP_B2B_DB_PORT` | `3306` | Porta MySQL B2B |
| `PRESTASHOP_B2B_DB_USER` | *(vuoto)* | Utente MySQL B2B |
| `PRESTASHOP_B2B_DB_NAME` | *(vuoto)* | Nome del database B2B |

Il modo più semplice per fissarli è un file `functions/.env` (non committato):

```dotenv
APP_URL=https://newsletter.alphaink.net
PRESTASHOP_B2C_BASE_URL=https://alphaink.net
PRESTASHOP_B2C_DB_HOST=db.alphaink.net
PRESTASHOP_B2C_DB_PORT=3306
PRESTASHOP_B2C_DB_USER=alphaink_newsletter_ro
PRESTASHOP_B2C_DB_NAME=alphaink_b2c
PRESTASHOP_B2B_BASE_URL=https://b2b.alphaink.net
PRESTASHOP_B2B_DB_HOST=db.alphaink.net
PRESTASHOP_B2B_DB_PORT=3306
PRESTASHOP_B2B_DB_USER=alphaink_newsletter_ro
PRESTASHOP_B2B_DB_NAME=alphaink_b2b
```

In alternativa la CLI li chiede al primo deploy che li incontra e salva la risposta in
`functions/.env.<progetto>`.

Il resto della configurazione dei negozi — modalità (`webservice` o `mysql`), id shop del
multistore, prefisso tabelle, lingua, mappa degli stati ordine, mappa dei gruppi cliente — **non**
è in queste variabili: vive su Firestore in `settings/site` e si modifica dalla UI in
Impostazioni → Sito. Vedi [`INTEGRAZIONE-SITO.md`](INTEGRAZIONE-SITO.md).

---

## 8. Primo deploy

```bash
# Dalla radice del repository
npm install
npm run build                    # shared + web + functions: fallisce qui, non in produzione

# Regole e indici (veloce, farlo per primo)
firebase deploy --only firestore:rules,firestore:indexes,storage

# Cloud Functions
firebase deploy --only functions

# Hosting (se pubblichi la web app su Firebase)
firebase deploy --only hosting
```

Oppure, in un colpo solo:

```bash
npm run deploy                   # build completa + firebase deploy
```

Note sul primo deploy:

- Il deploy delle Functions crea anche i **job di Cloud Scheduler** delle otto funzioni
  programmate. Verificali su <https://console.cloud.google.com/cloudscheduler>: devono essere otto
  e tutti in stato `ENABLED`.
- La costruzione degli **indici compositi** richiede tempo (da minuti a ore, secondo la quantità
  di dati). Fino al completamento alcune query falliscono con un errore che contiene il link
  diretto per creare l'indice mancante: seguirlo è sicuro.
- Al primo deploy Firebase chiede il permesso di abilitare diverse API Google Cloud: accetta.

---

## 9. Instradamento dei percorsi pubblici

I link dentro le email sono costruiti su `APP_URL`:

| Percorso | Cloud Function | A cosa serve |
| --- | --- | --- |
| `/t/c?u=…&r=…&c=…&s=…` | `trackClick` | Redirector firmato dei click |
| `/t/o?r=…&c=…&s=…` | `trackOpen` | Pixel di apertura |
| `/u/<token>` | `unsubscribePage` | Disiscrizione |
| `/p/<token>` | `preferencesPage` | Preferenze di frequenza |
| `/w?n=…&c=…&s=…` | `webviewPage` | "Vedi nel browser" |

Le funzioni sono raggiungibili all'endpoint standard
`https://europe-west1-<progetto>.cloudfunctions.net/<nome>` e accettano i parametri sia dal
percorso sia dalla query string. Perché i link nelle email funzionino serve **una** di queste due
soluzioni:

- **A.** Aggiungere in `firebase.json` le riscritture da quei percorsi alle funzioni
  corrispondenti, e lasciare `APP_URL` sul dominio della web app.
- **B.** Puntare `APP_URL` a un dominio (o a un reverse proxy) che inoltri quei percorsi alle
  Cloud Functions.

Il repository non include le riscritture: sceglile in base a dove pubblichi la web app.
**Verifica sempre con un invio di prova** (`sendTestEmail`) prima della prima campagna reale: apri
il messaggio, clicca un link e controlla di finire sul sito passando dal redirector, poi apri il
link di disiscrizione e verifica che mostri la pagina corretta.

---

## 10. Primo utente owner

Il primo account che accede diventa automaticamente **owner**; tutti i successivi nascono
`viewer`. La logica è in `functions/src/users/triggers.ts:78`: la verifica "esiste già un utente?"
avviene dentro una transazione, quindi due registrazioni simultanee non possono produrre due
owner.

1. Crea l'account in Console Firebase → Authentication → Utenti → **Aggiungi utente**
   (email e password), oppure registrati dalla pagina di login della web app se hai abilitato la
   registrazione.
2. Accedi alla web app. Al primo accesso la UI invoca la callable `bootstrapUser`, che:
   - crea il documento `users/{uid}`;
   - assegna il ruolo `owner` (perché è il primo utente);
   - scrive i **custom claim** `role` e `disabled` sul token.
3. Se l'interfaccia mostra ancora permessi da `viewer`, **esci e rientra**: i custom claim entrano
   nel token solo al rinnovo. La web app chiede da sola un `getIdToken(true)` quando
   `bootstrapUser` segnala `claimsUpdated: true`, ma un accesso pulito toglie ogni dubbio.

Da quel momento gli altri utenti si gestiscono dalla UI in **Impostazioni → Utenti**
(callable `setUserRole`, permesso `users:manage`). Due protezioni impediscono di restare chiusi
fuori: nessuno può modificare il proprio ruolo o disabilitarsi da solo, e non si può togliere il
ruolo all'ultimo owner rimasto.

Ruoli disponibili, dal più al meno potente: `owner`, `admin`, `editor`, `analyst`, `viewer`.
La matrice completa dei permessi è in [`MODELLO-DATI.md`](MODELLO-DATI.md), §5.

---

## 11. Installazione predefinita: `seedDefaults`

`seedDefaults` prepara un'installazione nuova (o completa una esistente). Richiede il permesso
`settings:write`, quindi ruolo `admin` o superiore. Fa tre cose, tutte idempotenti:

1. crea i quattro documenti di `settings` — `brevo`, `site`, `branding`, `tracking` — con i valori
   predefiniti condivisi; sui documenti già presenti **aggiunge solo le chiavi mancanti**, utile
   dopo un aggiornamento che introduce nuove impostazioni;
2. installa i cinque template di sistema: *Promo Toner*, *Novità Prodotti*, *Saldi Stagionali*,
   *Newsletter Informativa*, *Offerta B2B Rivenditori*;
3. crea le automazioni predefinite, tutte **disattivate**.

Non sovrascrive il lavoro dell'operatore: le impostazioni già valorizzate restano com'erano e i
template già presenti conservano il contenuto, a meno di passare `overwriteTemplates: true`.

**Come eseguirlo.** Dalla web app, in Impostazioni → Sistema, se la UI espone il pulsante
corrispondente. In alternativa dalla console del browser, con l'utente owner già autenticato:

```js
// Su una pagina della web app, con la sessione attiva
const { getFunctions, httpsCallable } = await import('firebase/functions');
const fns = getFunctions(undefined, 'europe-west1');
const risultato = await httpsCallable(fns, 'seedDefaults')({});
console.log(risultato.data);
```

La risposta elenca, per ciascun documento e template, se è stato `creato`, `completato` (chiavi
mancanti aggiunte) o lasciato `invariato`, e quali automazioni sono state create.

Puoi rieseguirlo in sicurezza in qualsiasi momento — per esempio dopo un aggiornamento
dell'applicazione — per far comparire le impostazioni nuove.

---

## 12. Configurazione applicativa

Con l'installazione in piedi, completa la configurazione dalla UI in **Impostazioni**:

| Scheda | Cosa configurare | Documento di riferimento |
| --- | --- | --- |
| **Brevo** | Chiave API, mittenti, registrazione dei webhook, sincronizzazione contatti | [`BREVO.md`](BREVO.md) |
| **Sito** | Per ogni negozio: abilitazione, URL, modalità, id multistore, prefisso tabelle, lingua, mappa degli stati ordine, mappa dei gruppi cliente; regole delle famiglie prodotto; cicli di riacquisto; soglie di abbandono | [`INTEGRAZIONE-SITO.md`](INTEGRAZIONE-SITO.md) |
| **Brand** | Nome, ragione sociale, indirizzo, P.IVA, email di assistenza, logo, palette, font, footer legale | — |
| **Tracciamento** | Modello di attribuzione e finestre, UTM automatici, redirector proprietario, esclusione delle aperture proxy | [`TRACKING.md`](TRACKING.md) |
| **Utenti** | Ruoli del team | §10 di questo documento |

Ordine consigliato: **Brand** (l'identità visiva viene usata dai template e dalle automazioni) →
**Brevo** → **Sito** → prima sincronizzazione → **Tracciamento** → attivazione delle automazioni.

---

## 13. Prima sincronizzazione

1. In Impostazioni → Sito, verifica la connessione di ciascun negozio con il pulsante di prova:
   in modalità Webservice il controllo verifica anche che la chiave abbia i permessi sulle risorse
   `customers`, `orders`, `carts`, `products`, `categories`, `groups`, `order_states`.
2. Avvia una sincronizzazione manuale su un solo negozio, partendo da una finestra breve (per
   esempio gli ultimi 30 giorni) per validare la mappatura senza importare tutto.
3. Controlla i risultati in Contatti e Ordini: nomi leggibili, segmento B2C/B2B corretto, stati
   ordine mappati (nessun ordine incassato che risulti `pending`).
4. Correggi la mappa degli stati ordine e quella dei gruppi cliente se necessario, poi lancia il
   backfill completo. Per volumi grandi usa la modalità **MySQL**: il Webservice impiegherebbe
   ore dove una query impiega secondi.
5. Da lì in avanti ci pensa `scheduledSiteSync`, ogni ora.

---

## 14. Sviluppo locale con gli emulatori

```bash
npm run build:shared
firebase emulators:start
```

Porte configurate in `firebase.json`:

| Servizio | Porta |
| --- | --- |
| UI degli emulatori | 4000 |
| Authentication | 9099 |
| Functions | 5001 |
| Firestore | 8080 |
| Storage | 9199 |
| Pub/Sub | 8085 |

In un secondo terminale:

```bash
npm run dev        # http://localhost:3000
```

Con `NEXT_PUBLIC_USE_EMULATORS=true` in `apps/web/.env.local`, il client Firebase si collega da
solo agli emulatori (`apps/web/src/lib/firebase/client.ts`).

Limiti dell'ambiente emulato, da tenere presenti:

- **Secret Manager non è emulato.** Le funzioni che leggono un secret lo trovano vuoto e falliscono
  con un messaggio esplicito. Per provare Brevo o PrestaShop in locale usa `functions/.env.local`
  con le variabili corrispondenti, e comunque **mai** credenziali di produzione.
- **Il salvataggio delle credenziali da UI non funziona**: fuori da Google Cloud manca il metadata
  server, quindi la callable restituisce il motivo e suggerisce `firebase functions:secrets:set`.
- **Le funzioni programmate non partono da sole**: vanno invocate a mano dalla UI degli emulatori
  o con `firebase functions:shell`.
- Gli **invii verso Brevo sono reali** se la chiave è valida: usa una chiave di prova e indirizzi
  di tuo controllo.

---

## 15. Verifica finale

Lista di controllo prima di considerare l'installazione completa:

- [ ] `firebase projects:list` mostra il progetto e l'alias `default` è quello giusto
- [ ] Il progetto è sul piano Blaze
- [ ] Authentication, Firestore e Storage sono attivi nella regione europea
- [ ] `firebase deploy --only firestore:rules,firestore:indexes,storage` è andato a buon fine
- [ ] Gli indici compositi risultano **Enabled** in Console → Firestore → Indici
- [ ] Le Cloud Functions sono deployate in `europe-west1`
- [ ] Cloud Scheduler mostra **otto** job abilitati
- [ ] Gli otto secret esistono (`firebase functions:secrets:access <nome>` risponde)
- [ ] `GET https://<dominio-web>/api/health` risponde `{"status":"ok"}` con il `projectId` corretto
- [ ] Il primo utente ha ruolo `owner` e vede tutte le voci di menu
- [ ] `seedDefaults` è stato eseguito: 4 documenti di impostazioni, 5 template, 6 automazioni
- [ ] `testBrevoConnection` risponde positivamente e mostra i crediti dell'account
- [ ] I webhook Brevo sono registrati (transazionale + marketing)
- [ ] La prova di connessione a ciascun negozio PrestaShop è verde
- [ ] La prima sincronizzazione ha popolato contatti e ordini con dati coerenti
- [ ] Un `sendTestEmail` arriva, il click passa dal redirector e il link di disiscrizione funziona

Se un punto fallisce, i log sono la prima cosa da guardare:

```bash
firebase functions:log --only <nomeFunzione>
```

Vedi anche [`OPERATIVITA.md`](OPERATIVITA.md), §7, per la diagnosi dei problemi ricorrenti.
