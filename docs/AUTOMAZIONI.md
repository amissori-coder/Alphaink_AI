# Automazioni

Un'automazione è un flusso **trigger → attesa → verifica → invio**, con eventuali follow-up.
Ogni parametro è modificabile dalla UI in **Automazioni**: i valori descritti qui sono i default
installati da `seedDefaults` e ripristinabili con `resetAutomationToDefaults`.

`seedDefaults` installa **sei** automazioni: le **quattro obbligatorie** richieste da AlphaInk più
*Benvenuto* e *Win-back*.

> **Nascono tutte spente.** Prima del primo invio reale servono un mittente verificato su Brevo e
> una revisione dei testi. Si attivano una per una dalla UI (`toggleAutomation`, permesso
> `automations:toggle`). `resetAutomationToDefaults` ripristina i contenuti ma **non** rispegne
> un'automazione già attiva.

---

## 1. Quadro d'insieme

| # | Automazione | Chiave | Trigger | Step | Coupon |
| --- | --- | --- | --- | :---: | --- |
| 1 | **Coupon Stampante** | `coupon_stampante` | Acquisto di una stampante | 1 | 15% sui consumabili compatibili |
| 2 | **Pagamento Abbandonato** | `pagamento_abbandonato` | Ordine non pagato oltre la soglia | 3 | 5% al terzo promemoria |
| 3 | **Riacquisto Carta** | `riacquisto_carta` | Ciclo carta scaduto | 2 | 5% sulle risme al secondo |
| 4 | **Riacquisto Toner e Cartucce** | `riacquisto_toner_cartucce` | Ciclo toner/cartucce scaduto | 2 | 10% sui consumabili al secondo |
| 5 | Benvenuto | `benvenuto` | Nuova iscrizione | 2 | 10% di benvenuto |
| 6 | Riattivazione (Win-back) | `win_back` | 180 giorni senza ordini | 2 | 10% di rientro al secondo |

Le prime quattro sono marcate `isCore: true`: non sono eliminabili nemmeno dall'owner
(`firestore.rules`).

Esiste anche la chiave `compleanno_cliente` (*Anniversario Cliente*), prevista dai tipi ma **senza
contenuti predefiniti**: non viene installata da `seedDefaults` e va creata a mano se serve.

---

## 2. Anatomia di un'automazione

### 2.1 Trigger

| Tipo | Quando scatta | Chi lo rileva |
| --- | --- | --- |
| `order_placed` | Un ordine contiene almeno un prodotto delle famiglie indicate | Trigger Firestore `onOrderWritten` |
| `payment_abandoned` | Un ordine resta non pagato oltre `abandonedPaymentAfterMinutes` | `scheduledAbandonedScanner` (ogni 30 min) |
| `cart_abandoned` | Un carrello non viene convertito | `scheduledAbandonedScanner` |
| `repurchase_due` | È arrivata la data prevista di riacquisto per una famiglia | `scheduledRepurchaseScanner` (ogni giorno 09:00) |
| `contact_subscribed` | Un nuovo contatto si iscrive | Trigger Firestore `onContactWritten` |
| `order_anniversary` | Anniversario del primo ordine | *(previsto, senza automazione predefinita)* |
| `inactivity` | Nessun ordine da `inactivityDays` giorni | `scheduledRepurchaseScanner` |

Il trigger può essere ristretto con `productFamilies`, `skuPatterns` (supportano `*`),
`categoryPaths`, `minOrderTotal` e, per `inactivity`, `inactivityDays`.

### 2.2 Step e ritardi

Ogni step è un'email inviata dopo un ritardo. **Il ritardo è sempre calcolato dall'istante del
trigger, non dallo step precedente** (`AutomationStep.delay`). Un flusso "1 ora, 24 ore, 72 ore"
significa quindi: primo promemoria dopo 1 ora dall'ordine, secondo dopo 24 ore dall'ordine, terzo
dopo 72 ore dall'ordine — non dopo 1+24+72.

Le unità disponibili sono `minutes`, `hours` e `days`, selezionabili dalla UI.

Per le automazioni di riacquisto, l'istante del trigger è la **data dell'ultimo ordine della
famiglia**: "45 giorni" significa "45 giorni dopo l'ultimo acquisto di carta".

### 2.3 Condizioni di annullamento (`cancelIf`)

Valutate **subito prima dell'invio**, non al momento dell'arruolamento: se una è soddisfatta la
run passa a `cancelled` e l'email non parte.

| Condizione | Come viene verificata |
| --- | --- |
| `order_completed` | L'ordine di origine è in uno stato di incasso (`paid`, `processing`, `shipped`, `completed`) |
| `cart_recovered` | Il carrello abbandonato ha `recoveredAt` oppure `closedAt` valorizzati |
| `repurchased` | Il contatto ha un ordine della famiglia **più recente** dell'istante del trigger |
| `contact_unsubscribed` | Il contatto non è più contattabile (disiscritto, bounced, bloccato) |
| `contact_purchased_any` | Il contatto ha un ordine qualsiasi più recente dell'istante del trigger |

`contact_unsubscribed` è presente in **ogni** step di **ogni** automazione predefinita: non è
negoziabile.

### 2.4 Coupon

Uno step può emettere un buono sconto. La politica (`CouponPolicy`) definisce:

| Campo | Valori | Significato |
| --- | --- | --- |
| `mode` | `unique_per_contact` \| `shared` | Codice nominale monouso per destinatario, oppure un codice unico già esistente sul negozio |
| `prefix` | testo | Prefisso del codice generato, es. `STAMP` → `STAMP-A1B2-C3D4` |
| `discountType` | `percent` \| `fixed` | Percentuale o importo fisso |
| `discountValue` | numero | 15 = 15%, oppure 15 = 15 € |
| `minOrderTotal` | numero \| `null` | Spesa minima |
| `validForDays` | numero | Giorni di validità dall'emissione |
| `restrictToFamilies` | famiglie | Limita il buono a certe famiglie prodotto |
| `restrictToCompatibleSkus` | booleano | Limita agli SKU compatibili con la stampante del cliente |
| `createOnSite` | booleano | Crea anche la `cart_rule` su PrestaShop |

Comportamento in caso di errore, che è importante conoscere:

- **Se l'emissione del buono fallisce del tutto, l'email non parte.** Un messaggio con un codice
  inesistente costa più di un messaggio non inviato.
- **Se fallisce solo la creazione sul negozio**, l'email parte comunque: il codice viene registrato
  in `coupons` con `siteSyncError` valorizzato, e va poi creato a mano su PrestaShop. Un promemoria
  senza sconto spendibile vale più di un promemoria mai spedito
  (`functions/src/automations/coupons.ts:5`).

Tutti i default hanno `createOnSite: true`: senza `cart_rule`, il codice non sarebbe spendibile al
checkout.

### 2.5 Controlli prima dell'arruolamento

`enroll` è l'unico punto da cui nascono le run, così le regole anti-spam valgono sempre. I
controlli sono in cascata: il primo che fallisce interrompe.

1. **Automazione e step attivi.**
2. **Contatto contattabile**: email valida e stato in `SENDABLE_STATUSES`.
3. **Cluster esclusi** (`excludeClusterIds`).
4. **Filtro di pubblico** (`audienceFilter`), valutato con il motore dei cluster.
5. **Cooldown**: giorni minimi fra due esecuzioni della stessa automazione sullo stesso contatto.
6. **Tetto annuale** (`maxPerContactPerYear`).
7. **Orario di invio**: fascia di silenzio e giorni consentiti. Se l'orario calcolato cade in una
   fascia vietata, l'invio viene **spostato**, non annullato.

L'idempotenza non si basa su una lettura preventiva ma sull'**id del documento**: la `dedupeKey`
*è* l'id della run, quindi due arruolamenti generati dallo stesso trigger collidono dentro
Firestore anche se partono in parallelo da due istanze diverse.

### 2.6 Fasce di silenzio e ritmo

| Parametro | Default | Significato |
| --- | --- | --- |
| `quietHours` | `21:00 – 08:00` | Nessuna email in questa fascia: gli invii notturni bruciano reputazione |
| `allowedWeekdays` | Lun-Sab per le promozionali, tutti per le transazionali | Un pagamento in sospeso non aspetta il lunedì |
| `maxSendsPerHour` | 200-500 secondo l'automazione | Tetto verificato contando gli invii dell'ultima ora, prima di iniziare |
| `timezone` | `Europe/Rome` | Fuso su cui si valutano fasce e giorni |

### 2.7 Modalità di prova

Ogni automazione ha `testMode` e `testRecipients`. Con la modalità di prova attiva, le email
vengono inviate **solo** agli indirizzi elencati: è il modo giusto per validare i contenuti prima
di aprire il flusso ai clienti veri. La callable `sendAutomationTest` manda un singolo step a un
indirizzo scelto, saltando cooldown e tetto annuale.

---

## 3. Le quattro automazioni obbligatorie

### 3.1 Coupon Stampante

> *Chi acquista una stampante riceve un coupon dedicato sui consumabili compatibili con il modello
> acquistato.*

| Parametro | Valore |
| --- | --- |
| **Trigger** | `order_placed`, famiglia `stampanti` |
| **Valore minimo ordine** | nessuno |
| **Cooldown** | 120 giorni |
| **Tetto annuale** | 4 email per contatto |
| **Giorni consentiti** | lunedì – sabato |
| **Ritmo massimo** | 300 invii/ora |

**Step unico — "Coupon consumabili compatibili"**

| | |
| --- | --- |
| Ritardo | **3 giorni** dall'ordine |
| Oggetto | *Un 15% sui consumabili per la tua nuova stampante, {{contact.firstName}}* |
| Annulla se | il contatto si è disiscritto |
| Coupon | prefisso `STAMP`, **-15%**, valido **30 giorni**, limitato a `toner`, `cartucce`, `nastri` e **solo agli SKU compatibili** con la stampante acquistata |

**Perché tre giorni.** È il tempo di ricevere la stampante e provarla. Prima, il cliente non ha
ancora in mano il prodotto e il messaggio suona come una vendita aggiuntiva a freddo; molto dopo,
ha già comprato il primo toner altrove.

**Perché il cooldown è così lungo.** Uffici e rivenditori comprano più stampanti a distanza di
pochi mesi: 120 giorni evitano di mandare quattro volte lo stesso coupon alla stessa azienda.

**Criterio di uscita.** L'automazione ha un solo step: si esaurisce da sola dopo l'invio. Il
coupon scade dopo 30 giorni.

**Dipende da**: il riconoscimento della stampante posseduta (`contacts.printers`), che alimenta i
merge tag `{{contact.printerBrand}}` e `{{contact.printerModel}}` e la restrizione agli SKU
compatibili. Se il nome del prodotto acquistato è troppo generico, marca e modello restano vuoti e
il coupon vale su tutti i consumabili delle famiglie indicate. Vedi
[`INTEGRAZIONE-SITO.md`](INTEGRAZIONE-SITO.md), §E.5.

---

### 3.2 Pagamento Abbandonato

> *Chi arriva al checkout o crea un ordine senza completare il pagamento riceve un promemoria per
> concludere l'acquisto.*

| Parametro | Valore |
| --- | --- |
| **Trigger** | `payment_abandoned` |
| **Valore minimo ordine** | **10 €** — sotto questa soglia il recupero costa più del margine |
| **Cooldown** | 3 giorni |
| **Tetto annuale** | 24 email per contatto |
| **Giorni consentiti** | **tutti**, festivi inclusi |
| **Ritmo massimo** | 500 invii/ora |

**Tre step, tutti con le stesse condizioni di annullamento**: ordine completato, carrello
recuperato, contatto disiscritto.

| Step | Ritardo | Oggetto | Coupon |
| --- | --- | --- | --- |
| Promemoria immediato | **1 ora** | *Manca solo il pagamento per l'ordine {{order.number}}* | — |
| Secondo promemoria | **24 ore** | — | — |
| Ultimo promemoria con sconto | **72 ore** | — | prefisso `RIPRENDI`, **-5%**, valido **7 giorni** |

**Quando un ordine è "abbandonato".** Dopo `abandonedPaymentAfterMinutes` minuti in uno stato di
`ABANDONED_PAYMENT_STATUSES` (`awaiting_payment`, `pending`, `failed`). Il valore predefinito è
**60 minuti** e si cambia in Impostazioni → Sito.

**Come nasce.** Ogni 30 minuti `scheduledAbandonedScanner` cerca gli ordini non pagati oltre la
soglia (guardando indietro al massimo 7 giorni), crea un documento `abandonedCarts` di tipo
`payment` e arruola il contatto in tutti e tre gli step. Il link di recupero punta al dettaglio
ordine sul front office di PrestaShop, che richiede il login — che è esattamente ciò che serve per
pagare un ordine già creato.

**Criterio di uscita.** Appena il pagamento arriva: `onOrderWritten` chiude il carrello abbandonato
(`recoveredAt`) e le run residue vengono annullate alla verifica pre-invio. Se il cliente paga fra
il secondo e il terzo promemoria, il terzo non parte e il coupon non viene mai emesso.

**Perché tutti i giorni.** Un ordine in sospeso ha una finestra di recupero di poche ore: rimandare
il promemoria delle 10:00 di domenica al lunedì mattina significa quasi sempre perderlo. È l'unica
automazione promozionale attiva anche nel fine settimana, insieme al Benvenuto.

**Perché lo sconto solo al terzo tentativo.** I primi due promemoria sono di servizio, non
promozionali: molti abbandoni sono incidenti (sessione scaduta, carta rifiutata). Offrire subito
uno sconto insegna ai clienti abituali ad abbandonare il checkout apposta.

---

### 3.3 Riacquisto Carta

> *Chi ha acquistato carta viene ricontattato quando è statisticamente prossimo a esaurirla.*

| Parametro | Valore |
| --- | --- |
| **Trigger** | `repurchase_due`, famiglia `carta` |
| **Cooldown** | 30 giorni |
| **Tetto annuale** | 8 email per contatto |
| **Giorni consentiti** | lunedì – sabato |
| **Ritmo massimo** | 300 invii/ora |

| Step | Ritardo | Annulla se | Coupon |
| --- | --- | --- | --- |
| Promemoria risme | **45 giorni** dall'ultimo acquisto di carta | ha già riacquistato · si è disiscritto | — |
| Recupero con sconto | **60 giorni** dall'ultimo acquisto | idem | prefisso `CARTA`, **-5%**, valido **14 giorni**, limitato alla famiglia `carta` |

**Da dove viene il "45 giorni".** È il ciclo predefinito della famiglia `carta`
(`DEFAULT_REPURCHASE_CYCLE_DAYS.carta = 45`), modificabile in Impostazioni → Sito.

**Come nasce.** Dopo ogni ordine, l'applicazione somma il ciclo della famiglia alla data
dell'ordine e scrive `contacts.stats.nextPurchaseDueAt.carta`. Ogni mattina alle 09:00
`scheduledRepurchaseScanner` seleziona i contatti la cui data è arrivata (guardando indietro al
massimo 30 giorni, per recuperare eventuali corse saltate) e li arruola in entrambi gli step.

**Criterio di uscita.** La condizione `repurchased` verifica se esiste un ordine di carta più
recente dell'istante del trigger. Se il cliente ricompra dopo il primo promemoria, il secondo non
parte e il coupon non viene emesso.

L'identificativo del ciclo è `carta:<giorno dell'ultimo acquisto>`: finché il cliente non
ricompra, la chiave non cambia e non può essere arruolato due volte per lo stesso ciclo.

---

### 3.4 Riacquisto Toner e Cartucce

> *Chi ha acquistato toner o cartucce viene ricontattato al termine del ciclo di consumo stimato.*

| Parametro | Valore |
| --- | --- |
| **Trigger** | `repurchase_due`, famiglie `toner` e `cartucce` |
| **Cooldown** | 30 giorni |
| **Tetto annuale** | 8 email per contatto |
| **Giorni consentiti** | lunedì – sabato |
| **Ritmo massimo** | 300 invii/ora |

| Step | Ritardo | Annulla se | Coupon |
| --- | --- | --- | --- |
| Promemoria consumabili | **1440 ore** (= 60 giorni) | ha già riacquistato · si è disiscritto | — |
| Recupero con sconto | **1560 ore** (= 65 giorni) | idem | prefisso `RICARICA`, **-10%**, valido **14 giorni**, limitato a `toner` e `cartucce`, **solo SKU compatibili** con la stampante del cliente |

---

## 4. Il parametro **1440**

Il requisito di AlphaInk indicava **"1440"** senza unità di misura. Questa è l'interpretazione
adottata e il motivo.

### 4.1 Interpretazione

**1440 = 1440 ore = 60 giorni.**

Lo dice `functions/src/automations/defaults.ts:10`. Il valore è memorizzato come oggetto `Delay`:

```ts
delay: { value: 1440, unit: 'hours' }
```

### 4.2 Perché ore e non minuti o giorni

- **1440 minuti = 24 ore.** Un promemoria di riacquisto toner dopo un giorno dall'acquisto non ha
  senso: il cliente ha appena ricevuto la merce.
- **1440 giorni ≈ 4 anni.** Fuori scala per un consumabile.
- **1440 ore = 60 giorni** coincide esattamente con il ciclo medio di consumo di un toner o di una
  cartuccia in un ufficio, ed è lo stesso valore di `DEFAULT_REPURCHASE_CYCLE_DAYS.toner`, che vale
  appunto 60 giorni. Le due impostazioni sono coerenti fra loro per costruzione.

Il numero 1440 è anche, con ogni probabilità, il modo in cui il requisito è stato scritto in
origine: 1440 è i minuti in un giorno, ed è facile che sia stato riportato come "ore" per analogia.
L'interpretazione a 60 giorni è quella che rende il flusso commercialmente sensato.

### 4.3 Come modificarlo

**Il valore non è cablato nel codice.** Si cambia dalla UI, senza toccare nulla:

1. **Automazioni → Riacquisto Toner e Cartucce**.
2. Scheda **Flusso**, step *Promemoria consumabili (1440 ore)*.
3. Nel campo **Ritardo** cambia il numero e, se vuoi, l'unità dal selettore
   (minuti / ore / giorni).
4. Salva.

Equivalenze pratiche:

| Se vuoi | Imposta |
| --- | --- |
| 60 giorni (default, altra unità) | `60` giorni — identico a `1440` ore |
| 45 giorni | `45` giorni, oppure `1080` ore |
| 90 giorni | `90` giorni, oppure `2160` ore |
| 30 giorni | `30` giorni, oppure `720` ore |

Ricordati di spostare **anche il secondo step**, che di default è a `1560` ore (65 giorni), cioè
5 giorni dopo il primo. Il ritardo è calcolato dal trigger, non dallo step precedente: se porti il
primo a 90 giorni e lasci il secondo a 1560 ore, il secondo partirebbe **prima** del primo.

### 4.4 Il parametro correlato: il ciclo di riacquisto

C'è un secondo numero che governa questo flusso, ed è quello che decide **quando il contatto viene
arruolato**: `repurchaseCycleDays.toner`, in Impostazioni → Sito, predefinito a **60 giorni**.

I due parametri lavorano insieme:

```
data ultimo ordine di toner
        │
        ├── + repurchaseCycleDays.toner (60 g)  →  stats.nextPurchaseDueAt.toner
        │                                          ↑ lo scanner arruola quando arriva questa data
        │
        └── il ritardo dello step (1440 h) parte dalla data dell'ultimo ordine
```

Tenerli **allineati** è la configurazione corretta: se il ciclo è 60 giorni e il ritardo dello step
è 1440 ore, il contatto viene arruolato e l'email parte allo stesso momento. Se cambi uno dei due,
cambia anche l'altro, altrimenti introduci uno sfasamento (per esempio: arruolamento a 60 giorni ma
invio programmato a 90, con 30 giorni di run in attesa).

### 4.5 Consiglio: tara il ciclo sui tuoi dati

60 giorni è una media. La resa reale di un toner dipende dal modello e dal volume di stampa del
cliente. Se vuoi essere più preciso:

- il campo `contacts.stats.averageDaysBetweenOrders` misura il ritmo **effettivo** di ogni cliente;
- guarda la distribuzione sui clienti che riacquistano con regolarità e correggi
  `repurchaseCycleDays.toner` di conseguenza;
- meglio **anticipare** che ritardare: un promemoria che arriva quando il toner è ancora al 20%
  intercetta il cliente prima che lo compri altrove; uno che arriva a toner esaurito arriva tardi.

---

## 5. Le altre due automazioni

### 5.1 Benvenuto

> *Primo contatto per i nuovi iscritti alla newsletter.*

| Parametro | Valore |
| --- | --- |
| **Trigger** | `contact_subscribed` |
| **Cooldown** | 365 giorni |
| **Tetto annuale** | 2 email per contatto |
| **Giorni consentiti** | tutti |
| **Ritmo massimo** | 500 invii/ora |

| Step | Ritardo | Coupon |
| --- | --- | --- |
| Email di benvenuto | **15 minuti** | prefisso `BENVENUTO`, **-10%**, valido **30 giorni**, spesa minima **25 €** |
| Guida alla scelta | **7 giorni** | — |

Quindici minuti e non zero: l'iscrizione arriva spesso mentre il cliente sta ancora navigando, e
un piccolo ritardo evita che l'email atterri prima che il contatto sia consolidato lato sito.

### 5.2 Riattivazione (Win-back)

> *Riattivazione dei clienti inattivi da lungo tempo.*

| Parametro | Valore |
| --- | --- |
| **Trigger** | `inactivity`, **180 giorni** senza ordini |
| **Cooldown** | 365 giorni |
| **Tetto annuale** | 2 email per contatto |
| **Giorni consentiti** | lunedì – sabato |
| **Ritmo massimo** | 200 invii/ora |

| Step | Ritardo | Annulla se | Coupon |
| --- | --- | --- | --- |
| Ci manchi | **0 giorni** (subito) | ha acquistato qualsiasi cosa · si è disiscritto | — |
| Offerta di rientro | **10 giorni** | idem | prefisso `RITORNO`, **-10%**, valido **21 giorni**, spesa minima **30 €** |

Il ritmo è volutamente il più basso di tutti (200/ora): si scrive a contatti freddi, il rischio di
segnalazioni spam è più alto, e un volume contenuto limita il danno alla reputazione.

---

## 6. Ciclo di vita di una run

```
scheduled ──claim──▶ (valutazione cancelIf) ──▶ sent
     │                        │
     │                        ├──▶ cancelled  (condizione soddisfatta,
     │                        │                contatto non più contattabile)
     │                        └──▶ skipped    (contenuto assente,
     │                                         modalità test senza indirizzi)
     └──────────────────────────▶ failed      (errore di invio o di rendering)
```

`scheduledAutomationDispatcher` gira ogni 5 minuti, preleva al massimo 300 run scadute e le lavora
con concorrenza 8, entro un budget di 6 minuti.

**Claim transazionale.** Due istanze del dispatcher possono pescare la stessa run: la transazione
scrive `processedAt` e chi arriva secondo la salta. Un claim più vecchio di 10 minuti è considerato
abbandonato (l'istanza precedente è morta) e può essere ripreso.

Sequenza di un invio, in ordine:

1. claim della run;
2. valutazione delle condizioni di annullamento;
3. emissione del coupon, se previsto;
4. costruzione del contesto di merge e degli URL di sistema;
5. rendering dell'email con i merge tag risolti;
6. invio via `POST /smtp/email`;
7. scrittura di `messageId`, stato della run e statistiche dello step.

Il riferimento d'invio è `a:<automationId>:<stepId>:<runId>`, così click e aperture sono
attribuibili alla singola esecuzione.

---

## 7. Consigli di configurazione

### Prima di attivare

1. **Verifica il mittente.** Le automazioni usano nome azienda ed email di assistenza da
   Impostazioni → Brand. Quell'indirizzo deve esistere ed essere verificato fra i mittenti Brevo,
   altrimenti ogni invio viene rifiutato con `400`.
2. **Rileggi i testi.** I contenuti predefiniti sono ben scritti ma generici: adattali al tono di
   AlphaInk, controlla i link ai prodotti e le condizioni dei coupon.
3. **Attiva la modalità di prova** con due o tre indirizzi interni e lascia girare qualche giorno.
   Riceverai le email reali senza toccare i clienti.
4. **Verifica i coupon su PrestaShop.** Fai emettere un buono e controlla che la `cart_rule` sia
   stata creata, che il codice si applichi al checkout e che le restrizioni per famiglia
   funzionino.
5. **Controlla i link tracciati.** Clicca dall'email e verifica di finire sul sito passando dal
   redirector; apri il link di disiscrizione. Vedi [`SETUP.md`](SETUP.md), §9.

### Ordine di attivazione consigliato

Non accenderle tutte insieme: se qualcosa va storto, non sapresti quale flusso lo ha causato.

| Ordine | Automazione | Perché |
| --- | --- | --- |
| 1 | **Pagamento Abbandonato** | Ritorno immediato e misurabile, volumi bassi, contenuto di servizio |
| 2 | **Coupon Stampante** | Volumi bassissimi, pubblico molto qualificato |
| 3 | **Riacquisto Toner e Cartucce** | Il flusso di maggior valore, ma con volumi importanti |
| 4 | **Riacquisto Carta** | Come sopra |
| 5 | **Benvenuto** | Va bene in qualsiasi momento; si accende insieme al modulo di iscrizione |
| 6 | **Win-back** | Per ultima: pubblico freddo, rischio spam più alto |

Aspetta una settimana fra un'attivazione e la successiva e guarda tasso di bounce e segnalazioni
spam prima di procedere.

### Parametri da rivedere per primi

| Parametro | Dove | Quando toccarlo |
| --- | --- | --- |
| `abandonedPaymentAfterMinutes` | Impostazioni → Sito | 60 minuti è aggressivo se accetti bonifico bancario: con quel metodo il pagamento arriva in giorni, non in ore. Valuta 240-1440 minuti, oppure escludi gli ordini con bonifico dal pubblico dell'automazione |
| `repurchaseCycleDays.*` | Impostazioni → Sito | Dopo qualche mese di dati, tarali su `averageDaysBetweenOrders` |
| `minOrderTotal` del pagamento abbandonato | Automazione → Pubblico | 10 € è calibrato sul B2C. Sul B2B, dove gli ordini medi sono più alti, ha senso salire |
| `maxPerContactPerYear` | Automazione → Frequenza | 24 email/anno per il pagamento abbandonato è molto: un cliente che abbandona spesso riceve tante email. Se vedi disiscrizioni concentrate su quel flusso, abbassalo |
| `quietHours` | Automazione → Pianificazione | Sul B2B puro puoi stringere a `18:00 – 08:00`: gli uffici leggono in orario di lavoro |

### Escludere pubblici specifici

Ogni automazione ha `excludeClusterIds` e `audienceFilter`. Usi tipici:

- **Escludere i rivenditori** dalle promozioni B2C: crea un cluster `segment = b2b` e aggiungilo
  agli esclusi delle automazioni promozionali.
- **Escludere i clienti a contratto**, che hanno già condizioni dedicate: cluster su
  `customerGroup` o su un tag.
- **Limitare ai clienti attivi**: `audienceFilter` con `engagement.engagementTier è uno di
  [hot, warm]`, per non insistere su chi non apre da mesi.

### Come misurare se funzionano

In **Analytics → Automazioni** e nella scheda *Statistiche* di ogni automazione trovi, per step:
programmati, inviati, annullati, consegnati, aperti, cliccati, disiscritti, bounce, ordini e
fatturato attribuito.

Le due letture più utili:

- **Tasso di annullamento alto** su un'automazione di recupero è un **buon** segno: significa che i
  clienti completano l'ordine o riacquistano prima che l'email parta. Sul pagamento abbandonato,
  molti annullamenti al secondo e terzo step significano che il primo promemoria funziona.
- **Fatturato attribuito per email inviata** è la metrica che dice se il flusso ripaga. Confrontala
  fra step: se il terzo promemoria con sconto genera meno margine di quanto costa lo sconto stesso,
  disattiva quello step invece dell'intera automazione.

Vedi [`TRACKING.md`](TRACKING.md) per come leggere l'attribuzione e [`OPERATIVITA.md`](OPERATIVITA.md)
per la routine di controllo.
