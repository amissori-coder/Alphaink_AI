# Configurazione Brevo

Brevo è il servizio che consegna materialmente le email e che ci restituisce gli eventi di
recapito. Questo documento copre la chiave API, l'autenticazione del dominio mittente, i mittenti,
la registrazione dei webhook, i limiti dell'API e le buone pratiche di deliverability.

L'applicazione parla con Brevo tramite l'**API v3** su `https://api.brevo.com/v3`, usando `fetch`
nativo — nessun SDK. Il client è in `functions/src/brevo/client.ts`.

---

## 1. Ottenere la chiave API

1. Accedi a <https://app.brevo.com> con un account che abbia i permessi di amministrazione.
2. Menu in alto a destra (nome account) → **SMTP & API** → scheda **API keys**.
3. **Generate a new API key**. Dai un nome riconoscibile, ad esempio
   `AlphaInk Newsletter Suite — produzione`.
4. **Copia subito la chiave**: Brevo la mostra una sola volta. Ha la forma
   `xkeysib-<64 caratteri esadecimali>-<10 caratteri>`.

La chiave è legata all'**account**, non all'utente che la crea: chi la possiede può inviare a nome
di AlphaInk. Trattala come una password di produzione.

### Dove finisce la chiave

Un solo posto: **Secret Manager**.

```bash
firebase functions:secrets:set BREVO_API_KEY
```

Su Firestore, nel documento `settings/brevo`, restano soltanto `apiKeyConfigured: true` e
`apiKeyHint` (le ultime cifre, per riconoscere quale chiave è in uso). Il valore vero non è mai
esposto al client.

Puoi anche incollare la chiave in **Impostazioni → Brevo** nella web app: la callable
`saveBrevoSettings` la valida su `/account`, la scrive in Secret Manager e la scarta dalla memoria.
Se il progetto non ha il permesso `secretmanager.versions.add`, l'operazione non fallisce: mostra
un avviso con il comando CLI da eseguire a mano.

> **Attenzione**: una nuova versione del secret entra in servizio sulle istanze avviate *dopo* il
> salvataggio. Le istanze già calde continuano con la versione precedente fino al ricambio. Se hai
> ruotato la chiave e vedi ancora errori `401`, attendi qualche minuto o forza un redeploy delle
> Functions.

### Verificare che funzioni

Da **Impostazioni → Brevo**, il pulsante di prova invoca `testBrevoConnection`, che interroga
`/account` e mostra email dell'account, azienda e crediti residui.

---

## 2. Autenticare il dominio mittente (SPF, DKIM, DMARC)

Questo è il passo che decide se le email finiranno in posta in arrivo o in spam. Non è opzionale:
dal 2024 Gmail e Yahoo **rifiutano** la posta in massa non autenticata.

In Brevo: **Senders, Domains & Dedicated IPs** → scheda **Domains** → *Add a domain* →
inserisci `alphaink.net` → *Authenticate this domain*.

Brevo genera i record da pubblicare nel DNS di `alphaink.net`. I valori esatti sono quelli che ti
mostra la sua interfaccia: **copiali da lì**, non da questa tabella, che serve solo a spiegare a
cosa serve ciascun record.

| Record | Tipo | Nome (host) | A cosa serve |
| --- | --- | --- | --- |
| **DKIM** | TXT | `mail._domainkey.alphaink.net` (il selettore lo indica Brevo) | Firma crittografica di ogni messaggio: prova che il contenuto non è stato alterato e che parte da un mittente autorizzato |
| **Brevo code** | TXT | `alphaink.net` | Dimostra a Brevo che il dominio è tuo |
| **SPF** | TXT | `alphaink.net` | Elenca gli host autorizzati a inviare per il dominio |
| **DMARC** | TXT | `_dmarc.alphaink.net` | Dice ai destinatari cosa fare quando SPF o DKIM falliscono, e dove mandare i rapporti |

### SPF

Il dominio deve avere **un solo** record SPF. Se `alphaink.net` ne ha già uno (per il gestore di
posta aziendale), **non aggiungerne un secondo**: estendi quello esistente includendo il meccanismo
indicato da Brevo.

```
v=spf1 include:spf.google.com include:spf.sendinblue.com ~all
```

Attenzione al limite di **10 ricerche DNS** dell'SPF: superato, il record diventa `permerror` e
l'autenticazione fallisce silenziosamente per tutti gli invii. Se hai già molti `include:`,
verificalo con un validatore prima di aggiungerne un altro.

### DMARC

Parti in sola osservazione, per non bloccare posta legittima mentre l'allineamento non è completo:

```
v=DMARC1; p=none; rua=mailto:dmarc@alphaink.net; fo=1; adkim=r; aspf=r
```

Leggi i rapporti aggregati per due o tre settimane. Quando SPF e DKIM risultano allineati su tutti
i flussi legittimi (newsletter, posta transazionale del sito, posta degli uffici), stringi per
gradi:

```
v=DMARC1; p=quarantine; pct=25; rua=mailto:dmarc@alphaink.net
...poi pct=50, pct=100...
v=DMARC1; p=reject; rua=mailto:dmarc@alphaink.net
```

### Verifica

- In Brevo, il dominio deve mostrare tutte le spunte verdi. La propagazione DNS richiede da pochi
  minuti a 48 ore.
- Manda una prova a un indirizzo Gmail, apri il messaggio, *Mostra originale*: devi leggere
  `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`.
- Verifica che il dominio del `From:` coincida con quello firmato in DKIM (**allineamento**): se
  invii da `newsletter@alphaink.net` ma DKIM firma un altro dominio, DMARC fallisce anche con SPF
  e DKIM tecnicamente validi.

---

## 3. Creare i mittenti

Un mittente è la coppia nome + indirizzo che compare nel campo `From:`. Brevo rifiuta con `400`
qualsiasi invio da un indirizzo non presente e non verificato fra i mittenti dell'account.

**Senders, Domains & Dedicated IPs** → scheda **Senders** → *Add a sender*.

Configurazione consigliata per AlphaInk:

| Nome | Indirizzo | Uso |
| --- | --- | --- |
| `AlphaInk` | `newsletter@alphaink.net` | Newsletter promozionali e informative |
| `AlphaInk` | `info@alphaink.net` | Risposte (`Reply-To`) e automazioni transazionali |
| `AlphaInk B2B` | `b2b@alphaink.net` | Comunicazioni al canale rivenditori *(facoltativo)* |

Se il dominio è già autenticato, i mittenti su quel dominio risultano attivi subito. Altrimenti
Brevo manda una mail di conferma all'indirizzo: finché non viene cliccata, il mittente resta
`active: false` e ogni invio con quel mittente viene rifiutato
(`functions/src/brevo/senders.ts:4`).

**Non usare mai** un indirizzo su un dominio gratuito (`gmail.com`, `libero.it`) come mittente:
le policy DMARC di quei domini fanno respingere il messaggio dai destinatari.

Dopo aver creato i mittenti, in **Impostazioni → Brevo** della web app:

- premi *Aggiorna mittenti* per rileggere l'elenco da `/senders`;
- scegli il **mittente predefinito** e l'indirizzo di **risposta** (`Reply-To`).

Le automazioni predefinite usano come mittente il nome azienda e l'email di assistenza configurati
in **Impostazioni → Brand** (`fromName` e `fromEmail` in
`functions/src/automations/defaults.ts:504`): assicurati che quell'indirizzo esista fra i mittenti
Brevo.

---

## 4. Registrare i webhook

Senza webhook l'applicazione non sa nulla di consegne, aperture, click, bounce e disiscrizioni:
le newsletter risulterebbero inviate ma prive di statistiche.

### 4.1 URL da registrare

L'endpoint è la Cloud Function `brevoWebhook`:

```
https://europe-west1-<id-progetto>.cloudfunctions.net/brevoWebhook?token=<BREVO_WEBHOOK_SECRET>
```

Per il progetto predefinito `alphaink-newsletter`:

```
https://europe-west1-alphaink-newsletter.cloudfunctions.net/brevoWebhook?token=IL_TUO_SEGRETO
```

Il **token in query string** è necessario perché Brevo non permette di aggiungere header
personalizzati al webhook. Il confronto avviene a tempo costante
(`authenticateWebhook` in `functions/src/tracking/webhook.ts`). L'endpoint accetta anche una firma
HMAC-SHA256 del corpo grezzo nell'header `X-Alphaink-Signature` (con o senza prefisso `sha256=`),
utile se un giorno gli eventi passassero da un proxy tuo o dai test automatici.

Usa per `BREVO_WEBHOOK_SECRET` un valore casuale **senza caratteri da codificare nell'URL** — solo
lettere, cifre, `-` e `_`:

```bash
openssl rand -hex 32
```

### 4.2 Registrazione automatica

Da **Impostazioni → Brevo**, il pulsante *Registra webhook* invoca la callable
`registerBrevoWebhooks`, che crea (o aggiorna) **due** webhook — uno transazionale e uno marketing
— puntati sullo stesso endpoint. L'operazione è idempotente: se esistono già con gli stessi eventi
non tocca nulla.

> **Importante.** `resolveWebhookUrl` (`functions/src/brevo/webhooks.ts:120`) costruisce l'URL
> della Cloud Function **senza** aggiungere il token. Un webhook registrato così verrebbe rifiutato
> con `401`. Hai due modi per risolvere:
>
> - **consigliato** — imposta la variabile d'ambiente `BREVO_WEBHOOK_URL` delle Functions con
>   l'URL completo di token, poi lancia la registrazione automatica:
>
>   ```dotenv
>   # functions/.env
>   BREVO_WEBHOOK_URL=https://europe-west1-alphaink-newsletter.cloudfunctions.net/brevoWebhook?token=IL_TUO_SEGRETO
>   ```
>
> - **alternativa** — lascia registrare i webhook automaticamente e poi, nella dashboard Brevo,
>   modifica l'URL di entrambi aggiungendo `?token=…` in coda.
>
> Verifica sempre l'esito: manda un `sendTestEmail` e controlla che entro pochi minuti compaia un
> documento nella collezione `events`.

### 4.3 Registrazione manuale

In Brevo: **Transactional → Settings → Webhook** e **Campaigns → Settings → Webhook**
(la voce esatta cambia con l'interfaccia). Crea un webhook per tipo, incolla l'URL con il token e
seleziona gli eventi elencati qui sotto.

### 4.4 Quali eventi attivare

L'applicazione gestisce questi eventi. La colonna "nome API" è quello che Brevo accetta in
creazione (camelCase); il campo `event` del payload recapitato usa invece lo snake_case — la
conversione è centralizzata in `functions/src/brevo/webhooks.ts:34`.

**Webhook transazionale** — copre gli invii di newsletter e automazioni (l'app usa
`POST /smtp/email` per entrambi, quindi è **il più importante dei due**):

| Nome API | Evento applicativo | Perché serve |
| --- | --- | --- |
| `request` | `request` | Email accettata da Brevo: conferma la presa in carico |
| `delivered` | `delivered` | Consegna riuscita: base del tasso di consegna |
| `opened` | `opened` | Apertura |
| `click` | `click` | Click su un link |
| `softBounce` | `soft_bounce` | Rifiuto temporaneo |
| `hardBounce` | `hard_bounce` | Indirizzo inesistente: il contatto passa a `bounced` |
| `blocked` | `blocked` | Destinatario in blocklist |
| `spam` | `spam` | Segnalazione come posta indesiderata |
| `unsubscribed` | `unsubscribed` | Disiscrizione dal link Brevo |
| `invalid` | `invalid_email` | Indirizzo sintatticamente non valido |
| `deferred` | `deferred` | Consegna rimandata dal server destinatario |
| `error` | `error` | Errore di invio |

**Webhook marketing** — serve solo se un giorno invierai campagne dalla dashboard Brevo. L'elenco
è volutamente ristretto agli eventi supportati da tutti i piani: un evento non accettato farebbe
fallire con `400` l'intera registrazione.

`delivered`, `opened`, `click`, `softBounce`, `hardBounce`, `spam`, `unsubscribed`, `listAddition`

### 4.5 Come vengono trattati gli eventi

- Brevo può inviare un singolo oggetto JSON, un array di eventi o un involucro `{ events: [...] }`
  a seconda del piano: tutte e tre le forme sono gestite. Il tetto è di **500 eventi** per
  richiesta.
- L'id del documento in `events` è l'**hash di deduplica** del payload: una consegna ripetuta non
  conta due volte apertura o click.
- L'endpoint risponde `200` subito e prosegue l'elaborazione con un budget di 45 secondi. Quello
  che resta indietro viene ripreso da `scheduledStatsReconcile`, ogni ora.
- L'header `X-Mailin-custom`, che l'app scrive al momento dell'invio, è la via più affidabile per
  ricollegare l'evento alla newsletter o all'automazione: viene letto prima di ogni altro criterio.

Il dettaglio della correlazione è in [`TRACKING.md`](TRACKING.md).

---

## 5. Limiti dell'API Brevo

Verificati sulla documentazione ufficiale e documentati in `functions/src/brevo/client.ts:1`.

### Autenticazione

- L'header è `api-key`, **non** `Authorization`.

### Rate limit

- I limiti sono per endpoint e per account. Gli endpoint transazionali (`/smtp/email`) sono i più
  generosi (centinaia di richieste al minuto); quelli su contatti e campagne molto meno.
- Superato il limite Brevo risponde `429` con l'header `Retry-After` in secondi. Il client lo
  rispetta e ritenta con backoff esponenziale (3 tentativi di default).
- Il `RateLimiter` condiviso del modulo è tarato a **10 richieste/secondo con burst 20**, ma è un
  limite **per istanza**: il tetto reale è `maxInstances × 10 req/s`. Le funzioni che spingono
  volumi alti tengono `maxInstances` basso apposta — alzarlo è il modo più rapido per farsi
  limitare da Brevo.

### Dimensioni dei batch

| Endpoint | Limite |
| --- | --- |
| `POST /smtp/email` con `messageVersions` | 1000 versioni per chiamata |
| Destinatari `to` / `cc` / `bcc` di un singolo messaggio | 99 |
| `POST /contacts/import` con `jsonBody` | corpo JSON ≈ 10 MB (l'app spezza a blocchi da 500) |
| `POST /contacts/lists/{id}/contacts/add\|remove` | 150 email per chiamata |
| `GET /contacts/lists` | pagine da 50 |

L'applicazione accoda i destinatari di una newsletter in batch da **500** (`QUEUE_MAX_CONTACTS`) e
li spedisce a blocchi con `sendTransactionalBatch`, che raggruppa i messaggi per contenuto
identico perché `messageVersions` condivide l'HTML: possono variare solo destinatari, oggetto,
`params`, `cc`, `bcc` e `replyTo`.

### Campi obbligatori ricorrenti

- `/smtp/email`: `sender` (indirizzo verificato) + almeno uno fra `htmlContent`, `textContent` e
  `templateId`; `to` non vuoto.
- `/contacts`: `email` oppure `ext_id`. Gli **attributi devono già esistere** sull'account,
  altrimenti Brevo risponde `400 invalid_parameter`. `ensureBrevoAttributes` li crea alla prima
  configurazione.
- `/emailCampaigns`: `name`, `subject`, `sender`, `recipients.listIds`.

### Risposte

- Molte `PUT` e `DELETE` rispondono `204 No Content`: il corpo è vuoto e il client restituisce
  `undefined`.
- `POST /contacts` risponde `201 {id}` alla creazione ma `204` senza corpo quando aggiorna un
  contatto esistente.
- Gli errori hanno forma `{ "code": "...", "message": "..." }`.

### Idempotenza

Brevo non documenta un header di idempotenza generale. L'header `Idempotency-Key`, quando passato,
viene inviato lo stesso ma è ignorato dagli endpoint che non lo supportano: la deduplica effettiva
è nostra, tramite `dedupeKey` e gli header applicativi `X-Alphaink-Source` e `X-Alphaink-Ref`.

### Crediti

L'invio consuma i crediti del piano. `testBrevoConnection` li mostra leggendoli da `/account`:
controllali prima di una campagna grande — se finiscono a metà invio, i batch rimasti falliscono e
vanno ripresi a mano.

---

## 6. Buone pratiche di deliverability

### Riscaldare il dominio

Un dominio che non ha mai inviato posta in massa e che parte con 50.000 messaggi viene trattato
come una sorgente sospetta. Sali per gradi nelle prime tre-quattro settimane:

| Settimana | Volume giornaliero indicativo | A chi |
| --- | --- | --- |
| 1 | 500 – 1.000 | I contatti più attivi: chi ha aperto o cliccato negli ultimi 30 giorni |
| 2 | 2.000 – 5.000 | Attivi negli ultimi 90 giorni |
| 3 | 10.000 – 20.000 | Attivi nell'ultimo anno |
| 4+ | Volume pieno | Tutta la lista contattabile |

I cluster per fascia di engagement (`engagement.engagementTier`) servono esattamente a questo: crea
un cluster dinamico `engagementTier è uno di [hot, warm]` e usalo come pubblico delle prime
campagne.

### Igiene della lista

- **Non importare mai liste acquistate.** Un solo blocco per spam trap può bruciare la reputazione
  del dominio per mesi.
- Rimuovi gli `hard_bounce` — l'app lo fa da sola: l'evento porta il contatto a `bounced`, che è
  fuori da `SENDABLE_STATUSES`.
- Escludi con un cluster negativo chi non apre da 12 mesi, oppure prova a riattivarlo con
  l'automazione *Win-back* e poi soppriscilo.
- Tieni sotto controllo i due indicatori che contano davvero:

  | Metrica | Soglia di guardia | Se la superi |
  | --- | --- | --- |
  | Tasso di bounce | > 2 % | Ferma gli invii e ripulisci la lista |
  | Segnalazioni spam | > 0,1 % | Rivedi contenuti, frequenza e provenienza dei contatti |
  | Tasso di disiscrizione | > 0,5 % | Riduci la frequenza o segmenta meglio |

### Contenuto

- **Oggetto**: entro 50 caratteri, senza MAIUSCOLE gridate, senza catene di punti esclamativi,
  senza le parole trigger classiche ("GRATIS", "URGENTE", "GUADAGNA SUBITO").
- **Rapporto testo/immagine**: almeno il 60% di testo. Un'email fatta di una sola immagine è un
  classico segnale di spam, e chi ha le immagini bloccate non vede nulla.
- **Versione testuale**: la pipeline la genera sempre da sola (`render/text.ts`). Non disattivarla.
- **Link di disiscrizione visibile**, in ogni messaggio: è un obbligo di legge e un fattore di
  reputazione. Il blocco `unsubscribe` è già nei template di sistema e nelle automazioni.
- **List-Unsubscribe con un solo click** (RFC 8058): supportato dalle pagine pubbliche
  (`functions/src/tracking/unsubscribe.ts:27`). Gmail e Yahoo lo pretendono per i mittenti in
  massa.
- **Preheader** compilato: è la riga di anteprima che il client mostra dopo l'oggetto, e incide
  molto sul tasso di apertura.

### Frequenza e orari

Le automazioni predefinite hanno una **fascia di silenzio 21:00 – 08:00** e limitano gli invii ai
giorni consentiti (lunedì-sabato per le promozionali, tutti i giorni per le transazionali:
un pagamento in sospeso non aspetta il lunedì). Sono modificabili per singola automazione.

Per le newsletter, l'esperienza sul B2B italiano indica come finestre migliori il martedì e il
giovedì mattina, fra le 09:00 e le 11:00. Ma la risposta vera la danno i tuoi dati: il report per
newsletter mostra la distribuzione oraria di aperture e click.

### Errori tipici e cosa significano

| Sintomo | Causa più probabile | Rimedio |
| --- | --- | --- |
| `401 unauthorized` da Brevo | Chiave revocata o non ancora in servizio sull'istanza | Rigenera la chiave, aggiorna il secret, attendi il ricambio delle istanze |
| `400` sul mittente | Mittente non verificato (`active: false`) | Conferma la mail di verifica o autentica il dominio |
| `429` frequenti | Troppe istanze in parallelo | Abbassa `maxInstances` sulle funzioni di invio |
| Nessun evento in `events` | Webhook non registrato, o URL senza `?token=` | Vedi §4.2 |
| Tutte le email in spam | Dominio non autenticato, o allineamento DMARC mancante | Rifai §2 e controlla l'allineamento del `From:` |
| Aperture altissime e click bassi | Aperture da proxy (Apple MPP) | Attiva `excludeProxyOpens`; vedi [`TRACKING.md`](TRACKING.md) |
