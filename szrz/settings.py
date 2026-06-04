import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.environ.get("SZRZ_DB", ROOT / "data" / "szrz.sqlite"))
SECRET = os.environ.get("SZRZ_SECRET", "dev-only-szrz-secret").encode("utf-8")
TOKEN_TTL_SECONDS = 8 * 60 * 60

CASE_TYPES = {"REKLAMACJA", "ZWROT"}
CHANNELS = {"ONLINE", "EMAIL", "TELEFON", "OSOBISCIE"}
STATUSES = {
    "NOWE",
    "W_TRAKCIE",
    "OCZEKUJE_NA_TOWAR",
    "ROZPATRZONE",
    "ZAMKNIETE",
    "ESKALOWANE",
}
FINAL_STATUSES = {"ROZPATRZONE", "ZAMKNIETE"}
DECISION_TYPES = {
    "NAPRAWA",
    "WYMIANA",
    "ZWROT_GOTOWKI",
    "OBNIZENIE_CENY",
    "ODRZUCENIE",
}
ROLES = {"KLIENT", "PRACOWNIK_OBSLUGI", "KIEROWNIK", "ADMINISTRATOR"}
DEFAULT_CONFIG = {
    "complaintDeadlineDays": 30,
    "returnDeadlineDays": 14,
    "alertThresholdDays": 2,
    "staleEscalationDays": 5,
}
ROLE_RANK = {
    "KLIENT": 0,
    "PRACOWNIK_OBSLUGI": 1,
    "KIEROWNIK": 2,
    "ADMINISTRATOR": 3,
}
