# Raport pokrycia testami wymagań funkcjonalnych

System: obsługa reklamacji i zwrotów  
Data weryfikacji: 2026-06-13  
Komenda uruchomienia: `npm test`  
Wynik: 24/24 testy zakończone powodzeniem

## Krótko o wyniku

Testy potwierdzają, że system obsługuje pełny proces reklamacji i zwrotu: od rejestracji zgłoszenia, przez weryfikację zamówienia, zmianę statusów, powiadomienia, decyzje i raportowanie, aż po kontrolę dostępu dla różnych ról.

Zestaw składa się z dwóch warstw:

- 9 testów domenowych, które sprawdzają reguły biznesowe bez uruchamiania serwera
- 15 testów integracyjnych API, które uruchamiają prawdziwy serwer `server.py` i zapisują dane w tymczasowej bazie SQLite

Dzięki temu testy nie są tylko sprawdzeniem pojedynczych funkcji. One przechodzą przez realne ścieżki systemu: wysyłają żądania HTTP, logują użytkowników, tworzą sprawy, zmieniają statusy, zapisują historię, generują powiadomienia i porównują raporty z danymi w bazie.

## Najważniejszy przekaz do prezentacji

System został przetestowany nie tylko pod kątem tego, czy "coś się zapisuje", ale czy zachowane są reguły procesu:

- nie da się założyć sprawy bez poprawnego zamówienia
- statusy zostawiają historię i generują powiadomienia
- decyzji nie można zmienić po zatwierdzeniu
- terminy generują alerty i eskalacje
- raporty są zgodne z danymi w bazie
- role użytkowników faktycznie ograniczają dostęp do operacji

## Macierz pokrycia FR

| FR | Wymaganie | Co sprawdzają testy | Status |
|---|---|---|---|
| FR-001 | Wielokanałowa rejestracja | Rejestracja przez portal `ONLINE` i przez pracownika kanałem `TELEFON`; zapis kanału i przypisanie pracownika. | Pokryte na poziomie API |
| FR-002 | Weryfikacja uprawnień ERP | Odrzucenie błędnego zamówienia `ORD-404` i akceptacja poprawnego zamówienia przez `/api/orders/verify`. | Pokryte |
| FR-003 | Zarządzanie statusami | Zmiana statusów, historia sprawy oraz pełny cykl zwrotu do `ZAMKNIETE`. | Pokryte na poziomie API |
| FR-004 | Powiadomienia e-mail/SMS | Rekordy powiadomień z kanałem `EMAIL/SMS`, odbiorcą i czasem dostarczenia. | Pokryte jako symulacja systemowa |
| FR-005 | Kontrola terminów | Alert przed terminem i eskalacja po przekroczeniu lub bezczynności. | Pokryte |
| FR-007 | Decyzja i archiwizacja | Wymagane uzasadnienie odmowy, decyzja jako finalna, brak możliwości zmiany, zamknięcie sprawy. | Częściowo pokryte |
| FR-008 | Raporty | Agregacje raportowe oraz porównanie raportu z zapytaniami SQL do bazy dla wybranego okresu. | Pokryte |
| FR-009 | RBAC | Odmowy dostępu dla niższych ról i poprawne uprawnienia administratora. | Pokryte na poziomie API |

## Jak czytać listę testów

Poniższa lista prowadzi przez testy jak przez historię działania systemu. Najpierw sprawdzane są reguły biznesowe, potem prawdziwe endpointy API i baza danych.

Przy każdym teście podano:

- sens testu
- najważniejsze sprawdzane zachowanie
- wymaganie FR, które test wspiera

## Lista testów

1. `ERP validation blocks case creation for an unknown order`  
   Ten test pilnuje podstawowej reguły: reklamacja nie może powstać dla nieistniejącego zamówienia. Próbuje zarejestrować sprawę dla `ORD-404` i oczekuje błędu `ORDER_NOT_FOUND`.  
   W prezentacji warto powiedzieć: system nie przyjmuje zgłoszeń "w ciemno", tylko wymaga potwierdzenia zamówienia.  
   Pokrycie: FR-002.

2. `case numbers are unique and deadlines follow case type configuration`  
   Test tworzy reklamację i zwrot, a następnie sprawdza numery oraz terminy. Reklamacja dostaje numer `REC-...` i termin 30 dni, zwrot dostaje `ZWR-...` i termin 14 dni.  
   To pokazuje, że system rozróżnia typy spraw i automatycznie nadaje im inne reguły obsługi.  
   Pokrycie: FR-001, FR-003, FR-005.

3. `status changes append history and enqueue a notification`  
   Test zmienia status sprawy na `W_TRAKCIE`. Sprawdza, że zmiana nie jest tylko nadpisaniem pola, ale zostawia ślad w historii i tworzy powiadomienie `STATUS`.  
   To ważne, bo w takim systemie każda zmiana statusu musi być audytowalna i widoczna dla klienta lub obsługi.  
   Pokrycie: FR-003, FR-004.

4. `rejected decisions require justification`  
   Test próbuje wydać odmowę bez uzasadnienia. System odpowiada błędem `JUSTIFICATION_REQUIRED`.  
   To zabezpiecza proces przed decyzjami, których nie da się potem obronić ani wyjaśnić klientowi.  
   Pokrycie: FR-007.

5. `approved decisions are immutable`  
   Test wydaje decyzję pozytywną, a potem próbuje ją zmienić. Druga decyzja jest odrzucana błędem `DECISION_IMMUTABLE`.  
   Sens testu: po zatwierdzeniu decyzja staje się finalnym elementem sprawy, a nie edytowalną notatką.  
   Pokrycie: FR-007.

6. `return label starts physical return flow and WMS receipt resumes handling`  
   Test przechodzi przez fizyczny etap zwrotu. Po wygenerowaniu etykiety status zmienia się na `OCZEKUJE_NA_TOWAR`, a po potwierdzeniu odbioru przez WMS wraca do `W_TRAKCIE`.  
   To pokazuje integrację logiki reklamacyjnej z magazynowym etapem obsługi zwrotu.  
   Pokrycie: FR-003, FR-004.

7. `deadline evaluation creates alerts and escalates stale cases`  
   Test sprawdza mechanizm kontroli terminów. Gdy termin się zbliża, system dodaje alert. Gdy sprawa jest zbyt długo bez aktywności, system eskaluje ją, ustawia priorytet `PILNY` i dodaje powiadomienie `ESKALACJA`.  
   W prezentacji można to opisać jako automatyczną ochronę przed przeterminowaniem spraw.  
   Pokrycie: FR-005.

8. `reports aggregate statuses, types, decisions, durations, and reasons`  
   Test tworzy kilka spraw i generuje raport. Sprawdza sumę spraw, procent decyzji pozytywnych i negatywnych, średni czas rozpatrzenia, najczęstsze powody oraz podział po typach i statusach.  
   To potwierdza, że raport nie jest statyczną tabelką, tylko agregacją danych procesu.  
   Pokrycie: FR-008.

9. `admin configuration changes are persisted and audited`  
   Test zmienia konfigurację terminów jako administrator. Sprawdza zapis nowych wartości i wpis `CONFIG_UPDATE` w audycie.  
   Dzięki temu wiadomo, że zmiana konfiguracji nie znika po operacji i zostaje po niej ślad administracyjny.  
   Pokrycie: FR-005, FR-009.

10. `test_bootstrap_returns_seeded_cases_orders_and_config`  
    Test wywołuje `/api/bootstrap` i sprawdza, czy system zwraca dane startowe: zamówienia, sprawy i konfigurację.  
    Ten test potwierdza, że aplikacja ma kompletny stan początkowy potrzebny do pracy i demonstracji.  
    Pokrycie: wspiera stabilność całego scenariusza testowego.

11. `test_login_works_and_protected_endpoint_rejects_without_token`  
    Test najpierw próbuje wejść na `/api/auth/me` bez tokenu i oczekuje odmowy. Następnie loguje pracownika i sprawdza jego e-mail oraz rolę.  
    To podstawowy dowód, że API rozróżnia użytkownika niezalogowanego od zalogowanego pracownika.  
    Pokrycie: FR-009.

12. `test_public_create_case_validates_order_and_persists`  
    Test najpierw próbuje utworzyć sprawę z błędnym zamówieniem, a potem tworzy poprawną reklamację. Sprawdza numer `REC`, status `NOWE` oraz to, że sprawa jest później widoczna na liście spraw.  
    To jest praktyczny test rejestracji: walidacja, zapis i późniejszy odczyt działają razem.  
    Pokrycie: FR-001, FR-002.

13. `test_portal_and_employee_registration_preserve_channels_and_assignment`  
    Test tworzy zgłoszenie publiczne przez `ONLINE` oraz zgłoszenie pracownicze przez `TELEFON`. Sprawdza, że kanał zostaje zapisany, a sprawa utworzona przez pracownika jest przypisana do `Marta Lewandowska`.  
    Ten test najlepiej pokazuje wielokanałowość: klient i pracownik mogą rozpocząć proces inną ścieżką, ale dane trafiają do tego samego systemu.  
    Pokrycie: FR-001.

14. `test_public_status_lookup_works`  
    Test tworzy sprawę i sprawdza jej status po numerze sprawy oraz e-mailu klienta.  
    To odpowiada scenariuszowi, w którym klient chce samodzielnie sprawdzić postęp sprawy bez logowania do panelu pracownika.  
    Pokrycie: FR-003.

15. `test_status_update_writes_history_and_notification`  
    Test loguje pracownika, zmienia status przez API, a potem sprawdza historię i powiadomienia.  
    Najważniejsza wartość testu: potwierdza, że operacja pracownika jest widoczna w danych sprawy i generuje komunikację do klienta.  
    Pokrycie: FR-003, FR-004.

16. `test_full_return_status_cycle_reaches_closed_state`  
    Test przeprowadza zwrot przez pełny cykl: utworzenie, obsługa, etykieta zwrotna, WMS, decyzja i zamknięcie `ZAMKNIETE`. Na końcu sprawdza, czy historia zawiera wszystkie kluczowe statusy.  
    To najbardziej przekrojowy test procesu. Dobrze nadaje się do pokazania, że system obsługuje nie tylko pojedyncze akcje, ale cały przebieg sprawy.  
    Pokrycie: FR-003, częściowo FR-007.

17. `test_status_and_decision_notifications_include_email_sms_delivery_metadata`  
    Test tworzy reklamację, zmienia status i wydaje decyzję. Następnie sprawdza powiadomienia `POTWIERDZENIE`, `STATUS` i `DECYZJA`, ich odbiorcę, kanał `EMAIL/SMS` oraz czas dostarczenia do 60 sekund.  
    Ponieważ aplikacja nie korzysta z realnej bramki SMS ani skrzynki e-mail, test potwierdza model powiadomień zapisany w systemie.  
    Pokrycie: FR-004.

18. `test_rejection_decision_requires_justification_and_decision_is_immutable`  
    Test przez API sprawdza dwie zasady: odmowa wymaga uzasadnienia, a decyzja po zapisaniu nie może zostać zmieniona. Po nieudanej próbie zmiany system nadal zwraca pierwotną decyzję.  
    To mocny test integralności procesu decyzyjnego.  
    Pokrycie: FR-007.

19. `test_return_label_and_wms_receipt_flow`  
    Test tworzy zwrot, generuje etykietę `InPost`, sprawdza numer śledzenia i czeka na etap WMS. Po potwierdzeniu magazynu status wraca do `W_TRAKCIE`, a historia zawiera wpis magazynowy.  
    Ten test pokazuje, że obsługa zwrotu zawiera realny etap logistyczny, a nie tylko zmianę statusu ręcznie.  
    Pokrycie: FR-003, FR-004.

20. `test_deadline_evaluation_creates_alert_and_escalation`  
    Test ustawia konfigurację terminów i uruchamia `/api/deadlines/evaluate`. Najpierw oczekuje alertu, potem eskalacji oraz powiadomień `ALERT` i `ESKALACJA`.  
    To potwierdza, że system aktywnie reaguje na czas, a nie tylko przechowuje daty w bazie.  
    Pokrycie: FR-005.

21. `test_report_aggregation`  
    Test tworzy sprawę z decyzją i pobiera raport jako kierownik. Sprawdza, że raport zawiera liczbę spraw, podział po typach i statusach, procent decyzji pozytywnych oraz najczęstsze powody.  
    Ten test potwierdza, że kierownik dostaje użyteczne dane zarządcze, a nie tylko listę rekordów.  
    Pokrycie: FR-008.

22. `test_report_filters_match_database_counts_for_selected_period`  
    Test pobiera raport dla konkretnego zakresu dat i typu `REKLAMACJA`, a następnie porównuje wynik z bezpośrednimi zapytaniami SQL do bazy. Sprawdza też pusty zakres dat.  
    To jeden z mocniejszych testów raportów, bo nie sprawdza tylko obecności pól, ale zgodność raportu z danymi źródłowymi.  
    Pokrycie: FR-008.

23. `test_rbac_denies_lower_roles_and_allows_admin_operations`  
    Test sprawdza kilka granic uprawnień: klient nie może pobrać listy spraw ani zmienić statusu, pracownik nie może pobrać raportów ani zarządzać użytkownikami, a administrator może wykonać operacje administracyjne.  
    To pokazuje, że role nie są tylko opisem użytkownika, ale faktycznie blokują lub dopuszczają operacje.  
    Pokrycie: FR-009.

24. `test_admin_config_update_and_user_create_toggle_are_audited`  
    Test loguje administratora, zmienia konfigurację, tworzy użytkownika, zmienia jego rolę i dezaktywuje konto. Na końcu sprawdza audyt: `CONFIG_UPDATE`, `USER_CREATE` i `USER_UPDATE`.  
    Ten test zamyka część administracyjną: administrator może zarządzać systemem, a jego działania zostają zapisane.  
    Pokrycie: FR-009 oraz audyt operacji administracyjnych.

## Co ten zestaw testów dobrze udowadnia

Najmocniejsze strony pokrycia:

- proces reklamacji i zwrotu jest testowany od wejścia danych do zapisu w bazie
- najważniejsze reguły biznesowe mają testy negatywne, czyli sprawdzają także odmowę błędnych operacji
- raporty są sprawdzane nie tylko "po polach", ale także przez porównanie z bazą danych
- RBAC jest testowany przez realne role i realne endpointy API
- zmiany statusów, decyzje, terminy i audyt tworzą historię, którą da się zweryfikować

## Ograniczenia pokrycia

Nie ma testu prawdziwego wysłania e-maila ani SMS-a, ponieważ aplikacja nie integruje się z realną skrzynką pocztową ani zewnętrzną bramką SMS. Obecnie testowany jest systemowy model powiadomień: odbiorca, kanał `EMAIL/SMS`, typ wiadomości i czas dostarczenia.

Nie ma osobnej funkcji archiwizacji jako endpointu `archive`. Najbliższe istniejące zachowanie to zamknięcie sprawy statusem `ZAMKNIETE` po wydaniu decyzji oraz niemodyfikowalność decyzji.

Nie ma pełnych testów E2E interfejsu użytkownika w przeglądarce. Aktualne testy FR-001, FR-003 i FR-009 są testami integracyjnymi API, więc weryfikują zachowanie systemu pod formularzami i ekranami, ale nie klikają fizycznie w UI.

## Podsumowanie końcowe

Testy obejmują nie tylko pojedyncze funkcje, ale cały proces obsługi reklamacji i zwrotów. System odrzuca błędne zamówienia, prowadzi sprawę przez kolejne statusy, zapisuje historię działań, generuje powiadomienia, pilnuje terminów, blokuje zmianę finalnej decyzji, tworzy raporty zgodne z danymi w bazie i egzekwuje role użytkowników.

Najważniejsze ograniczenia pokrycia dotyczą integracji z zewnętrznymi usługami, takimi jak realna bramka SMS lub skrzynka e-mail, oraz osobnej funkcji archiwizacji, której aplikacja nie udostępnia jako oddzielnego endpointu.

## Wniosek

Obecny zestaw testów automatycznie weryfikuje wymagania FR-001, FR-002, FR-003, FR-005, FR-008 i FR-009 na poziomie domeny lub API. FR-004 jest pokryte jako symulacja powiadomień w systemie, a FR-007 jest pokryte w zakresie decyzji, niemodyfikowalności i zamknięcia sprawy, ale bez osobnej funkcji archiwizacji.
