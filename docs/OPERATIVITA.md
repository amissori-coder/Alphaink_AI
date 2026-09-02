# Operatività quotidiana

Guida pratica all'uso della AlphaInk Newsletter Suite: come si crea e si spedisce una newsletter,
come si gestiscono i cluster, come si leggono le analytics, cosa fare quando qualcosa non va e
quanto costa tenerla in piedi.

---

## 1. Creare e pianificare una newsletter

### 1.1 Il percorso completo

```
Nuova → Contenuto → Pubblico → Prova → Pianificazione → Invio → Report
```

**1. Crea.** *Newsletter → Nuova*. Scegli un template di partenza (i cinque di sistema, oppure uno
tuo) o parti da un documento vuoto. Compila **nome interno** (per te), **oggetto** e **preheader**.

- L'oggetto è il fattore che pesa di più sul tasso di apertura: entro 50 caratteri, concreto, senza
  MAIUSCOLE e senza catene di punti esclamativi.
- Il preheader è la riga di anteprima dopo l'oggetto. Non lasciarlo vuoto: il client mostrerebbe
  le prime parole del corpo, che di solito sono "Visualizza nel browser".

**2. Costruisci il contenuto.** L'editor a blocchi funziona a trascinamento. Sedici tipi di blocco:
testo, titolo, immagine, pulsante, prodotto, griglia prodotti, coupon, countdown, separatore,
spazio, social, video, menu, HTML personalizzato, footer, disiscrizione.

- Il **documento** è la fonte di verità; l'HTML viene rigenerato a ogni salvataggio dal trigger
  `onNewsletterWritten`.
- Usa i **merge tag** dal menu dedicato (`{{contact.firstName}}`, `{{coupon.code}}`,
  `{{system.unsubscribeUrl}}`, …). L'anteprima mostra i valori di ripiego; l'invio li risolve per
  ogni destinatario.
- Tieni almeno il **60% di testo** rispetto alle immagini: un'email fatta di una sola immagine è un
  classico segnale di spam e non si vede con le immagini bloccate.
- Il blocco **disiscrizione** deve esserci sempre. È un obbligo di legge e un fattore di
  reputazione.
- Oltre ~102 KB Gmail tronca il messaggio e mostra "Visualizza messaggio completo": l'editor
  segnala quando ti stai avvicinando alla soglia.

**3. Scegli il pubblico.** Nella scheda *Destinatari*:

| Campo | Effetto |
| --- | --- |
| Cluster inclusi | Unione dei contatti |
| Cluster esclusi | Sottratti **dopo** l'unione |
| Contatti singoli inclusi / esclusi | Aggiunte e rimozioni puntuali |
| Sopprimi se contattato negli ultimi N giorni | Evita di scrivere troppo spesso alla stessa persona |
| Sopprimi se ha acquistato negli ultimi N giorni | Evita di promuovere a chi ha appena comprato |

Il pulsante di stima invoca `estimateAudience` e restituisce tre numeri: **totale** (chi soddisfa i
criteri), **contattabile** (chi è effettivamente iscritto e non soppresso) e **soppressi**. È il
secondo il numero che conta.

**4. Manda una prova.** *Invia prova*, fino a 10 indirizzi. Puoi indicare un **contatto campione**:
i merge tag verranno risolti con i suoi dati veri, così vedi come appare a un cliente reale.

Controlla, sulla prova:

- [ ] oggetto e preheader come li vuoi nella casella di posta;
- [ ] tutte le immagini caricano;
- [ ] i link portano dove devono, **passando dal redirector**;
- [ ] il link di disiscrizione apre la pagina corretta;
- [ ] resa su mobile (la maggioranza delle aperture);
- [ ] resa in Outlook, che è sempre il client più problematico;
- [ ] merge tag tutti risolti — nessun `{{...}}` visibile.

Gli invii di prova **non** entrano nelle statistiche: il riferimento `t:<newsletterId>` li esclude.

**5. Pianifica.** *Pianifica* apre il selettore di data e ora, nel fuso `Europe/Rome`.

Opzioni:

| Opzione | Quando serve |
| --- | --- |
| **Scaglionamento** (`throttle`) | Su liste grandi: distribuisce l'invio in batch a intervalli, invece di un unico picco. Aiuta la reputazione e distribuisce il traffico sul sito |
| **Fascia di silenzio** | Impedisce l'invio fuori orario anche se la pianificazione dovesse slittare |
| **Ottimizzazione oraria** | Invia nell'ora in cui ciascun contatto apre di più |

Se vuoi partire subito, *Invia ora* salta la pianificazione.

**6. Cosa succede dopo.** Ogni 5 minuti `scheduledNewsletterDispatcher`:

1. prende le newsletter `scheduled` la cui ora è passata;
2. risolve il pubblico e scrive un documento per destinatario;
3. accoda i batch da 500 in `sendQueue`;
4. porta la newsletter in `sending`;
5. lavora i batch dovuti, spedendo via Brevo.

Una newsletter programmata per "adesso" parte nello stesso giro: la preparazione precede la
spedizione apposta.

### 1.2 Stati e transizioni

```
draft ──▶ scheduled ──▶ queued ──▶ sending ──▶ sent
  │           │            │          │
  │           └─────┬──────┘          │
  ▼                 ▼                 ▼
cancelled        paused ◀─────────────┘
                    │
                    └──▶ (ripresa)
```

| Stato | Significato | Cosa puoi fare |
| --- | --- | --- |
| `draft` | Bozza | Modificare tutto, pianificare, inviare subito, eliminare |
| `scheduled` | Pianificata | Annullare la pianificazione, mettere in pausa, modificare |
| `queued` | Coda preparata | Mettere in pausa, annullare |
| `sending` | Invio in corso | **Solo** mettere in pausa o annullare — il contenuto non è più modificabile |
| `sent` | Completata | Nulla: è uno stato terminale. Puoi duplicarla |
| `paused` | Sospesa | Riprendere, riportare a bozza, annullare |
| `failed` | Fallita | Riportare a bozza, ripianificare, annullare |
| `cancelled` | Annullata | Riportare a bozza |

Due regole imposte dalle regole di sicurezza, non solo dalla UI:

- una newsletter in `sending` o `queued` **non è modificabile** da nessun client: si fermerebbe a
  metà spedizione;
- **nessun client** può portare una newsletter a `sending`, `queued` o `sent`: quella transizione
  appartiene al dispatcher.

Le transizioni avvengono **dentro una transazione Firestore**: due dispatcher concorrenti non
possono portare la stessa newsletter in `sending` due volte.

### 1.3 Calendario editoriale

*Calendario* mostra gli invii in vista mese, settimana o agenda. Puoi:

- **trascinare** una newsletter su un altro giorno per riprogrammarla;
- filtrare per stato, categoria o etichetta;
- creare una nuova newsletter direttamente da un giorno;
- vedere in un pannello laterale le automazioni attive.

Compaiono nel calendario gli stati in `CALENDAR_STATUSES`: `scheduled`, `queued`, `sending`,
`sent`, `paused`, `failed`. Ogni stato ha il suo colore.

Usa la **categoria editoriale** (promozione, novità, saldi, informativa, stagionale, B2B) per
tenere l'equilibrio del piano: se in un mese ci sono solo promozioni, la lista si stanca.

---

## 2. Gestire i cluster

### 2.1 I quattro tipi

| Tipo | Come si definisce | Quando usarlo |
| --- | --- | --- |
| **Dinamico** | Albero di regole AND/OR | Nella grande maggioranza dei casi. Si aggiorna da solo |
| **Statico** | Elenco fisso di contatti | Liste curate a mano: partecipanti a un evento, clienti chiave |
| **Gruppo del sito** | Nome di un gruppo cliente PrestaShop | Rispecchiare la segmentazione già esistente sul negozio |
| **Lista Brevo** | Id di una lista Brevo | Liste create direttamente su Brevo |

### 2.2 Costruire un cluster dinamico

*Cluster → Nuovo*, poi il costruttore di regole. I campi filtrabili coprono tre aree:

| Area | Campi |
| --- | --- |
| Anagrafica | email, nome, cognome, azienda, P.IVA, paese, provincia, città, CAP, lingua, segmento, gruppo cliente, sorgente, stato, etichette |
| Commerciale | numero ordini, totale speso, valore medio, primo/ultimo ordine, giorni medi fra ordini, famiglia acquistata, SKU acquistato, marca acquistata, marca e modello stampante |
| Engagement | punteggio, fascia, aperte, cliccate, ultima apertura, ultimo click, inviate, consegnate |

Operatori disponibili: uguale, diverso, maggiore/minore (anche o uguale), contiene, non contiene,
inizia con, finisce con, è uno di, non è fra, è vuoto, non è vuoto, **negli ultimi N giorni**,
**da più di N giorni**, **compreso fra**.

I gruppi si annidano e possono essere negati: `(A AND B) OR NOT (C)` è esprimibile.

**Prova sempre prima di salvare.** Il pulsante di anteprima mostra quanti contatti soddisfano le
regole, quanti sono contattabili e un campione di indirizzi. Un cluster che restituisce zero o
l'intera lista ha quasi sempre una regola sbagliata.

### 2.3 Cluster utili da avere

| Nome | Regole | A cosa serve |
| --- | --- | --- |
| Clienti attivi | `engagement.engagementTier è uno di [hot, warm]` | Campagne di riscaldamento, primi invii dopo una pausa |
| Mai aperto | `engagement.delivered > 5` **AND** `engagement.opened = 0` | Da escludere, o da riattivare con il win-back |
| Alto valore B2C | `segment = b2c` **AND** `stats.totalSpent > 500` | Offerte dedicate |
| Rivenditori | `segment = b2b` | Da **escludere** dalle promozioni al pubblico |
| Acquirenti toner | `purchasedFamily = toner` **AND** `stats.lastOrderAt negli ultimi 180 giorni` | Campagne di categoria |
| Possessori HP | `printerBrand = HP` | Promozioni su consumabili compatibili |
| Nuovi del mese | `createdAt negli ultimi 30 giorni` | Comunicazione di benvenuto editoriale |
| Dormienti | `stats.lastOrderAt da più di 180 giorni` | Pubblico del win-back |

### 2.4 Ricalcolo

I cluster dinamici con `autoRefresh` attivo vengono ricalcolati da `scheduledClusterRefresh` ogni
**6 ore**, partendo da quelli non aggiornati da più tempo. Puoi forzare il ricalcolo di uno
specifico cluster dalla sua scheda (`recomputeCluster`).

L'appartenenza calcolata viene **materializzata** su `contacts.dynamicClusterIds`: così la query
"chi è nel cluster X" costa un solo `array-contains` invece di una nuova scansione completa. È il
motivo per cui il conteggio mostrato può essere vecchio di qualche ora: se hai appena importato
migliaia di contatti, forza il ricalcolo prima di usare il cluster come pubblico.

### 2.5 Sincronizzazione verso Brevo

Con `syncToBrevo` attivo, il cluster viene rispecchiato in una lista Brevo. Serve solo se vuoi
usare quella lista dalla dashboard Brevo: l'invio dall'applicazione **non** ne ha bisogno, perché
usa il canale transazionale.

---

## 3. Contatti

### 3.1 Da dove arrivano

| Sorgente | Come |
| --- | --- |
| `prestashop_b2c` / `prestashop_b2b` | Sincronizzazione oraria o webhook del sito |
| `csv` | Import manuale |
| `manual` | Creati a mano dalla UI |
| `brevo` | Importati da una lista Brevo |

Un cliente presente su entrambi i negozi resta **un solo** contatto: la deduplica è sull'email
normalizzata.

### 3.2 Import CSV

*Contatti → Importa*. Il file deve avere un'intestazione; le colonne si mappano nella procedura
guidata.

Regole applicate:

- gli indirizzi non validi vengono scartati con il motivo;
- i **domini usa e getta** vengono segnalati;
- un contatto già esistente viene **aggiornato**, non duplicato;
- **un contatto disiscritto resta disiscritto**, anche se il CSV dice il contrario. Non è
  aggirabile: è un requisito legale prima ancora che tecnico.

Prima di importare, chiediti da dove viene la lista. Una lista acquistata o raccolta senza consenso
esplicito è il modo più rapido per bruciare la reputazione del dominio.

### 3.3 Export

*Contatti → Esporta*, oppure `POST /api/export/contacts` con il token di sessione. Filtri
disponibili: cluster, stato, segmento, sorgente, solo contattabili, limite.

Richiede il permesso `contacts:export` (da `analyst` in su). Il file finisce in `exports/` su Cloud
Storage, leggibile solo da `owner`, `admin` e `analyst`.

### 3.4 La scheda contatto

Anagrafica, statistiche commerciali, engagement con punteggio e fascia, stampanti possedute,
cronologia ordini, cronologia email inviate, cronologia eventi, appartenenza ai cluster.

La **cronologia eventi** è lo strumento di diagnosi più utile: quando un cliente segnala di non
ricevere le email, mostra se sono state consegnate, se hanno fatto bounce, se il contatto si è
disiscritto e quando.

---

## 4. Leggere le analytics

### 4.1 Ritmo di lettura consigliato

| Quando | Cosa guardare |
| --- | --- |
| **Ogni giorno** (2 minuti) | Dashboard: invii falliti, bounce anomali, stato della sincronizzazione |
| **Dopo ogni invio** (24-48 ore dopo) | Report della newsletter: imbuto, link più cliccati, fatturato |
| **Ogni settimana** | Automazioni: arruolati, inviati, annullati, fatturato per step |
| **Ogni mese** | Andamento, salute della lista, crescita netta, quota di fatturato email |

Non leggere il report di una newsletter nell'ora successiva all'invio: gli eventi Brevo arrivano in
modo asincrono e i numeri sono ancora parziali. Le prime 24 ore raccolgono la grande maggioranza
delle aperture; 48 ore sono la finestra completa.

### 4.2 Le metriche che contano davvero

Delle molte disponibili, tre bastano per la gran parte delle decisioni:

1. **Tasso di click.** Misura se il contenuto interessa. Non è inquinato dai proxy immagini.
2. **Fatturato attribuito per destinatario.** Dice se la campagna ripaga il costo di invio e il
   consumo di attenzione della lista.
3. **Disiscrizioni + segnalazioni spam.** Il costo nascosto: ogni campagna consuma una parte della
   lista. Se il costo supera il ritorno, la frequenza è troppo alta.

Le soglie di riferimento sono in [`TRACKING.md`](TRACKING.md), §9.4.

### 4.3 Confronti

La sezione di confronto permette di mettere a fianco due newsletter o due periodi. Usala per
rispondere a domande precise:

- *Meglio oggetto A o oggetto B?* → confronta due campagne simili con oggetti diversi.
- *Meglio martedì o giovedì?* → confronta due invii dello stesso tipo in giorni diversi.
- *La segmentazione paga?* → confronta un invio a tutta la lista con uno a un cluster mirato,
  guardando il fatturato **per destinatario**, non quello assoluto.

Cambia **una cosa alla volta**: se cambi oggetto, giorno e pubblico insieme, il confronto non dice
nulla.

---

## 5. Se un invio fallisce

### 5.1 Diagnosi rapida

```
La newsletter è in "failed"?
├── SÌ  → leggi failureReason nella scheda della newsletter
└── NO, è ferma in "sending"
    ├── Ci sono batch in sendQueue con status "failed"?
    │   ├── SÌ  → guarda il campo error del batch
    │   └── NO  → guarda se i batch sono "pending" con runAt nel futuro
    │             (scaglionamento: è normale, sta aspettando)
    └── firebase functions:log --only scheduledNewsletterDispatcher
```

### 5.2 Cause più frequenti

| Errore | Causa | Rimedio |
| --- | --- | --- |
| `Chiave API Brevo non configurata` | Secret assente o non ancora in servizio | `firebase functions:secrets:set BREVO_API_KEY`, poi attendi il ricambio delle istanze |
| `401` da Brevo | Chiave revocata o scaduta | Rigenera su Brevo e aggiorna il secret |
| `400` sul mittente | Mittente non verificato | Verifica il mittente su Brevo ([`BREVO.md`](BREVO.md), §3) |
| `429` ripetuti | Rate limit Brevo | I batch vengono riprovati da soli. Se persiste, abbassa `maxInstances` |
| `Crediti esauriti` | Piano Brevo terminato | Ricarica; i batch rimasti riprendono |
| `Nessun destinatario contattabile` | Cluster vuoto o tutti soppressi | Ricalcola il cluster, controlla le soppressioni |
| Batch fermi in `processing` | Istanza terminata durante il lavoro | Dopo 15 minuti il claim scade e il batch viene ripreso |
| `failed` dopo 3 tentativi | Errore persistente | Risolvi la causa, riporta la newsletter a `draft` e ripianifica |

### 5.3 Il meccanismo di recupero automatico

Molto spesso non serve fare nulla:

- un batch fallito viene **riprovato fino a 3 volte**, con 15 minuti di attesa fra i tentativi;
- un batch preso in carico da un'istanza morta viene **liberato dopo 15 minuti** e ripreso;
- un destinatario già in stato diverso da `pending` **non viene mai ri-spedito**, nemmeno se il
  batch viene rielaborato: non c'è rischio di doppioni;
- la preparazione della coda avviene **una sola volta** (marcatore `queue.preparedAt`).

Aspetta un paio di cicli del dispatcher (10 minuti) prima di intervenire a mano.

### 5.4 Fermare un invio in corso

*Metti in pausa* porta la newsletter in `paused` e i batch non ancora lavorati non partono. Quelli
già spediti sono spediti: non si torna indietro.

*Riprendi* rimette in coda i batch rimasti.

Se devi fermare **subito** perché il contenuto è sbagliato, metti in pausa immediatamente: ogni
ciclo di 5 minuti spedisce fino a 8 batch, cioè fino a 4.000 destinatari.

### 5.5 Automazioni che non partono

| Sintomo | Verifica |
| --- | --- |
| Nessuna run creata | L'automazione è **attiva**? Nascono tutte spente |
| Run create ma tutte `skipped` | La **modalità test** è attiva senza indirizzi configurati? |
| Run create ma tutte `cancelled` | Leggi `cancelledReason`: cooldown, tetto annuale, contatto non contattabile, condizione di annullamento |
| Nessun contatto arruolato nei riacquisti | `stats.nextPurchaseDueAt` è valorizzato? Dipende dalla classificazione per famiglia degli ordini |
| Run `failed` | Leggi `error`: quasi sempre coupon non emesso o mittente rifiutato |

Il registro attività (`activityLog`, visibile ad `admin`+) riassume ogni corsa degli scanner e del
dispatcher con i numeri di arruolati, inviati e saltati.

---

## 6. Riconciliazione delle statistiche

### 6.1 Cosa gira da solo

| Job | Cadenza | Cosa fa |
| --- | --- | --- |
| `scheduledStatsReconcile` | ogni ora | Riprende gli eventi `processed: false` e **ricalcola da zero** le statistiche delle newsletter spedite nelle ultime 48 ore |
| `scheduledDailyMetrics` | ogni notte 02:00 | Consolida gli eventi del giorno in `metricsDaily/{YYYY-MM-DD}` |

La riconciliazione ricalcola dagli eventi grezzi invece di correggere i contatori: è l'unico modo
per uscire da uno stato incoerente causato da un'istanza terminata a metà transazione.

### 6.2 Quando i numeri non tornano

| Divergenza | Spiegazione |
| --- | --- |
| Statistiche più basse di Brevo, subito dopo l'invio | Normale: gli eventi arrivano in modo asincrono. Ricontrolla dopo un'ora |
| Aperture più basse di Brevo, stabilmente | Normale: escludiamo le aperture proxy, Brevo no |
| Click leggermente diversi da Brevo | Normale: due sistemi di tracciamento con euristiche diverse |
| Consegne diverse da Brevo | **Non normale**: le consegne dovrebbero coincidere. Controlla che il webhook `delivered` sia registrato |
| Statistiche ferme da ore | Webhook non funzionante, o molti eventi `processed: false` |

Query di controllo dalla console Firestore:

```
Collezione: events
Filtro:     processed == false
Ordina per: receivedAt crescente
```

Se ci sono centinaia di eventi non elaborati e la coda non si smaltisce, i log di
`scheduledStatsReconcile` dicono perché.

### 6.3 Limite della riconciliazione

La finestra è di **48 ore**. Un evento che arrivasse più tardi (raro, ma possibile con i bounce
differiti) non viene ripreso automaticamente: la statistica resta leggermente incompleta.

---

## 7. Monitoraggio dei log

### 7.1 Riga di comando

```bash
# Ultimi log di tutte le funzioni
firebase functions:log

# Una funzione specifica
firebase functions:log --only scheduledNewsletterDispatcher
firebase functions:log --only brevoWebhook
firebase functions:log --only scheduledSiteSync
firebase functions:log --only scheduledAutomationDispatcher

# Ultime N righe
firebase functions:log --lines 200
```

### 7.2 Console Google Cloud

Per ricerche serie, <https://console.cloud.google.com/logs>. Query utili:

```
resource.type="cloud_run_revision"
severity>=ERROR
timestamp>="2026-09-01T00:00:00Z"
```

```
resource.type="cloud_run_revision"
resource.labels.service_name="scheduledsitesync"
jsonPayload.module="sync.orchestrator"
```

Tutti i log applicativi portano il campo `module` (`sync.orchestrator`, `brevo.client`,
`tracking.processor`, `automations.dispatcher`, …): è il filtro più efficace.

### 7.3 Registro attività dell'applicazione

`activityLog` registra le operazioni significative in italiano — chi ha fatto cosa, quando, con che
esito — ed è consultabile dalla UI da `admin` in su. È il punto di partenza quando la domanda è
"chi ha modificato questa automazione?" o "perché ieri sera è partito un invio?".

### 7.4 Cosa vale la pena tenere d'occhio

| Segnale | Dove | Soglia di attenzione |
| --- | --- | --- |
| Errori nelle funzioni programmate | Cloud Logging, `severity>=ERROR` | Uno qualsiasi, ricorrente |
| Job di sincronizzazione `failed` | Dashboard → Stato sincronizzazione | Due consecutivi |
| Eventi non elaborati | `events` con `processed == false` | Più di qualche centinaio stabilmente |
| Batch `failed` | `sendQueue` | Uno qualsiasi |
| Run di automazione `failed` | Scheda dell'automazione | Più del 5% |
| Tasso di bounce | Dashboard → Salute della lista | Oltre il 2% |
| Segnalazioni spam | Dashboard → Salute della lista | Oltre lo 0,1% |
| Crediti Brevo | Impostazioni → Brevo | Sotto il fabbisogno del mese |

Un controllo settimanale di dieci minuti su questa lista intercetta praticamente tutti i problemi
prima che diventino visibili ai clienti.

---

## 8. Manutenzione periodica

### Settimanale

- [ ] Dashboard: nessun errore, sincronizzazioni riuscite su entrambi i negozi
- [ ] Report delle newsletter inviate nella settimana
- [ ] Automazioni: run fallite e motivi degli annullamenti
- [ ] Crediti Brevo sufficienti per la settimana successiva

### Mensile

- [ ] Salute della lista: bounce, disiscrizioni, segnalazioni
- [ ] Crescita netta dei contatti (nuovi meno disiscritti)
- [ ] Distribuzione delle fasce di engagement: se i `dormant` crescono, la frequenza è troppo alta
- [ ] Coupon emessi e non riscattati: l'offerta è interessante?
- [ ] Ordini classificati come `altro`: le regole delle famiglie vanno affinate?
- [ ] Un invio di prova completo, con verifica dei link e della disiscrizione

### Trimestrale

- [ ] Rivedere i cicli di riacquisto sui dati reali (`averageDaysBetweenOrders`)
- [ ] Rivedere i testi delle automazioni
- [ ] Controllare che SPF, DKIM e DMARC siano ancora validi
- [ ] Rivedere ruoli e utenti: chi non lavora più al progetto va disabilitato
- [ ] `firebase functions:secrets:prune` per eliminare le versioni non più referenziate
- [ ] Rieseguire `seedDefaults` dopo un aggiornamento dell'applicazione, per far comparire le
      impostazioni nuove

---

## 9. Costi indicativi

Stime di ordine di grandezza per un'installazione AlphaInk, con listini pubblici del 2026. Servono
a capire dove stanno i costi, non come preventivo.

### 9.1 Brevo

Il costo dominante, e cresce con il volume di **email inviate**, non con la dimensione della lista.

| Volume mensile | Piano tipico | Ordine di grandezza |
| --- | --- | --- |
| Fino a 5.000 email | Gratuito (con limite giornaliero) | 0 € |
| 20.000 email | Starter | 20-30 €/mese |
| 100.000 email | Business | 60-90 €/mese |
| 300.000+ email | Business / Enterprise | 150-300 €/mese |

**Come si calcola il fabbisogno.** Newsletter: numero di invii al mese × destinatari contattabili.
Automazioni: molto meno di quanto si pensi, perché ogni email è mirata. Su una lista di 20.000
contatti, due newsletter al mese fanno 40.000 email; le sei automazioni insieme raramente superano
qualche migliaio.

Il modo più efficace per contenere il costo è **segmentare**: mandare a 5.000 contatti mirati
costa un quarto rispetto a 20.000 indiscriminati, e di solito rende di più in valore assoluto.

### 9.2 Firebase (piano Blaze)

| Servizio | Cosa si paga | Ordine di grandezza |
| --- | --- | --- |
| **Firestore** | Letture, scritture, eliminazioni, spazio | Qualche euro/mese sotto i 100.000 contatti. Le letture sono la voce principale |
| **Cloud Functions** | Invocazioni, GB-secondo, GHz-secondo, rete in uscita | 5-20 €/mese. Le funzioni programmate girano comunque, anche a vuoto |
| **Cloud Storage** | Spazio e traffico in uscita | Pochi euro. Le immagini delle email sono scaricate da ogni destinatario: è la voce che cresce con i volumi |
| **Hosting / App Hosting** | Traffico e istanze | Trascurabile per una web app interna |
| **Secret Manager** | Versioni attive e accessi | Centesimi |
| **Cloud Scheduler** | Job | I primi 3 job/mese sono gratuiti, poi ~0,10 $/job |

Totale realistico per AlphaInk: **10-40 €/mese** su Firebase, contro i **50-200 €/mese** di Brevo.

### 9.3 Dove si nascondono i costi imprevisti

| Voce | Perché sorprende | Come contenerla |
| --- | --- | --- |
| **Letture Firestore** | Un cluster dinamico su una lista grande legge molti documenti a ogni ricalcolo, ogni 6 ore | Disattiva `autoRefresh` sui cluster che non usi. Sono i cluster inutilizzati a costare, non quelli che usi |
| **Traffico immagini** | Ogni destinatario scarica ogni immagine | Comprimi prima di caricare. Un'immagine da 500 KB × 20.000 destinatari sono 10 GB per invio |
| **Backfill di sincronizzazione** | Una risincronizzazione completa scrive centinaia di migliaia di documenti | Fallo una volta sola, in modalità MySQL, poi affidati all'incrementale |
| **Eventi di tracciamento** | Un documento per evento; una newsletter a 20.000 destinatari ne genera decine di migliaia | I documenti non vengono eliminati: valuta una policy di conservazione se lo spazio cresce |
| **Cold start** | Ogni funzione carica tutti i moduli | Comportamento standard di Firebase, accettabile qui perché i moduli sono di sola definizione |

### 9.4 Regole pratiche

1. **Il costo per email inviata è ciò che conta.** Se una campagna a 20.000 persone genera meno
   fatturato di una a 5.000 mirati, la seconda è migliore su ogni fronte: costo, reputazione,
   consumo della lista.
2. **Le automazioni sono il miglior rapporto valore/costo dell'intero sistema.** Poche migliaia di
   email l'anno, con tassi di conversione multipli rispetto alle newsletter, perché arrivano quando
   il cliente sta già pensando a quel prodotto.
3. **Ripulire la lista fa risparmiare due volte**: meno email inviate, e migliore reputazione —
   quindi migliore recapito su quelle che invii davvero.

---

## 10. Riferimenti rapidi

| Domanda | Documento |
| --- | --- |
| Come si installa da zero? | [`SETUP.md`](SETUP.md) |
| Come si configura Brevo? | [`BREVO.md`](BREVO.md) |
| Come si collega PrestaShop? | [`INTEGRAZIONE-SITO.md`](INTEGRAZIONE-SITO.md) |
| Come funzionano le automazioni? Cos'è "1440"? | [`AUTOMAZIONI.md`](AUTOMAZIONI.md) |
| Quali dati ci sono e chi può leggerli? | [`MODELLO-DATI.md`](MODELLO-DATI.md) |
| Perché i numeri sono quelli che sono? | [`TRACKING.md`](TRACKING.md) |
| Come è fatto il sistema? | [`ARCHITETTURA.md`](ARCHITETTURA.md) |
