# Tracciamento e attribuzione

Come l'applicazione sa che un'email è stata consegnata, aperta, cliccata e ha prodotto un acquisto
— e quanto ci si può fidare di ciascuno di questi dati.

---

## 1. Le tre sorgenti di segnale

| Sorgente | Cosa produce | Affidabilità |
| --- | --- | --- |
| **Webhook Brevo** | Accettazione, consegna, bounce, blocco, spam, disiscrizione, aperture e click visti da Brevo | Alta sugli eventi di recapito |
| **Redirector proprietario** (`trackClick`) | Click, nell'istante in cui avvengono, con l'id del nostro contatto | Alta |
| **Pixel di apertura** (`trackOpen`) | Aperture, con riconoscimento dei proxy immagini | Bassa per costruzione (vedi §6) |

**Perché due sistemi di click.** Gli eventi di click di Brevo arrivano con ritardo variabile, non
coprono in modo uniforme gli invii transazionali e non portano l'id del nostro contatto. Il
redirector firmato registra il click nell'istante in cui avviene e sa già a chi appartiene. I due
segnali convivono: la deduplica sull'hash del payload impedisce il doppio conteggio.

---

## 2. Eventi Brevo gestiti

Diciassette tipi (`BrevoEventType`). La colonna "nome API" è quello accettato da Brevo in fase di
creazione del webhook; il campo `event` del payload usa invece lo snake_case.

| Evento applicativo | Nome API | Significato | Effetto |
| --- | --- | --- | --- |
| `request` | `request` | Email accettata da Brevo | Conferma la presa in carico |
| `delivered` | `delivered` | Consegna riuscita | `stats.delivered` +1, destinatario → `delivered` |
| `opened` | `opened` | Apertura | `stats.opened` +1; se è la prima, anche `uniqueOpened` |
| `unique_opened` | `uniqueOpened` | Prima apertura | `stats.uniqueOpened` |
| `click` | `click` | Click su un link | `stats.clicked`, URL registrato, **crea un tocco di attribuzione** |
| `soft_bounce` | `softBounce` | Rifiuto temporaneo | `stats.softBounces` |
| `hard_bounce` | `hardBounce` | Indirizzo inesistente | `stats.hardBounces`; **il contatto passa a `bounced`** |
| `blocked` | `blocked` | Destinatario in blocklist | `stats.blocked` |
| `spam` | `spam` | Segnalato come posta indesiderata | `stats.complaints`; il contatto viene soppresso |
| `invalid_email` | `invalid` | Indirizzo non valido | Contatto non più contattabile |
| `deferred` | `deferred` | Consegna rimandata dal destinatario | Registrato, nessun effetto sui tassi |
| `error` | `error` | Errore di invio | Destinatario → `failed` |
| `unsubscribed` | `unsubscribed` | Disiscrizione | `stats.unsubscribed`; contatto → `unsubscribed` |
| `list_addition` | `listAddition` | Aggiunto a una lista Brevo | Solo registrato |
| `contact_updated` | `contactUpdated` | Contatto modificato su Brevo | Solo registrato |
| `contact_deleted` | `contactDeleted` | Contatto eliminato su Brevo | Solo registrato |
| `proxy_open` | `proxyOpen` | Apertura da proxy immagini | Registrato **a parte**; escluso dall'open rate se configurato |

`DELIVERY_FAILURE_EVENTS` — `soft_bounce`, `hard_bounce`, `blocked`, `invalid_email`, `error` —
sono gli eventi che indicano un problema di recapito e alimentano la scheda "salute della lista".

La registrazione dei webhook è descritta in [`BREVO.md`](BREVO.md), §4.

---

## 3. Correlazione: da un evento al destinatario

Il problema: Brevo dice "l'email `X` è stata aperta da `mario@esempio.it`". Dobbiamo capire **quale
newsletter o automazione** e **quale destinatario**.

`processEvent` (`functions/src/tracking/processor.ts`) prova quattro strade, in ordine.

### a) Gli id già presenti nell'evento — la via più affidabile

Al momento dell'invio scriviamo noi l'header `X-Mailin-custom`, che Brevo restituisce
integralmente nel payload dell'evento. Contiene gli id applicativi. Sono accettate tre forme:

```
{"newsletterId":"abc123","contactId":"xyz789"}    JSON
newsletterId=abc123;contactId=xyz789              coppie chiave=valore
n:abc123:variante-a                               ref compatto
```

Il **`ref`** è il formato compatto usato anche nei link tracciati:

| Forma | Significato |
| --- | --- |
| `n:<newsletterId>` | Newsletter senza varianti |
| `n:<newsletterId>:<variantId>` | Variante di un A/B test |
| `a:<automationId>:<stepId>` | Step di automazione |
| `a:<automationId>:<stepId>:<runId>` | Step, con la singola esecuzione |
| `t:<newsletterId>` | Invio di prova — **non conteggiato** nelle statistiche |

Portare anche il `runId` permette di attribuire click e aperture alla singola esecuzione di
un'automazione, non solo allo step.

### b) `messageId` nei destinatari

Se gli id non ci sono, si cerca il `message-id` di Brevo nel **collection group** `recipients`.
Ogni destinatario conserva il `messageId` restituito al momento dell'invio. È il motivo per cui
esiste l'indice `recipients.messageId` come collection group: dato un `messageId`, si trova il
destinatario in qualsiasi newsletter senza scansioni.

### c) `messageId` nelle run di automazione

Stessa ricerca sul collection group `runs`, per gli invii generati dalle automazioni.

### d) Email più finestra temporale — ultima spiaggia

Si cerca l'invio più recente a quell'indirizzo negli ultimi **30 giorni**
(`EMAIL_MATCH_WINDOW_DAYS`), leggendo al massimo 25 documenti. È un'euristica: se lo stesso
contatto ha ricevuto due email lo stesso giorno, l'evento potrebbe essere attribuito a quella
sbagliata. Per questo le prime tre strade esistono.

### Cosa succede dopo la correlazione

In **un'unica transazione**:

1. **Destinatario** — stato, timestamp, contatori, URL cliccati.
2. **Statistiche aggregate** — newsletter (ed eventuale variante A/B), oppure automazione e singolo
   step, con `FieldValue.increment`: due eventi concorrenti non si sovrascrivono.
3. **Contatto** — engagement, punteggio, fascia e, per gli eventi negativi, stato di iscrizione.
4. **Attribuzione** — un `AttributionTouch` per ogni click e per la prima apertura.

O l'evento aggiorna tutto, o non aggiorna nulla. In caso di errore resta `processed: false` e viene
ripreso da `scheduledStatsReconcile`, ogni ora.

---

## 4. Click tracciati con firma HMAC

### 4.1 La forma del link

Nell'HTML dell'email, ogni link cliccabile viene riscritto in:

```
{APP_URL}/t/c?u=<url originale in base64url>&r=<ref>&c=<contactId>&s=<firma>
```

La firma è **HMAC-SHA256 in base64url** sul payload `u|r|c`, calcolata con `LINK_SIGNING_KEY`.

### 4.2 Perché firmare

Senza firma, chiunque potrebbe:

- **fabbricare click** — costruire URL con l'id di una newsletter e gonfiarne le statistiche;
- **usare il dominio come open redirect** — sostituire il parametro `u` con un sito di phishing e
  distribuire un link che parte dal dominio di AlphaInk. È il rischio più grave: bruciare la
  reputazione del dominio e trascinare i clienti su un sito ostile.

La firma copre l'URL di destinazione, quindi non è manipolabile.

### 4.3 Cosa succede quando la firma non è valida

**Il redirect avviene comunque, ma il click non viene registrato**, e l'anomalia finisce nei log.

È una scelta deliberata (`functions/src/tracking/redirect.ts:16`). Un link può arrivare con la
query troncata — inoltro dell'email, client che riscrive gli URL, chiave nel frattempo ruotata.
Trasformare quel caso in una pagina d'errore per il cliente sarebbe un danno commerciale peggiore
del dato perso.

### 4.4 Cosa non viene tracciato

`isTrackableUrl` esclude:

- schemi non navigabili: `mailto:`, `tel:`, `sms:`, `data:`, `javascript:`, `vbscript:`, `cid:`,
  `file:`, `blob:`;
- ancore interne (`#sezione`);
- URL che contengono ancora un merge tag non risolto;
- tutto ciò che non è `http(s)` assoluto.

Per default anche i link che puntano alla web app stessa restano intatti (disiscrizione,
preferenze, webview): tracciarli inquinerebbe le statistiche di click con azioni di servizio.

### 4.5 Parametri UTM

Prima della riscrittura, `appendUtm` aggiunge i parametri UTM mancanti. Non sovrascrive mai quelli
già presenti nel link scritto dall'operatore.

Valori predefiniti (Impostazioni → Tracciamento):

| Parametro | Default |
| --- | --- |
| `utm_source` | `newsletter` |
| `utm_medium` | `email` |
| `utm_campaign` | `{{newsletter.slug}}` |

La manipolazione è **testuale** e non passa da `new URL()`: quest'ultima normalizza e ri-codifica
il percorso, rovinando gli URL che contengono ancora merge tag o caratteri già codificati dal sito.

Gli UTM servono per gli analytics del sito (Google Analytics, Matomo). L'attribuzione interna non
li usa: si basa sui tocchi.

---

## 5. Pixel di apertura

Nel corpo dell'email, prima di `</body>`, viene inserito:

```
{APP_URL}/t/o?r=<ref>&c=<contactId>&s=<firma>
```

Firmato con lo stesso meccanismo, su payload `r|c`. La funzione `trackOpen` restituisce sempre un
GIF trasparente 1×1, indipendentemente dall'esito della registrazione: un pixel che non carica
lascerebbe un riquadro rotto nell'email.

Il pixel viene inserito **prima** dell'inlining del CSS, così riceve i propri stili. Nella pagina
"vedi nel browser" (`webviewPage`) viene **rimosso**: leggere la webview non è aprire l'email.

---

## 6. Limiti del dato di apertura

### 6.1 Apple Mail Privacy Protection

Dal 2021, Apple Mail **precarica tutte le immagini** dei messaggi appena arrivano, anche se nessuno
apre l'email. Il pixel viene richiesto lo stesso. Contarlo come apertura **gonfia l'open rate del
30-60%** su una lista italiana media.

L'applicazione riconosce il precaricamento Apple da due segnali
(`functions/src/tracking/events.ts:200`):

- **user agent**: Apple si presenta con la firma di Safari su macOS 10.15.7 **senza** il suffisso
  `Version/… Safari/…`;
- **rete**: IP nel blocco `17.0.0.0/8`, la rete pubblica di Apple.

### 6.2 Altri proxy immagini riconosciuti

Gmail Image Proxy, Yahoo Mail Proxy, Barracuda, Mimecast, Proofpoint, Symantec, MessageLabs,
Cloudmark, Bitdefender, Superhuman.

Gli antispam aziendali (Mimecast, Proofpoint) sono particolarmente rilevanti sul canale B2B: molte
"aperture" da domini aziendali sono in realtà scansioni di sicurezza automatiche.

### 6.3 Come vengono trattate

Un'apertura riconosciuta come proxy viene registrata con tipo **`proxy_open`** invece di `opened`,
e conteggiata a parte in `metricsDaily.channels.*.proxyOpened`.

Se `settings/tracking.excludeProxyOpens` è attivo (**default: sì**), le aperture proxy non entrano
nel calcolo dell'open rate. Puoi disattivarlo per confrontare i numeri con quelli della dashboard
Brevo, che le include.

### 6.4 Cosa farne

**Il riconoscimento è euristico.** Apple può cambiare la firma dello user agent, e un utente Apple
che apre davvero l'email da un IP Apple viene comunque classificato come proxy.

Conseguenze pratiche:

1. **Il click è la metrica solida.** Un click richiede un'azione umana deliberata.
2. **Usa il CTOR** (click-to-open rate) con cautela: ha al denominatore un numero inquinato.
3. **Confronta open rate solo fra campagne dello stesso periodo**, non con dati storici
   precedenti al 2021 o presi da altri strumenti con euristiche diverse.
4. **Non basare la soppressione sui soli mancati "aperti".** Un cliente con MPP che non apre mai
   risulterà comunque con aperture; uno con le immagini bloccate risulterà chiuso pur leggendo.

---

## 7. Punteggio di engagement

Ogni evento aggiorna il punteggio del contatto (`computeEngagementScore`,
`packages/shared/src/utils/engagement.ts:14`). La formula:

```
punteggio = recency + apertura×25 + click×30 − penalità        [0 – 100]

recency   = 45 × (1 − giorni_dall'ultima_interazione / 180)     max 45 punti
apertura  = min(1, aperte / consegnate)                         max 25 punti
click     = min(1, cliccate / consegnate)                       max 30 punti
penalità  = segnalazioni_spam × 15 + bounce × 5
```

Un contatto senza email consegnate ha punteggio 0 e fascia `unknown`.

| Fascia | Punteggio | Etichetta |
| --- | --- | --- |
| `hot` | ≥ 65 | Molto attivo |
| `warm` | 40 – 64 | Attivo |
| `cold` | 15 – 39 | Poco attivo |
| `dormant` | < 15 | Dormiente |
| `unknown` | — | Nessuna email consegnata |

Tre osservazioni sulla formula:

- **Il click pesa più dell'apertura** (30 contro 25), perché è un segnale molto più affidabile.
- **La recency pesa quanto entrambi quasi insieme** (45 punti): un cliente che ha cliccato ieri
  vale più di uno con ottime medie storiche ma fermo da mesi.
- **Le segnalazioni spam costano care** (15 punti l'una): due bastano a far scendere di fascia un
  contatto altrimenti attivo.

Le fasce alimentano i cluster automatici e sono lo strumento giusto per il riscaldamento del
dominio (vedi [`BREVO.md`](BREVO.md), §6).

---

## 8. Attribuzione degli ordini

### 8.1 Come funziona

Ogni click e la **prima** apertura producono un `AttributionTouch`. Quando arriva un ordine, si
cercano i tocchi del contatto nelle finestre configurate e si sceglie secondo il modello.

Le finestre (Impostazioni → Tracciamento):

| Finestra | Default | Significato |
| --- | ---: | --- |
| `clickWindowDays` | **7 giorni** | Quanto indietro vale un click |
| `openWindowDays` | **2 giorni** | Quanto indietro vale un'apertura |

La finestra delle aperture è più corta perché l'apertura è un segnale debole: attribuire un
acquisto a un'apertura di sei giorni prima sarebbe una forzatura.

### 8.2 I cinque modelli

| Modello | Cosa premia | Quando usarlo |
| --- | --- | --- |
| **`last_click`** *(default)* | L'ultimo click prima dell'ordine | Standard di settore. L'email che ha chiuso la vendita |
| `first_click` | Il primo click della finestra | Premia chi ha innescato l'interesse. Utile con cicli di acquisto lunghi |
| `last_open` | L'ultimo segnale in assoluto, click **o** apertura | Più generoso: attribuisce anche senza click. Gonfia i numeri |
| `linear` | Tutti i tocchi, con peso 1/n | Multi-touch. I click hanno la precedenza: se c'è almeno un click, le aperture si ignorano |
| `coupon` | **Solo** il codice sconto emesso da noi | Il più conservativo. Attribuisce solo ciò che è certo |

### 8.3 Il coupon batte tutto

Quando `couponOverridesModel` è attivo (**default: sì**) e l'ordine porta un codice che abbiamo
emesso, l'attribuzione va a quella newsletter o automazione, **qualunque sia il modello**.

È l'unico segnale deterministico: il cliente ha materialmente usato un codice che gli abbiamo
mandato noi. Tutto il resto è correlazione temporale.

Perché conti: `couponCode` è l'unico campo che il webhook del sito ci passa e che rende
deterministica l'attribuzione. Se il modulo PrestaShop lo compila, la qualità del dato commerciale
cambia radicalmente. Vedi [`INTEGRAZIONE-SITO.md`](INTEGRAZIONE-SITO.md), §D.4.

### 8.4 Quali ordini contano

Solo quelli in `countStatuses` — di default `paid`, `processing`, `shipped`, `completed`.

Un ordine in `awaiting_payment` non genera fatturato attribuito: se poi viene pagato,
l'attribuzione scatta al cambio di stato, perché `onOrderWritten` reagisce a ogni scrittura.

Se `subtractRefunds` è attivo (**default: sì**), il fatturato attribuito è
`totale − importo rimborsato`, e `revokeAttribution` sottrae il valore quando l'ordine viene
annullato o rimborsato, riportando il destinatario allo stato precedente.

### 8.5 Le due garanzie

**Idempotenza.** L'ordine viene "prenotato" in transazione. Se un altro processo lo ha già
attribuito, la seconda esecuzione esce senza toccare i contatori: questo rende innocua la doppia
chiamata dal trigger delle automazioni e da quello dell'attribuzione.

**Tocchi consumati.** Un tocco attribuito a un ordine (`attributedOrderId` valorizzato) non viene
riusato per un altro. Due acquisti ravvicinati non raddoppiano il merito della stessa email.

### 8.6 Cosa l'attribuzione non è

**Non è una prova di causalità.** Un ordine attribuito con `last_click` significa: *questo contatto
ha cliccato un link di questa newsletter entro sette giorni, poi ha comprato*. Una parte di quei
clienti avrebbe comprato comunque.

Il numero è utile per **confrontare** campagne fra loro e per capire quali contenuti muovono le
vendite, non come misura assoluta del fatturato "generato" dall'email.

Se vuoi un numero difendibile, usa il modello `coupon`: attribuisce meno, ma quello che attribuisce
è certo.

---

## 9. Come leggere i report

### 9.1 Dashboard

Legge da `metricsDaily`, non dagli eventi grezzi: senza il consolidamento notturno ogni apertura
del cruscotto rileggerebbe centinaia di migliaia di documenti.

| Sezione | Cosa mostra |
| --- | --- |
| Metriche del periodo | Inviate, consegnate, aperte, cliccate, ordini, fatturato attribuito |
| Andamento | Serie temporale giornaliera |
| Fatturato per canale | Newsletter contro automazioni |
| Quota email | `emailRevenueShare`: percentuale del fatturato del negozio attribuita alle email |
| Salute della lista | Bounce, disiscrizioni, segnalazioni |
| Prossimi invii | Newsletter pianificate |
| Stato sincronizzazione | Ultimo job per negozio |

Il documento del **giorno corrente** ha `partial: true`: i valori cambieranno fino al
consolidamento delle 02:00. Se ha `truncated: true`, i tetti di sicurezza sono stati raggiunti
(300.000 eventi o 50.000 ordini) e i numeri sono **per difetto**.

### 9.2 Report di una newsletter

| Blocco | Contenuto |
| --- | --- |
| Imbuto | Inviate → consegnate → aperte → cliccate → convertite |
| Tassi | Consegna, apertura, click, CTOR, bounce, disiscrizione, conversione |
| Andamento | Distribuzione oraria di aperture e click dopo l'invio |
| Link più cliccati | Con numero di click e click unici |
| Destinatari | Tabella filtrabile per stato |
| Ripartizioni | Client di posta, sistema operativo, dispositivo |
| Fatturato | Ordini attribuiti e valore |

**Come si legge l'imbuto.** Ogni scalino risponde a una domanda diversa:

| Scalino | Se è basso, il problema è |
| --- | --- |
| Inviate → consegnate | Qualità della lista, reputazione del dominio, autenticazione |
| Consegnate → aperte | Oggetto, mittente, preheader, orario. *Ma vedi §6* |
| Aperte → cliccate | Contenuto e chiamata all'azione |
| Cliccate → convertite | La pagina di destinazione o l'offerta, non l'email |

### 9.3 Report di un'automazione

Le stesse metriche, ma **per step**, più il numero di **annullamenti**.

Un tasso di annullamento alto su un'automazione di recupero è un **buon** segno: significa che i
clienti completano l'ordine o riacquistano prima che l'email parta.

### 9.4 Valori di riferimento

Per una lista italiana di e-commerce, con le aperture proxy escluse:

| Metrica | Sotto la media | Nella media | Buono |
| --- | --- | --- | --- |
| Tasso di consegna | < 95% | 95-98% | > 98% |
| Tasso di apertura | < 15% | 15-25% | > 25% |
| Tasso di click | < 1,5% | 1,5-3% | > 3% |
| CTOR | < 8% | 8-15% | > 15% |
| Tasso di bounce | > 2% | 0,5-2% | < 0,5% |
| Disiscrizioni | > 0,5% | 0,1-0,5% | < 0,1% |
| Segnalazioni spam | > 0,1% | 0,02-0,1% | < 0,02% |

Le automazioni comportamentali fanno normalmente **due o tre volte** meglio delle newsletter su
apertura e click: arrivano in un momento in cui il cliente sta già pensando a quel prodotto.

---

## 10. Diagnosi dei problemi ricorrenti

| Sintomo | Causa probabile | Verifica |
| --- | --- | --- |
| Nessun evento nella collezione `events` | Webhook non registrato, o URL senza `?token=` | [`BREVO.md`](BREVO.md), §4.2. Poi `firebase functions:log --only brevoWebhook` |
| Eventi presenti ma statistiche a zero | Correlazione fallita, o eventi `processed: false` | Query su `events` con `processed == false`. La riconciliazione oraria dovrebbe smaltirli |
| Click a zero, aperture normali | Redirector irraggiungibile (percorsi non instradati) | [`SETUP.md`](SETUP.md), §9. Prova un link da un invio di test |
| Aperture altissime, click bassissimi | Aperture da proxy | Attiva `excludeProxyOpens`; controlla `proxyOpened` in `metricsDaily` |
| Fatturato attribuito a zero pur con vendite | Attribuzione non scattata | Controlla che gli ordini abbiano `contactId`, che il loro `status` sia in `countStatuses` e che esistano tocchi nella finestra |
| Fatturato attribuito troppo alto | Modello troppo generoso | Passa da `last_open` a `last_click`, o accorcia `clickWindowDays` |
| Statistiche divergenti dalla dashboard Brevo | Normale: euristiche diverse sulle aperture proxy e sui click | Confronta le **consegne**, che sono l'unico dato allineato per definizione |
| Un contatto risulta disiscritto senza averlo chiesto | `hard_bounce` o `spam` | Apri la scheda contatto: la cronologia eventi mostra quale evento lo ha soppresso |
