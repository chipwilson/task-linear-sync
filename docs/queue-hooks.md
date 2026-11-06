# Kolejka tła i hooki (`task-linear-sync queue`)

Dokumentacja operatora funkcji [010](../specs/010-background-queue-sync-hooks/spec.md):
tła synchronizacji (kolejka + worker) oraz zarządzanych hooków git i scaffoldów agenta.
Źródła prawdy: [contracts/queue-protocol.md](../specs/010-background-queue-sync-hooks/contracts/queue-protocol.md),
[contracts/hook-installation.md](../specs/010-background-queue-sync-hooks/contracts/hook-installation.md)
oraz zamrożona mapa kodów wyjścia z [docs/cli.md](cli.md) — w razie rozbieżności wygrywają kontrakty.

## 1. Pojęcia kolejki

- **Zadanie w pojedynczym slocie** (`pending-job.json` w katalogu stanu). W kolejce istnieje
  zawsze co najwyżej jedno zadanie oczekujące: każdy `enqueue` łączy się w ten sam slot — tożsamy
  `jobId` i `enqueuedAt`, najnowszy `mode` (`sync` lub `bootstrap`) wygrywa. Pętla 100
  jednoczesnych `enqueue` kończy się jednym zadaniem (gwarancja SC-001).
- **Reklamacja (claim)** — worker przejmujący zadanie zapisuje w slocie `claim`
  (`workerId`, `pid`, `claimedAt`). Reklamacja starsza niż `worker.claimTimeoutSeconds`
  (zamrożony klucz `worker`, domyślnie **300 s**) jest uznana za porzuconą i może zostać
  przejęta przez innego workera — nigdy „zawieszenie na zawsze".
- **Blokada kolejki** (`queue-lock.json`) — mutex pojedynczego cyklu odpływu (drain). Worker,
  który nie zdobędzie blokady w `queue.lockTimeoutSeconds`, wychodzi z kodem 0 ze statusem
  `stopped` (nigdy odmowa!), nie dotykając zadania ani znacznika ostatniego uruchomienia.
- **Ponowienia** — błąd nadający się do ponowienia zwiększa `retryCount` i zostawia zadanie
  w kolejce; po przekroczeniu `queue.maxRetries` cykl kończy się raportem terminalnym
  (`RETRY_LIMIT`), znacznikiem `last-run.json` o wyniku `failed` i jednym powiadomieniem.
- **Znacznik ostatniego uruchomienia** (`last-run.json`) — zamrożony format 009
  (`runId`, `outcome`, `completedAt`, `reportPaths`, `notificationSuppressed`); para raportów
  ląduje w `reports/<runId>/` wyłącznie w katalogu stanu, nigdy w repozytorium.

## 2. Pięć poleceń i zamrożona mapa kodów wyjścia

| Polecenie | Zachowanie | Kod wyjścia |
|---|---|---|
| `task-linear-sync enqueue [--mode bootstrap\|sync]` | trwały zapis slotu ≤ 500 ms + ciche uruchomienie odłączonego workera; brak danych uwierzytelniających ⇒ ostrzeżenie, zadanie i tak trafia do kolejki | `0` (`enqueued`), `4` przy odrzuconej konfiguracji |
| `task-linear-sync worker --once` | jeden cykl odpływu (drain); pusta kolejka ⇒ cicho bez skutków ubocznych | `0` (`stopped`) |
| `task-linear-sync worker` | pętla pierwszeństwa: natychmiastowy drain → odczekanie `workerDelaySeconds` → drugi drain — do `SIGINT`/`SIGTERM` | `0` (`stopped`) |
| `task-linear-sync last-run [--json]` | odczyt znacznika ostatniego uruchomienia; `found: false` też jest sukcesem | `0` |
| `task-linear-sync install-hooks` | instalacja zarządzanych bloków hooków (patrz §4) | `0` (`installed`), `4` przy odmowie |
| `task-linear-sync install-agent-hook [--framework kiro]` | scaffold hooka agenta (patrz §5), nigdy nie nadpisuje | `0` (`installed`), `4` przy odmowie |

Kolejka nie dodaje żadnych kodów wyjścia — obowiązuje zamrożona mapa 0–8 z `docs/cli.md`
(`0` sukces, `2` błąd użycia, `3` błąd konfiguracji, `4` odmowa bramy/refused, `7`
niedostępna powierzchnia, itd.). Odmowy (`refused`) trafiają wyłącznie na `stderr`.

## 3. Blok konfiguracji `queue`

| Klucz | Zakres | Domyślnie | Znaczenie |
|---|---|---|---|
| `queue.workerDelaySeconds` | 1–3600 | **75** | opóźnienie drugiego (spóźnionego) cyklu workera po cyklu natychmiastowym |
| `queue.lockTimeoutSeconds` | 1–300 | **30** | limit czekania na blokadę kolejki; po przekroczeniu — `stopped` bez zmian w stanie |
| `queue.maxRetries` | 1–100 | **5** | limit ponowień przed raportem terminalnym `RETRY_LIMIT` |
| `queue.notificationsEnabled` | boolean | **true** | powiadomienie o zakończeniu (best-effort); `false` ⇒ wyciszone |
| `queue.autoAcceptLowConfidence` | boolean | **false** | brama `acceptLowConfidence` workera — tło nigdy samo nie akceptuje dopasowań niskopewnych |
| `queue.hookScriptPrefix` | niepusty łańcuch | `binName` | token polecenia w bloku hooka |
| `queue.hooksDirectory` | ścieżka absolutna | brak katalogu repo | nadpisanie katalogu hooków |
| `queue.agentHooksDirectory` | niepusty łańcuch | katalog frameworku | nadpisanie katalogu scaffoldów agenta |

Powiązany zamrożony klucz: `worker.claimTimeoutSeconds` (domyślnie **300**) — próg porzuconej
reklamacji. Priorytet warstw (zamrożony łańcuch 002): wartości wbudowane < plik
`task-linear-sync.json` < nadpisania programowe. Wszystkie nieprawidłowe wartości pola
`queue` trafiają do JEDNEj połączonej linii szczegółów odmowy.

## 4. Zarządzany blok hooka git

`install-hooks` dokleja do każdego hooka z `managedGitHooks` (domyślnie `pre-push`,
`post-merge`) kanoniczny blok ograniczony znacznikami:

```sh
# >>> task-linear-sync managed hooks v1 >>>
"task-linear-sync" last-run 1>&2 || true
"task-linear-sync" enqueue 1>&2 || true
# <<< task-linear-sync managed hooks v1 <<<
```

- Powtórna instalacja jest idempotentna (zero zmienionych bajtów); rozbieżność wewnątrz bloku
  zostaje naprawiona przez ponowne wklejenie, bajty użytkownika przed i po bloku zostają nienaruszone.
- Plik bez shebang (`#!`) nigdy nie jest modyfikowany — reguła ochrony bajtów wygrywa.
- Nieznana nazwa hooka w `managedGitHooks` ⇒ odmowa (kod `4`) z pełną listą błędów i **zerem**
  zapisów pod `.git/hooks`.
- Blok nie zawiera ścieżek katalogu ani maszyny — jest identyczny na każdym stanowisku.
- Odinstalowanie: usunięcie zakresu między znacznikami (operacja odwracalna i uczciwa bajtowo).

## 5. Scaffold hooka agenta

`install-agent-hook` zapisuje scaffold 003 (szablon `kiro-json` ⇒ katalog `.kiro/hooks/`,
plik `task-linear-sync-sync.json`) z addytywnym wzbogaceniem:

```json
{
  "name": "task-linear-sync-sync",
  "action": "command",
  "command": "task-linear-sync enqueue",
  "event": "post-file-save",
  "pathPatterns": ["specs/**/*.md"]
}
```

Kolizje nazw nigdy nie nadpisują istniejącego pliku — powstaje wolna nazwa z przyrostkiem
`-2`, `-3`, …. Nieznany identyfikator frameworku albo framework bez szablonu ⇒ odmowa bez zapisów.

## 6. Rozwiązywanie problemów

- **`pending-job.json` nie odpływa** — sprawdź `queue-lock.json`: `jq .pid` + `kill -0 <pid>`.
  Żywy holder = trwający drain (poczekaj); martwy holder = reklamacja starsza niż
  `worker.claimTimeoutSeconds` zostanie automatycznie przejęta.
- **Dwa procesy `worker` walczą** — to poprawne: blokada kolejki serializuje cykle, a
  przegrany wychodzi `stopped` z kodem `0` (i raportem `queue-lock-failure` dopiero po
  wyczerpaniu `lockTimeoutSeconds`).
- **Brak powiadomienia** — sprawdź `queue.notificationsEnabled` oraz pole
  `notificationSuppressed` w `last-run --json`; w środowisku testowym potwierdza to zrzut
  `TASK_LINEAR_SYNC_TEST_NOTIFY`.
- **Hook milczy** — zweryfikuj, że `queue.hookScriptPrefix` odpowiada nazwie polecenia
  dostępnej w `PATH` w środowisku hooka (patrz §5).
- **Synchronizacja tła raportuje błąd danych uwierzytelniających** — `enqueue` ostrzega, gdy
  `LINEAR_ACCESS_TOKEN` nie jest ustawiony; odłączony worker dziedziczy środowisko procesu
  wywołującego, więc ustaw zmienną przed instalacją hooków lub uruchomieniem workera.
- **Sprzątanie piaskownicy** — patrz quickstart §9.1 (`git worktree remove`, `rm -rf $SANDBOX`);
  odpowiednik automatyczny: `tests/helpers/queue-cleanup.ts`.
