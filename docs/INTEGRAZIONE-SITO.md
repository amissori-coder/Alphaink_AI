# Integrazione con i negozi PrestaShop

AlphaInk ha due negozi, **entrambi su PrestaShop**:

| Sorgente | Negozio | URL | Segmento predefinito |
| --- | --- | --- | --- |
| `prestashop_b2c` | Vendita al pubblico | <https://alphaink.net> | `b2c` |
| `prestashop_b2b` | Canale rivenditori | <https://b2b.alphaink.net> | `b2b` |

Possono essere due installazioni distinte oppure due shop della stessa installazione in
**multistore**: la configurazione copre entrambi i casi tramite il campo `multistoreShopId`
(`null` = installazione dedicata, valorizzato = filtra per shop).

Ogni negozio si collega in **una** di due modalità, scelta da Impostazioni → Sito e memorizzata in
`settings/site.stores.<sorgente>.mode`:

- **`webservice`** — API ufficiale PrestaShop `/api/...`. Non richiede accesso al database ed è
  l'unica strada per *scrivere* (i buoni sconto).
- **`mysql`** — lettura diretta dal database, in sola lettura. Molto più veloce sui grandi volumi.

Le due modalità producono documenti Firestore identici: sotto l'adapter i backend parlano lo stesso
linguaggio intermedio (`Ps*Row`) e condividono la normalizzazione. Puoi passare dall'una all'altra
senza migrazioni. Anche in modalità `mysql`, la creazione dei coupon passa comunque dal
Webservice: se la chiave manca, l'operazione fallisce con un messaggio esplicito invece di
scrivere sul database del negozio (`functions/src/sync/prestashop.ts:10`).

---

## A. Modalità Webservice

### A.1 Attivare il Webservice

Nel back office di PrestaShop:

1. **Parametri Avanzati → Webservice**.
2. Metti **Abilita il webservice PrestaShop** su **Sì**.
3. Lascia **Abilita la modalità CGI di PrestaShop** su **No**, a meno che l'hosting non lo
   richieda esplicitamente.
4. Salva.

> Se l'hosting gira in PHP-CGI o FastCGI, l'header `Authorization` viene spesso rimosso prima di
> arrivare a PHP. Il client lo gestisce da solo: al primo `401` ritenta una volta passando la
> chiave come parametro `ws_key`, che PrestaShop accetta
> (`functions/src/sync/prestashop-webservice.ts:41`). Se serve stabilmente, aggiungi nel
> `.htaccess` del negozio:
>
> ```apache
> RewriteEngine On
> RewriteCond %{HTTP:Authorization} ^(.*)
> RewriteRule ^(.*) - [E=HTTP_AUTHORIZATION:%1]
> ```

### A.2 Creare la chiave

1. Sempre in **Parametri Avanzati → Webservice**, premi **Aggiungi nuova chiave webservice**.
2. **Genera** la chiave (32 caratteri alfanumerici) e copiala: dopo il salvataggio PrestaShop la
   mostra ancora, ma è più comodo prenderla subito.
3. **Chiave descrizione**: `AlphaInk Newsletter Suite`.
4. **Stato**: Sì.
5. In multistore, seleziona lo **shop** a cui la chiave dà accesso.
6. Assegna i permessi come nella tabella qui sotto, poi salva.

Crea **due chiavi separate**, una per negozio, e salvale nei rispettivi secret:

```bash
firebase functions:secrets:set PRESTASHOP_B2C_WS_KEY
firebase functions:secrets:set PRESTASHOP_B2B_WS_KEY
```

Puoi anche incollarle in Impostazioni → Sito: vengono validate, scritte in Secret Manager e mai
salvate su Firestore (`functions/src/sync/settings.ts:8`).

### A.3 Permessi per risorsa

Nella tabella dei permessi della chiave, spunta **solo** queste caselle. Le colonne non elencate
(`PUT`, `DELETE`, `HEAD`) vanno lasciate vuote: la sincronizzazione è di sola lettura, tranne per
i buoni sconto.

| Risorsa | GET | POST | A cosa serve nell'applicazione |
| --- | :---: | :---: | --- |
| `customers` | ✅ | | Anagrafica dei contatti, consenso newsletter, gruppo cliente |
| `groups` | ✅ | | Gruppi cliente → mappa segmento B2C / B2B |
| `addresses` | ✅ | | Città, provincia, CAP, telefono, azienda, P.IVA del contatto |
| `orders` | ✅ | | Ordini: totale, valuta, stato corrente, data |
| `order_details` | ✅ | | **Righe** dell'ordine: prodotto, SKU, quantità, imponibili |
| `order_states` | ✅ | | Etichette leggibili degli stati (per `rawStatus`) |
| `order_histories` | ✅ | | Storico dei passaggi di stato: datazione di incasso e annullamento |
| `carts` | ✅ | | Carrelli non convertiti → automazione "carrello abbandonato" |
| `products` | ✅ | | Nome, SKU (`reference`), EAN, prezzo, attivo |
| `categories` | ✅ | | Albero categorie → percorso usato dalla classificazione per famiglia |
| `cart_rules` | ✅ | ✅ | **Lettura**: stato dei buoni emessi, per marcare i riscatti.<br>**Scrittura**: creazione dei buoni delle automazioni |
| `countries` | ✅ | | Codice ISO del paese del contatto |
| `states` | ✅ | | Sigla provincia (PrestaShop registra le province italiane come *states*) |

`POST` su `cart_rules` è l'**unico** permesso di scrittura richiesto. Se non intendi far generare
coupon alle automazioni, puoi ometterlo: gli step con `coupon.createOnSite: true` falliranno
esplicitamente e l'email non partirà (per non spedire codici inesistenti).

La prova di connessione da Impostazioni → Sito legge la radice `/api/` e verifica che la chiave
abbia accesso ad almeno queste risorse: `customers`, `orders`, `carts`, `products`, `categories`,
`groups`, `order_states`. Se ne manca una, l'errore le elenca per nome
(`functions/src/sync/prestashop-webservice.ts:1076`).

### A.4 Nota sul multistore

In un'installazione multistore, la stessa base dati serve più negozi.

- **Sulla chiave**: assegna alla chiave Webservice l'accesso al solo shop di competenza.
- **Nell'applicazione**: in Impostazioni → Sito, compila **Id shop multistore** con l'`id_shop`
  del negozio. Il client lo aggiunge come parametro `id_shop` su ogni richiesta.
- **Se le due installazioni sono separate**, lascia il campo **vuoto** (`null`): nessun filtro
  viene applicato.

Come trovare l'`id_shop`: back office → **Parametri Avanzati → Negozi**, oppure query
`SELECT id_shop, name FROM ps_shop;`. La prova di connessione in modalità MySQL elenca gli shop
disponibili e segnala se l'id configurato non esiste.

### A.5 Come parla il Webservice (per diagnosticare)

- Autenticazione HTTP Basic: chiave come **username**, password **vuota** →
  `Authorization: Basic base64(chiave + ":")`.
- Formato `?output_format=JSON`. La risposta è un oggetto con una sola chiave uguale al nome della
  risorsa: `{"customers": [...]}`.
- Paginazione `limit={offset},{count}` con `sort=[id_ASC]`.
- Filtri: `filter[campo]=valore`, `filter[campo]=[a|b|c]` per l'OR, `filter[campo]=[da,a]` per
  l'intervallo. **Sui campi data serve anche `date=1`**, altrimenti il filtro viene ignorato in
  silenzio — è la causa più comune di "la sincronizzazione incrementale rilegge tutto".
- Quando un filtro non seleziona nulla, PrestaShop può rispondere `200` con corpo vuoto, `{}`
  oppure `404`: tutti e tre significano "nessun record", non errore.
- I campi multilingua non sono stringhe: `name` arriva come `[{"id":"1","value":"Toner"}]`, una
  voce per lingua. Viene scelta quella con `id` uguale al `languageId` configurato sul negozio.
- In **scrittura** il Webservice vuole XML anche con `output_format=JSON`.

Prova rapida dalla riga di comando:

```bash
curl -s -u "LA_TUA_CHIAVE:" \
  "https://alphaink.net/api/customers?output_format=JSON&limit=0,1&display=full"
```

Se risponde `401`, la chiave è sbagliata o disattivata. Se risponde con l'elenco delle risorse
invece dei clienti, mancano i permessi su `customers`.

---

## B. Modalità MySQL in sola lettura

### B.1 Perché conviene sui volumi AlphaInk

Il Webservice serve **una richiesta HTTP per pagina** e almeno una in più per ogni risorsa figlia
(righe ordine, storico stati, righe carrello). Su un catalogo e uno storico ordini delle dimensioni
di AlphaInk, un backfill completo passa da ore a secondi leggendo direttamente il database: le
stesse informazioni arrivano con poche query in join, senza il costo di PHP, di Doctrine e della
serializzazione XML/JSON per ogni record.

Regola pratica: **backfill iniziale e resincronizzazioni massive in `mysql`**, esercizio corrente
indifferentemente nelle due modalità.

### B.2 GRANT minima

Crea un utente dedicato, con il **solo** privilegio `SELECT` e limitato alle tabelle effettivamente
lette. Non riusare l'utente di PrestaShop.

```sql
-- Sostituisci: password robusta, IP di origine, nome del database.
CREATE USER 'alphaink_newsletter_ro'@'%'
  IDENTIFIED BY 'UNA_PASSWORD_LUNGA_E_CASUALE';

-- Variante permissiva (comoda): SELECT su tutto il database.
GRANT SELECT ON `alphaink_b2c`.* TO 'alphaink_newsletter_ro'@'%';

FLUSH PRIVILEGES;
```

Variante minima, tabella per tabella — è la forma consigliata in produzione, perché l'utente non
può leggere nulla oltre a quello che serve (adatta il prefisso se non è `ps_`):

```sql
GRANT SELECT ON `alphaink_b2c`.`ps_customer`         TO 'alphaink_newsletter_ro'@'%';
GRANT SELECT ON `alphaink_b2c`.`ps_customer_group`   TO 'alphaink_newsletter_ro'@'%';
GRANT SELECT ON `alphaink_b2c`.`ps_group_lang`       TO 'alphaink_newsletter_ro'@'%';
GRANT SELECT ON `alphaink_b2c`.`ps_address`          TO 'alphaink_newsletter_ro'@'%';
GRANT SELECT ON `alphaink_b2c`.`ps_country`          TO 'alphaink_newsletter_ro'@'%';
GRANT SELECT ON `alphaink_b2c`.`ps_state`            TO 'alphaink_newsletter_ro'@'%';
GRANT SELECT ON `alphaink_b2c`.`ps_orders`           TO 'alphaink_newsletter_ro'@'%';
GRANT SELECT ON `alphaink_b2c`.`ps_order_detail`     TO 'alphaink_newsletter_ro'@'%';
GRANT SELECT ON `alphaink_b2c`.`ps_order_history`    TO 'alphaink_newsletter_ro'@'%';
GRANT SELECT ON `alphaink_b2c`.`ps_order_state_lang` TO 'alphaink_newsletter_ro'@'%';
GRANT SELECT ON `alphaink_b2c`.`ps_cart`             TO 'alphaink_newsletter_ro'@'%';
GRANT SELECT ON `alphaink_b2c`.`ps_cart_product`     TO 'alphaink_newsletter_ro'@'%';
GRANT SELECT ON `alphaink_b2c`.`ps_cart_rule`        TO 'alphaink_newsletter_ro'@'%';
GRANT SELECT ON `alphaink_b2c`.`ps_product`          TO 'alphaink_newsletter_ro'@'%';
GRANT SELECT ON `alphaink_b2c`.`ps_product_lang`     TO 'alphaink_newsletter_ro'@'%';
GRANT SELECT ON `alphaink_b2c`.`ps_category`         TO 'alphaink_newsletter_ro'@'%';
GRANT SELECT ON `alphaink_b2c`.`ps_category_lang`    TO 'alphaink_newsletter_ro'@'%';
GRANT SELECT ON `alphaink_b2c`.`ps_category_product` TO 'alphaink_newsletter_ro'@'%';
GRANT SELECT ON `alphaink_b2c`.`ps_shop`             TO 'alphaink_newsletter_ro'@'%';
FLUSH PRIVILEGES;
```

Ripeti per il database del B2B (o, in multistore, è lo stesso database: basta un utente).

### B.3 Tabelle lette

| Tabella | Cosa se ne ricava |
| --- | --- |
| `customer` | Anagrafica, consenso `newsletter`/`optin`, attivo, cancellato, lingua, date |
| `customer_group` + `group_lang` | Gruppi del cliente → segmento B2C / B2B |
| `address` | Città, provincia, CAP, telefono, azienda, P.IVA |
| `country`, `state` | Codici ISO di paese e provincia |
| `orders` | Testata dell'ordine: totale, valuta, stato corrente, pagamento, date |
| `order_detail` | Righe: prodotto, `reference` (SKU), quantità, prezzi |
| `order_history` | Storico degli stati → datazione di incasso, annullamento, rimborso |
| `order_state_lang` | Etichette leggibili degli stati |
| `cart`, `cart_product` | Carrelli e loro righe → carrelli abbandonati |
| `cart_rule` | Stato dei buoni emessi, per marcare i riscatti |
| `product`, `product_lang` | Nome, SKU, EAN, prezzo, attivo |
| `category`, `category_lang`, `category_product` | Albero categorie e percorso di ogni prodotto |
| `shop` | Elenco degli shop, usato dalla diagnostica del multistore |

Nessuna tabella viene scritta: il backend esegue **solo** `SELECT`.

### B.4 Restringere l'accesso per IP

Aprire MySQL a `'%'` significa esporre il database a Internet. Restringilo.

**Cosa autorizzare.** Le Cloud Functions non hanno un IP fisso: escono da un intervallo che cambia.
Hai tre strade, in ordine di sicurezza decrescente:

1. **Connettore VPC + Cloud NAT con IP statico** (consigliato in produzione). Configuri
   l'egress delle Functions attraverso un IP riservato e autorizzi solo quello:

   ```sql
   CREATE USER 'alphaink_newsletter_ro'@'34.140.12.34' IDENTIFIED BY '...';
   ```

   Il repository non configura il connettore: va creato in Google Cloud e associato alle funzioni
   che accedono al database.

2. **Intervalli IP di Google Cloud `europe-west1`**. Più larghi di un IP singolo, ma molto meglio
   di `'%'`. Gli intervalli pubblicati da Google cambiano nel tempo: vanno rivisti periodicamente.

3. **Tunnel SSH o VPN** verso l'host del database, se l'hosting lo consente.

**In ogni caso**, indipendentemente dalla strada scelta:

- usa una password lunga e casuale, salvata **solo** in Secret Manager
  (`PRESTASHOP_B2C_DB_PASSWORD`, `PRESTASHOP_B2B_DB_PASSWORD`);
- abilita TLS sulla connessione se l'hosting lo permette;
- se il pannello di hosting ha una whitelist IP per MySQL remoto, usala anche a valle delle regole
  del server;
- verifica periodicamente i log di accesso.

### B.5 Parametri di connessione

Host, porta, utente e nome del database sono **parametri**, non secret (non sono sensibili di per
sé). Si impostano in `functions/.env`:

```dotenv
PRESTASHOP_B2C_DB_HOST=db.alphaink.net
PRESTASHOP_B2C_DB_PORT=3306
PRESTASHOP_B2C_DB_USER=alphaink_newsletter_ro
PRESTASHOP_B2C_DB_NAME=alphaink_b2c

PRESTASHOP_B2B_DB_HOST=db.alphaink.net
PRESTASHOP_B2B_DB_PORT=3306
PRESTASHOP_B2B_DB_USER=alphaink_newsletter_ro
PRESTASHOP_B2B_DB_NAME=alphaink_b2b
```

Il **prefisso tabelle** (`ps_` di default) e la **lingua** si configurano invece da UI, in
Impostazioni → Sito, perché possono differire fra i due negozi. Il prefisso è validato con
`/^[A-Za-z0-9_]{0,16}$/`: è l'unico frammento SQL interpolato, perché il nome di una tabella non
può essere un placeholder.

### B.6 Dettagli implementativi utili in diagnosi

- **Paginazione keyset**, mai `OFFSET`: `WHERE id > ? ORDER BY id ASC LIMIT ?`. Su milioni di righe
  l'offset costringe MySQL a scartare tutte le righe precedenti a ogni pagina, con costo
  quadratico.
- **`dateStrings: true`**: senza, `mysql2` convertirebbe i `DATETIME` in `Date` interpretandoli nel
  fuso del processo (UTC su Cloud Functions), mentre PrestaShop li salva nell'ora locale del
  negozio. Le stringhe grezze vengono convertite da `parsePsDate`, che conosce il fuso giusto.
- **`query()` invece di `execute()`**: gli statement preparati di MySQL non accettano placeholder
  in `LIMIT` in modo affidabile su tutte le versioni. `query()` fa l'escaping lato client, quindi
  la protezione da injection resta.

---

## C. Mappatura degli stati ordine

In PrestaShop gli id degli stati ordine sono **personalizzabili**: ogni installazione può
aggiungerne, rinominarli o rinumerarli. Per questo la mappa non è cablata nel codice ma vive in
`settings/site.stores.<sorgente>.orderStateMapping` ed è modificabile da
**Impostazioni → Sito → Mappatura stati ordine**.

### C.1 Stati normalizzati dell'applicazione

| Stato normalizzato | Significato | Conta come fatturato? |
| --- | --- | :---: |
| `pending` | In lavorazione, esito ignoto | No |
| `awaiting_payment` | Ordine creato, pagamento non ancora arrivato | No |
| `paid` | Pagamento incassato | ✅ |
| `processing` | In preparazione | ✅ |
| `shipped` | Spedito | ✅ |
| `completed` | Consegnato | ✅ |
| `cancelled` | Annullato | No |
| `refunded` | Rimborsato | No |
| `failed` | Errore di pagamento | No |

Gli stati marcati ✅ sono in `REVENUE_ORDER_STATUSES` e concorrono al fatturato attribuito.
Gli stati `awaiting_payment` e affini sono in `ABANDONED_PAYMENT_STATUSES` e fanno scattare
l'automazione "Pagamento Abbandonato".

### C.2 Mappa di partenza

Corrisponde agli stati "di fabbrica" di PrestaShop (`DEFAULT_PRESTASHOP_ORDER_STATES` in
`packages/shared/src/constants/defaults.ts:188`):

| Id | Nome tipico in PrestaShop | Stato normalizzato |
| --- | --- | --- |
| 1 | In attesa del pagamento con assegno | `awaiting_payment` |
| 2 | Pagamento accettato | `paid` |
| 3 | Preparazione in corso | `processing` |
| 4 | Spedito | `shipped` |
| 5 | Consegnato | `completed` |
| 6 | Annullato | `cancelled` |
| 7 | Rimborsato | `refunded` |
| 8 | Errore di pagamento | `failed` |
| 9 | In attesa di rifornimento (pagato) | `processing` |
| 10 | In attesa di bonifico bancario | `awaiting_payment` |
| 11 | Pagamento remoto accettato | `paid` |
| 12 | In attesa di rifornimento (non pagato) | `pending` |
| 13 | In attesa di validazione contrassegno | `awaiting_payment` |

### C.3 Come compilarla per i negozi AlphaInk

1. **Leggi gli stati reali del negozio.** Back office → **Ordini → Stati**: la colonna ID è quella
   che serve. Oppure:

   ```sql
   SELECT osl.id_order_state, osl.name
     FROM ps_order_state_lang osl
    WHERE osl.id_lang = 1
    ORDER BY osl.id_order_state;
   ```

2. **Apri Impostazioni → Sito** nella web app, scheda del negozio, sezione *Mappatura stati
   ordine*. Vedrai la mappa corrente.

3. **Per ogni id, scegli lo stato normalizzato.** Le domande da porsi, in quest'ordine:
   - *I soldi sono incassati?* Se sì → `paid`, o uno fra `processing` / `shipped` / `completed` a
     seconda della fase logistica.
   - *L'ordine esiste ma il pagamento non è arrivato?* → `awaiting_payment`. È ciò che attiva il
     recupero del pagamento abbandonato.
   - *L'ordine è chiuso senza incasso?* → `cancelled`, `refunded` o `failed`.
   - *Non lo so?* → `pending`.

4. **Salva e verifica.** Vai in Ordini e controlla che il fatturato del periodo coincida con quello
   del back office di PrestaShop. Uno scarto sistematico verso il basso significa quasi sempre uno
   stato di incasso non mappato.

### C.4 Regola di sicurezza: nel dubbio, `pending`

Uno stato **non presente** nella mappa diventa `pending`, **mai** `paid`
(`functions/src/sync/prestashop.ts:16`). La scelta è deliberata: se AlphaInk aggiunge uno stato e
dimentica di mapparlo, l'ordine resta fuori dal fatturato attribuito finché la mappa non viene
completata. Meglio sottostimare le vendite che attribuire ricavi a una newsletter per un ordine
mai incassato.

L'unica eccezione è l'evento webhook `order.paid`, che è esplicito: se lo stato non è mappato come
incassato, l'evento vale più della mappa e l'ordine diventa comunque `paid`
(`functions/src/sync/webhook.ts:436`).

### C.5 Mappatura dei gruppi cliente

Stesso principio per il segmento B2C / B2B. In
`settings/site.stores.<sorgente>.customerGroupMapping` associ il **nome** del gruppo PrestaShop a
`b2c` o `b2b`. I default sono:

- **B2C**: `Visitatore → b2c`, `Ospite → b2c`, `Cliente → b2c`
- **B2B**: `Rivenditori → b2b`, `Grossisti → b2b`, `Visitatore → b2b`, `Ospite → b2b`,
  `Cliente → b2b`

Un gruppo non mappato ricade sul `defaultSegment` del negozio.

---

## D. Webhook dal sito verso `siteWebhook`

La sincronizzazione oraria è sufficiente per i contatti e per le statistiche, ma **non** per il
recupero: un carrello abbandonato notificato con un'ora di ritardo ha già perso gran parte del suo
valore. I webhook rendono immediate le automazioni "carrello abbandonato" e "pagamento
abbandonato".

### D.1 Endpoint e autenticazione

```
POST https://europe-west1-<id-progetto>.cloudfunctions.net/siteWebhook
Content-Type: application/json
X-Alphaink-Signature: <HMAC-SHA256 del corpo grezzo, base64url>
```

La firma si calcola sul corpo **esattamente come inviato** — non sul JSON ri-serializzato:
l'ordine delle chiavi e gli spazi cambierebbero l'HMAC. Il prefisso `sha256=` è accettato.

Il segreto condiviso è `SITE_WEBHOOK_SECRET`:

```bash
firebase functions:secrets:set SITE_WEBHOOK_SECRET
```

### D.2 Calcolo della firma in PHP

Questo è il codice da usare nel modulo o negli hook di PrestaShop:

```php
<?php
/** Segreto condiviso: lo stesso valore salvato in SITE_WEBHOOK_SECRET. */
const ALPHAINK_WEBHOOK_SECRET = 'IL_TUO_SEGRETO';
const ALPHAINK_WEBHOOK_URL =
    'https://europe-west1-alphaink-newsletter.cloudfunctions.net/siteWebhook';

function alphainkInviaEvento(string $evento, string $sorgente, array $dati): bool
{
    $payload = [
        'event'  => $evento,      // es. 'order.paid'
        'source' => $sorgente,    // 'prestashop_b2c' oppure 'prestashop_b2b'
        'sentAt' => gmdate('c'),  // ISO-8601 UTC
        'data'   => $dati,
    ];

    // Il corpo va serializzato UNA volta sola: la firma e l'invio usano
    // esattamente la stessa stringa di byte.
    $body = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

    // HMAC-SHA256 in base64url, senza padding.
    $raw = hash_hmac('sha256', $body, ALPHAINK_WEBHOOK_SECRET, true);
    $sig = rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');

    $ch = curl_init(ALPHAINK_WEBHOOK_URL);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $body,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json',
            'X-Alphaink-Signature: ' . $sig,
        ],
    ]);
    $risposta = curl_exec($ch);
    $stato    = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    // Ritenta SOLO sui 5xx: 4xx significa payload o firma da correggere.
    return $stato >= 200 && $stato < 300;
}
```

Verifica dalla riga di comando:

```bash
BODY='{"event":"customer.updated","source":"prestashop_b2c","sentAt":"2026-09-02T10:15:00Z","data":{"id":"1","email":"prova@alphaink.net","newsletter":true}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SITE_WEBHOOK_SECRET" -binary \
      | openssl base64 -A | tr '+/' '-_' | tr -d '=')

curl -sS -X POST "https://europe-west1-alphaink-newsletter.cloudfunctions.net/siteWebhook" \
  -H "Content-Type: application/json" \
  -H "X-Alphaink-Signature: $SIG" \
  -d "$BODY"
```

### D.3 Eventi accettati

`order.created`, `order.updated`, `order.paid`, `cart.updated`, `customer.created`,
`customer.updated`.

Un evento non riconosciuto riceve `202` (accettato ma ignorato), non un errore.

### D.4 Payload di esempio

**Ordine** — `order.created`, `order.updated`, `order.paid`:

```json
{
  "event": "order.paid",
  "source": "prestashop_b2c",
  "sentAt": "2026-09-02T10:15:00Z",
  "data": {
    "id": "12345",
    "reference": "ABCDEFGHI",
    "email": "cliente@esempio.it",
    "customerId": "998",
    "cartId": "555",
    "firstName": "Mario",
    "lastName": "Rossi",
    "stateId": "2",
    "stateName": "Pagamento accettato",
    "total": 122.00,
    "subtotal": 100.00,
    "shipping": 7.00,
    "tax": 15.00,
    "discounts": 0,
    "currency": "EUR",
    "payment": "Bonifico bancario",
    "couponCode": "ALPHA-A1B2-C3D4",
    "placedAt": "2026-09-02 12:03:00",
    "updatedAt": "2026-09-02 12:20:00",
    "items": [
      {
        "productId": "77",
        "sku": "TN-2420",
        "name": "Toner compatibile Brother TN-2420",
        "quantity": 2,
        "unitPrice": 45.90,
        "total": 91.80,
        "categoryPath": ["Toner", "Brother"]
      }
    ],
    "utm": { "source": "newsletter", "medium": "email", "campaign": "settembre" }
  }
}
```

Note importanti:

- **`id` ed `email` sono obbligatori.** Senza email l'ordine non è collegabile a un contatto.
- **`couponCode` è l'unico punto in cui il codice del buono ci arriva**: è ciò che rende
  deterministica l'attribuzione. Compilarlo è la cosa più utile che il modulo possa fare.
- `placedAt` e `updatedAt` accettano sia il formato PrestaShop `YYYY-MM-DD HH:MM:SS` (interpretato
  nell'ora locale del negozio) sia una data ISO con fuso.
- Numeri e booleani sono tolleranti: PrestaShop serializza `"122.00"` e `"0"`/`"1"`, e la
  conversione è esplicita — `Boolean("0")` sarebbe `true` e trasformerebbe un cliente senza
  consenso in un iscritto.
- Con `order.paid`, se lo stato non risulta mappato come incassato, l'evento **prevale** sulla
  mappa.

**Carrello** — `cart.updated`:

```json
{
  "event": "cart.updated",
  "source": "prestashop_b2c",
  "sentAt": "2026-09-02T10:15:00Z",
  "data": {
    "id": "555",
    "email": "cliente@esempio.it",
    "customerId": "998",
    "total": 91.80,
    "currency": "EUR",
    "recoveryUrl": "https://alphaink.net/index.php?controller=order&id_cart=555&id_customer=998&key=...",
    "createdAt": "2026-09-02 11:40:00",
    "updatedAt": "2026-09-02 11:52:00",
    "items": [
      {
        "productId": "77",
        "sku": "TN-2420",
        "name": "Toner compatibile Brother TN-2420",
        "quantity": 2,
        "unitPrice": 45.90,
        "total": 91.80,
        "categoryPath": ["Toner", "Brother"]
      }
    ]
  }
}
```

Un carrello inviato **senza righe** viene interpretato come "svuotato" e chiude l'eventuale
carrello abbandonato già aperto: manda l'evento anche quando il cliente svuota il carrello.

Il webhook registra il carrello con soglia zero: il sito dice che il carrello esiste *adesso*,
mentre decidere quando è "abbandonato" spetta all'automazione, che guarda `lastSeenAt`.

**Cliente** — `customer.created`, `customer.updated`:

```json
{
  "event": "customer.updated",
  "source": "prestashop_b2b",
  "sentAt": "2026-09-02T10:15:00Z",
  "data": {
    "id": "998",
    "email": "acquisti@acme.it",
    "firstName": "Mario",
    "lastName": "Rossi",
    "company": "Acme Srl",
    "vatNumber": "IT01234567890",
    "taxCode": "RSSMRA80A01H501U",
    "phone": "+39 02 1234567",
    "newsletter": true,
    "optin": false,
    "active": true,
    "groupName": "Rivenditori",
    "languageId": "1",
    "country": "IT",
    "province": "MI",
    "city": "Milano",
    "postcode": "20100",
    "createdAt": "2024-03-11 09:00:00",
    "updatedAt": "2026-09-02 10:14:00"
  }
}
```

### D.5 Risposte e ritentativi

| Codice | Significato | Il sito deve ritentare? |
| --- | --- | --- |
| `200` | Evento elaborato | No |
| `202` | Evento non gestito, ignorato | No |
| `400` | Payload non valido, o `sentAt` più vecchio di 24 ore | No — correggi il payload |
| `401` | Firma non valida | No — correggi il segreto o il calcolo |
| `405` | Metodo diverso da POST | No |
| `503` | `SITE_WEBHOOK_SECRET` non configurato | Sì |
| `500` | Errore interno | Sì, con backoff |

### D.6 Garanzie

- **Idempotenza**: gli id dei documenti sono deterministici, quindi una consegna ripetuta aggiorna
  lo stesso documento invece di duplicarlo. Il modulo può ritentare senza timori.
- **Nessuna resurrezione**: un contatto disiscritto resta disiscritto anche se il sito lo rimanda
  con la casella newsletter spuntata. È un requisito legale prima ancora che tecnico.
- **Finestra temporale**: un evento con `sentAt` più vecchio di 24 ore viene rifiutato, per
  limitare il riuso di una firma catturata.

### D.7 Dove agganciare gli eventi in PrestaShop

Hook consigliati per un modulo dedicato:

| Evento AlphaInk | Hook PrestaShop |
| --- | --- |
| `order.created` | `actionValidateOrder` |
| `order.updated`, `order.paid` | `actionOrderStatusPostUpdate` (manda `order.paid` quando il nuovo stato è di incasso) |
| `cart.updated` | `actionCartSave` (con un debounce: l'hook scatta ad ogni modifica) |
| `customer.created` | `actionCustomerAccountAdd` |
| `customer.updated` | `actionCustomerAccountUpdate`, `actionObjectCustomerUpdateAfter` |

Invia le richieste in modo **asincrono** o con timeout breve: il webhook non deve rallentare il
checkout del cliente. Un evento perso viene comunque recuperato dalla sincronizzazione oraria.

---

## E. Classificazione delle famiglie prodotto

Le automazioni di riacquisto e i cluster commerciali ragionano per **famiglia**, non per singolo
SKU. Le famiglie sono sette:

`toner`, `cartucce`, `carta`, `stampanti`, `nastri`, `accessori`, `altro`

### E.1 Come funziona la classificazione

`classifyProductFamily` (`packages/shared/src/utils/family.ts:86`) valuta le regole in ordine di
**priorità decrescente**. La prima che combacia vince. Una regola combacia se **almeno uno** di
questi confronti riesce:

- lo **SKU** corrisponde a un `skuPatterns`;
- il **nome prodotto** corrisponde a un `namePatterns`;
- il **percorso categoria** completo (unito con ` > `) corrisponde a un `categoryPatterns`;
- **uno qualsiasi** dei segmenti del percorso categoria corrisponde a un `categoryPatterns`.

I pattern usano `*` come jolly (qualsiasi sequenza) e `?` (un carattere), e il confronto è
**case-insensitive**. Se nessuna regola combacia, la famiglia è `altro`.

### E.2 Regole predefinite

| Priorità | Famiglia | Categorie | SKU | Nome prodotto |
| ---: | --- | --- | --- | --- |
| 100 | `stampanti` | `*stampant*`, `*printer*`, `*multifunzion*` | `PRN-*`, `STAMP-*` | `*stampante*`, `*multifunzione*`, `*printer*` |
| 90 | `toner` | `*toner*`, `*laser*` | `TN-*`, `TON-*`, `CE*`, `CF*`, `CRG*` | `*toner*`, `*tamburo*`, `*drum*` |
| 80 | `cartucce` | `*cartucc*`, `*inkjet*`, `*ink*` | `CT-*`, `INK-*`, `T0*`, `LC*` | `*cartuccia*`, `*cartucce*`, `*inkjet*` |
| 70 | `carta` | `*carta*`, `*paper*`, `*risme*` | `PAP-*`, `CAR-*` | `*carta*`, `*risma*`, `*risme*`, `*a4*`, `*a3*` |
| 60 | `nastri` | `*nastr*`, `*ribbon*` | `RIB-*`, `NAS-*` | `*nastro*`, `*ribbon*` |
| 50 | `accessori` | `*accessor*`, `*ricambi*` | `ACC-*` | `*fusore*`, `*rullo*`, `*cavo*`, `*accessorio*` |

L'ordine delle priorità non è casuale. Le **stampanti** sono valutate per prime perché un prodotto
come "Stampante multifunzione HP con toner incluso" deve essere classificato come stampante, non
come toner. I **toner** precedono le **cartucce** perché "toner laser" contiene `laser`, mentre
`*ink*` di `cartucce` rischierebbe di catturare nomi generici.

### E.3 Personalizzare le regole

Le regole sono modificabili da **Impostazioni → Sito → Regole famiglie prodotto**. Per ogni regola
puoi cambiare priorità, categorie, SKU e nomi; puoi aggiungerne di nuove o eliminarle.

Le personalizzazioni vengono salvate in `settings/site.familyRules` e usate da tutta
l'applicazione: sincronizzazione, automazioni, cluster, report per famiglia.

**Quando serve intervenire.** Se in Ordini vedi molte righe classificate come `altro`, o se
un'automazione di riacquisto non arruola nessuno pur essendoci gli acquisti, la causa è quasi
sempre una regola troppo stretta. Procedi così:

1. In Ordini, apri qualche ordine e guarda la famiglia assegnata alle righe.
2. Individua che cosa hanno in comune i prodotti classificati male: prefisso SKU, parola nel nome,
   categoria.
3. Aggiungi il pattern alla regola giusta — cominciando dal **percorso categoria**, che è il
   segnale più stabile: gli SKU cambiano con i fornitori, i nomi cambiano con il marketing, le
   categorie no.
4. Le classificazioni già scritte non si ricalcolano da sole: lancia una risincronizzazione degli
   ordini per riapplicare le regole nuove.

### E.4 Cicli di riacquisto

A ogni famiglia è associato un ciclo medio di consumo in giorni
(`DEFAULT_REPURCHASE_CYCLE_DAYS`), modificabile in Impostazioni → Sito:

| Famiglia | Giorni | Nota |
| --- | ---: | --- |
| `toner` | 60 | Corrisponde alle **1440 ore** del requisito AlphaInk |
| `cartucce` | 60 | |
| `carta` | 45 | |
| `nastri` | 120 | |
| `accessori` | 180 | |
| `stampanti` | 900 | Un ciclo di sostituzione, non di riacquisto |
| `altro` | 120 | |

Dopo ogni ordine, il ciclo della famiglia viene sommato alla data dell'ordine e scritto in
`contacts.stats.nextPurchaseDueAt.<famiglia>`. È il campo su cui lo scanner giornaliero seleziona
chi arruolare. Vedi [`AUTOMAZIONI.md`](AUTOMAZIONI.md).

### E.5 Riconoscimento della stampante posseduta

Dal nome dei consumabili acquistati l'applicazione deduce marca e modello della stampante del
cliente, e li salva in `contacts.printers`:

- `extractPrinterBrand` cerca una marca fra HP, Canon, Epson, Brother, Samsung, Lexmark, Xerox,
  Kyocera, Ricoh, OKI, Dell, Sharp, Panasonic, Olivetti, Konica Minolta.
- `extractPrinterModels` estrae i codici modello con l'espressione
  `\b([A-Z]{1,4}[- ]?\d{2,5}[A-Za-z]{0,4})\b`, escludendo i falsi positivi noti (`A4`, `A3`, `A5`,
  `ISO`, `PDF`).

Esempio: *"Toner compatibile per HP LaserJet Pro M404dn"* → marca `HP`, modello `M404DN`.

Questi dati alimentano i merge tag `{{contact.printerBrand}}` e `{{contact.printerModel}}`, i
filtri `printerBrand` / `printerModel` dei cluster e l'automazione **Coupon Stampante**, che offre
consumabili compatibili con il modello acquistato. L'euristica è imperfetta: nomi prodotto
generici ("Toner nero compatibile 2.600 pagine") non producono alcun modello.
