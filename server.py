#!/usr/bin/env python3
import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import sys
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse


ROOT = Path(__file__).resolve().parent
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


class ApiError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    with connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                role TEXT NOT NULL,
                active INTEGER NOT NULL DEFAULT 1,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS orders (
                number TEXT PRIMARY KEY,
                customer_name TEXT NOT NULL,
                email TEXT NOT NULL,
                phone TEXT,
                product TEXT NOT NULL,
                category TEXT NOT NULL,
                purchased_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS cases (
                id TEXT PRIMARY KEY,
                number TEXT NOT NULL UNIQUE,
                type TEXT NOT NULL,
                channel TEXT NOT NULL,
                status TEXT NOT NULL,
                priority TEXT NOT NULL,
                order_number TEXT NOT NULL,
                customer_name TEXT NOT NULL,
                email TEXT NOT NULL,
                phone TEXT,
                product TEXT NOT NULL,
                category TEXT NOT NULL,
                description TEXT NOT NULL,
                reason TEXT NOT NULL,
                attachments_json TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                deadline_at TEXT NOT NULL,
                assigned_to TEXT,
                FOREIGN KEY(order_number) REFERENCES orders(number)
            );

            CREATE TABLE IF NOT EXISTS status_history (
                id TEXT PRIMARY KEY,
                case_id TEXT NOT NULL,
                status TEXT NOT NULL,
                actor TEXT NOT NULL,
                role TEXT NOT NULL,
                comment TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS decisions (
                id TEXT PRIMARY KEY,
                case_id TEXT NOT NULL UNIQUE,
                type TEXT NOT NULL,
                justification TEXT,
                author TEXT NOT NULL,
                created_at TEXT NOT NULL,
                final INTEGER NOT NULL DEFAULT 1,
                FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS return_shipments (
                id TEXT PRIMARY KEY,
                case_id TEXT NOT NULL UNIQUE,
                courier TEXT NOT NULL,
                tracking_number TEXT NOT NULL,
                format TEXT NOT NULL DEFAULT 'PDF',
                generated_at TEXT NOT NULL,
                received_condition TEXT,
                received_at TEXT,
                FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS escalations (
                id TEXT PRIMARY KEY,
                case_id TEXT NOT NULL,
                reason TEXT NOT NULL,
                author TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS notifications (
                id TEXT PRIMARY KEY,
                case_id TEXT,
                case_number TEXT,
                type TEXT NOT NULL,
                recipient TEXT NOT NULL,
                body TEXT NOT NULL,
                channel TEXT NOT NULL,
                created_at TEXT NOT NULL,
                delivered_within_seconds INTEGER NOT NULL DEFAULT 60,
                FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS audit_log (
                id TEXT PRIMARY KEY,
                actor TEXT NOT NULL,
                action TEXT NOT NULL,
                details TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            """
        )
        if table_empty(conn, "users"):
            seed_demo(conn)


def table_empty(conn, table):
    return conn.execute(f"SELECT COUNT(*) AS count FROM {table}").fetchone()["count"] == 0


def reset_demo(conn):
    conn.executescript(
        """
        DELETE FROM audit_log;
        DELETE FROM notifications;
        DELETE FROM escalations;
        DELETE FROM return_shipments;
        DELETE FROM decisions;
        DELETE FROM status_history;
        DELETE FROM cases;
        DELETE FROM orders;
        DELETE FROM users;
        DELETE FROM config;
        """
    )
    seed_demo(conn)


def seed_demo(conn):
    today = today_iso()
    for key, value in DEFAULT_CONFIG.items():
        conn.execute("INSERT INTO config(key, value) VALUES (?, ?)", (key, str(value)))

    demo_users = [
        ("usr-client", "Jan Kowalski", "client@example.com", "KLIENT", "demo123"),
        (
            "usr-employee",
            "Marta Lewandowska",
            "marta.ops@example.com",
            "PRACOWNIK_OBSLUGI",
            "demo123",
        ),
        ("usr-manager", "Tomasz Krol", "tomasz.manager@example.com", "KIEROWNIK", "demo123"),
        ("usr-admin", "Ewa Admin", "ewa.admin@example.com", "ADMINISTRATOR", "demo123"),
    ]
    for user_id, name, email, role, password in demo_users:
        conn.execute(
            """
            INSERT INTO users(id, name, email, role, active, password_hash, created_at)
            VALUES (?, ?, ?, ?, 1, ?, ?)
            """,
            (user_id, name, email, role, hash_password(password), today),
        )

    orders = [
        (
            "ORD-2026-1001",
            "Jan Kowalski",
            "jan.kowalski@example.com",
            "+48123123123",
            "Laptop Orion 14",
            "Laptopy",
            "2026-05-12",
        ),
        (
            "ORD-2026-1002",
            "Anna Nowak",
            "anna.nowak@example.com",
            "+48500500500",
            "Smartfon PixelLine X",
            "Telefony",
            "2026-05-18",
        ),
        (
            "ORD-2026-1003",
            "Piotr Zielinski",
            "piotr.zielinski@example.com",
            "+48600600600",
            "Monitor ViewPro 27",
            "Monitory",
            "2026-04-26",
        ),
    ]
    conn.executemany(
        """
        INSERT INTO orders(number, customer_name, email, phone, product, category, purchased_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        orders,
    )

    employee = {"id": "usr-employee", "name": "Marta Lewandowska", "role": "PRACOWNIK_OBSLUGI"}
    client = {"id": "usr-client", "name": "Jan Kowalski", "role": "KLIENT"}
    complaint = create_case_record(
        conn,
        {
            "type": "REKLAMACJA",
            "channel": "ONLINE",
            "orderNumber": "ORD-2026-1001",
            "email": "jan.kowalski@example.com",
            "phone": "+48123123123",
            "description": "Laptop uruchamia sie tylko po kilku probach.",
            "reason": "Awaria sprzetu",
            "attachments": ["diagnostyka.jpg"],
        },
        client,
    )
    update_status_record(
        conn,
        complaint["id"],
        "W_TRAKCIE",
        "Zweryfikowano zamowienie w mock ERP.",
        employee,
    )
    return_case = create_case_record(
        conn,
        {
            "type": "ZWROT",
            "channel": "TELEFON",
            "orderNumber": "ORD-2026-1002",
            "email": "anna.nowak@example.com",
            "phone": "+48500500500",
            "description": "Klientka chce zwrocic telefon w terminie ustawowym.",
            "reason": "Zwrot konsumencki",
            "attachments": [],
        },
        employee,
    )
    generate_label_record(conn, return_case["id"], "InPost", employee)
    audit(conn, "SYSTEM", "INIT", "Uruchomiono dane demonstracyjne")


def hash_password(password):
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return f"pbkdf2_sha256${salt}${base64.b64encode(digest).decode('ascii')}"


def verify_password(password, encoded):
    try:
        _, salt, digest = encoded.split("$", 2)
        candidate = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000
        )
        return hmac.compare_digest(base64.b64encode(candidate).decode("ascii"), digest)
    except ValueError:
        return False


def sign_token(user):
    payload = {
        "sub": user["id"],
        "email": user["email"],
        "role": user["role"],
        "exp": int(time.time()) + TOKEN_TTL_SECONDS,
    }
    body = b64url(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    sig = b64url(hmac.new(SECRET, body.encode("ascii"), hashlib.sha256).digest())
    return f"{body}.{sig}"


def decode_token(token):
    try:
        body, sig = token.split(".", 1)
        expected = b64url(hmac.new(SECRET, body.encode("ascii"), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected):
            raise ApiError(HTTPStatus.UNAUTHORIZED, "INVALID_TOKEN", "Nieprawidlowy token.")
        payload = json.loads(base64.urlsafe_b64decode(pad_b64(body)))
        if payload.get("exp", 0) < time.time():
            raise ApiError(HTTPStatus.UNAUTHORIZED, "TOKEN_EXPIRED", "Token wygasl.")
        with connect() as conn:
            user = conn.execute("SELECT * FROM users WHERE id = ? AND active = 1", (payload["sub"],)).fetchone()
            if not user:
                raise ApiError(HTTPStatus.UNAUTHORIZED, "USER_INACTIVE", "Uzytkownik nieaktywny.")
            return user_to_dict(user)
    except ApiError:
        raise
    except Exception as exc:
        raise ApiError(HTTPStatus.UNAUTHORIZED, "INVALID_TOKEN", "Nieprawidlowy token.") from exc


def b64url(data):
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def pad_b64(value):
    return value + "=" * (-len(value) % 4)


def require_user(handler, min_role=None):
    header = handler.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        raise ApiError(HTTPStatus.UNAUTHORIZED, "AUTH_REQUIRED", "Wymagane logowanie.")
    user = decode_token(header.removeprefix("Bearer ").strip())
    if min_role and ROLE_RANK[user["role"]] < ROLE_RANK[min_role]:
        raise ApiError(HTTPStatus.FORBIDDEN, "FORBIDDEN", "Brak uprawnien.")
    return user


def can_operate(handler):
    return require_user(handler, "PRACOWNIK_OBSLUGI")


def row_to_order(row):
    return {
        "number": row["number"],
        "customerName": row["customer_name"],
        "email": row["email"],
        "phone": row["phone"],
        "product": row["product"],
        "category": row["category"],
        "purchasedAt": row["purchased_at"],
    }


def user_to_dict(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"],
        "role": row["role"],
        "active": bool(row["active"]),
    }


def config_dict(conn):
    rows = conn.execute("SELECT key, value FROM config").fetchall()
    values = {row["key"]: int(row["value"]) for row in rows}
    return {**DEFAULT_CONFIG, **values}


def get_case(conn, case_id=None, number=None, email=None):
    if case_id:
        row = conn.execute("SELECT * FROM cases WHERE id = ?", (case_id,)).fetchone()
    else:
        row = conn.execute(
            "SELECT * FROM cases WHERE upper(number) = upper(?) AND lower(email) = lower(?)",
            (number or "", email or ""),
        ).fetchone()
    return case_to_dict(conn, row) if row else None


def case_to_dict(conn, row):
    case_id = row["id"]
    decision = conn.execute("SELECT * FROM decisions WHERE case_id = ?", (case_id,)).fetchone()
    shipment = conn.execute("SELECT * FROM return_shipments WHERE case_id = ?", (case_id,)).fetchone()
    history = conn.execute(
        "SELECT * FROM status_history WHERE case_id = ? ORDER BY created_at, rowid",
        (case_id,),
    ).fetchall()
    escalations = conn.execute(
        "SELECT * FROM escalations WHERE case_id = ? ORDER BY created_at, rowid",
        (case_id,),
    ).fetchall()
    return {
        "id": row["id"],
        "number": row["number"],
        "type": row["type"],
        "channel": row["channel"],
        "status": row["status"],
        "priority": row["priority"],
        "orderNumber": row["order_number"],
        "customerName": row["customer_name"],
        "email": row["email"],
        "phone": row["phone"],
        "product": row["product"],
        "category": row["category"],
        "description": row["description"],
        "reason": row["reason"],
        "attachments": json.loads(row["attachments_json"] or "[]"),
        "createdAt": row["created_at"],
        "deadlineAt": row["deadline_at"],
        "assignedTo": row["assigned_to"],
        "decision": decision_to_dict(decision) if decision else None,
        "returnLabel": shipment_to_dict(shipment) if shipment else None,
        "history": [history_to_dict(item) for item in history],
        "escalations": [escalation_to_dict(item) for item in escalations],
    }


def decision_to_dict(row):
    return {
        "id": row["id"],
        "type": row["type"],
        "justification": row["justification"] or "",
        "author": row["author"],
        "createdAt": row["created_at"],
        "final": bool(row["final"]),
    }


def shipment_to_dict(row):
    return {
        "id": row["id"],
        "courier": row["courier"],
        "trackingNumber": row["tracking_number"],
        "format": row["format"],
        "generatedAt": row["generated_at"],
        "receivedCondition": row["received_condition"],
        "receivedAt": row["received_at"],
    }


def history_to_dict(row):
    return {
        "id": row["id"],
        "status": row["status"],
        "actor": row["actor"],
        "role": row["role"],
        "comment": row["comment"] or "",
        "createdAt": row["created_at"],
    }


def escalation_to_dict(row):
    return {
        "id": row["id"],
        "reason": row["reason"],
        "author": row["author"],
        "createdAt": row["created_at"],
    }


def notification_to_dict(row):
    return {
        "id": row["id"],
        "caseId": row["case_id"],
        "caseNumber": row["case_number"],
        "type": row["type"],
        "recipient": row["recipient"],
        "body": row["body"],
        "channel": row["channel"],
        "createdAt": row["created_at"],
        "deliveredWithinSeconds": row["delivered_within_seconds"],
    }


def audit_to_dict(row):
    return {
        "id": row["id"],
        "actor": row["actor"],
        "action": row["action"],
        "details": row["details"],
        "createdAt": row["created_at"],
    }


def list_cases(conn, query=None, status=None, case_type=None):
    clauses = []
    params = []
    if status:
        clauses.append("status = ?")
        params.append(status)
    if case_type:
        clauses.append("type = ?")
        params.append(case_type)
    if query:
        clauses.append(
            "(lower(number) LIKE ? OR lower(customer_name) LIKE ? OR lower(email) LIKE ? OR lower(order_number) LIKE ? OR lower(product) LIKE ?)"
        )
        like = f"%{query.lower()}%"
        params.extend([like, like, like, like, like])
    sql = "SELECT * FROM cases"
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY created_at DESC, rowid DESC"
    return [case_to_dict(conn, row) for row in conn.execute(sql, params).fetchall()]


def list_notifications(conn, limit=50):
    rows = conn.execute(
        "SELECT * FROM notifications ORDER BY created_at DESC, rowid DESC LIMIT ?",
        (limit,),
    ).fetchall()
    return [notification_to_dict(row) for row in rows]


def list_audit(conn, limit=50):
    rows = conn.execute(
        "SELECT * FROM audit_log ORDER BY created_at DESC, rowid DESC LIMIT ?",
        (limit,),
    ).fetchall()
    return [audit_to_dict(row) for row in rows]


def bootstrap(conn):
    return {
        "config": config_dict(conn),
        "orders": [row_to_order(row) for row in conn.execute("SELECT * FROM orders ORDER BY number").fetchall()],
        "cases": list_cases(conn),
        "notifications": list_notifications(conn),
        "auditLog": list_audit(conn),
        "users": [user_to_dict(row) for row in conn.execute("SELECT * FROM users ORDER BY role, name").fetchall()],
        "today": today_iso(),
    }


def create_case_record(conn, data, actor):
    case_type = required(data, "type")
    channel = data.get("channel") or "ONLINE"
    order_number = required(data, "orderNumber").strip()
    email = required(data, "email").strip().lower()
    description = required(data, "description").strip()
    reason = required(data, "reason").strip()
    if case_type not in CASE_TYPES:
        raise ApiError(HTTPStatus.BAD_REQUEST, "INVALID_TYPE", "Nieprawidlowy typ zgloszenia.")
    if channel not in CHANNELS:
        raise ApiError(HTTPStatus.BAD_REQUEST, "INVALID_CHANNEL", "Nieprawidlowy kanal.")
    order = conn.execute(
        "SELECT * FROM orders WHERE upper(number) = upper(?) AND lower(email) = lower(?)",
        (order_number, email),
    ).fetchone()
    if not order:
        raise ApiError(HTTPStatus.BAD_REQUEST, "ORDER_NOT_FOUND", "Nie znaleziono zamowienia.")
    attachments = normalize_attachments(data.get("attachments"))
    if len(attachments) > 5:
        raise ApiError(HTTPStatus.BAD_REQUEST, "TOO_MANY_ATTACHMENTS", "Maksymalnie 5 zalacznikow.")

    created_at = today_iso()
    cfg = config_dict(conn)
    deadline_days = cfg["returnDeadlineDays"] if case_type == "ZWROT" else cfg["complaintDeadlineDays"]
    deadline_at = add_days(created_at, deadline_days)
    case_id = new_id("case")
    number = next_case_number(conn, case_type, created_at[:4])
    assigned_to = actor["name"] if ROLE_RANK.get(actor["role"], 0) >= ROLE_RANK["PRACOWNIK_OBSLUGI"] else None
    phone = str(data.get("phone") or order["phone"] or "").strip()

    conn.execute(
        """
        INSERT INTO cases(
            id, number, type, channel, status, priority, order_number, customer_name, email,
            phone, product, category, description, reason, attachments_json, created_at,
            deadline_at, assigned_to
        ) VALUES (?, ?, ?, ?, 'NOWE', 'NORMALNY', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            case_id,
            number,
            case_type,
            channel,
            order["number"],
            order["customer_name"],
            email,
            phone,
            order["product"],
            order["category"],
            description,
            reason,
            json.dumps(attachments),
            created_at,
            deadline_at,
            assigned_to,
        ),
    )
    add_history(conn, case_id, "NOWE", actor, "Zgloszenie zarejestrowane.", created_at)
    add_notification(
        conn,
        case_id,
        number,
        "POTWIERDZENIE",
        email,
        f"Zarejestrowano zgloszenie {number}.",
        created_at,
    )
    return get_case(conn, case_id)


def update_status_record(conn, case_id, status, comment, actor):
    if status not in STATUSES:
        raise ApiError(HTTPStatus.BAD_REQUEST, "INVALID_STATUS", "Nieprawidlowy status.")
    case = get_case_or_error(conn, case_id)
    if case["status"] in FINAL_STATUSES and status != "ZAMKNIETE":
        raise ApiError(HTTPStatus.CONFLICT, "CASE_FINAL", "Sprawa jest juz finalna.")
    created_at = today_iso()
    conn.execute("UPDATE cases SET status = ? WHERE id = ?", (status, case_id))
    add_history(conn, case_id, status, actor, comment or "", created_at)
    add_notification(
        conn,
        case_id,
        case["number"],
        "STATUS",
        case["email"],
        f"Status zgloszenia {case['number']}: {status}.",
        created_at,
    )
    return get_case(conn, case_id)


def create_decision_record(conn, case_id, data, actor):
    decision_type = required(data, "type")
    justification = str(data.get("justification") or "").strip()
    if decision_type not in DECISION_TYPES:
        raise ApiError(HTTPStatus.BAD_REQUEST, "INVALID_DECISION", "Nieprawidlowa decyzja.")
    if decision_type == "ODRZUCENIE" and not justification:
        raise ApiError(HTTPStatus.BAD_REQUEST, "JUSTIFICATION_REQUIRED", "Uzasadnienie odmowy jest obowiazkowe.")
    case = get_case_or_error(conn, case_id)
    if case["decision"]:
        raise ApiError(HTTPStatus.CONFLICT, "DECISION_IMMUTABLE", "Decyzja jest niemodyfikowalna.")
    created_at = today_iso()
    conn.execute(
        """
        INSERT INTO decisions(id, case_id, type, justification, author, created_at, final)
        VALUES (?, ?, ?, ?, ?, ?, 1)
        """,
        (new_id("decision"), case_id, decision_type, justification, actor["name"], created_at),
    )
    conn.execute("UPDATE cases SET status = 'ROZPATRZONE' WHERE id = ?", (case_id,))
    add_history(
        conn,
        case_id,
        "ROZPATRZONE",
        actor,
        f"Decyzja: {decision_type}" + (f" - {justification}" if justification else ""),
        created_at,
    )
    add_notification(
        conn,
        case_id,
        case["number"],
        "DECYZJA",
        case["email"],
        f"Wydano decyzje dla zgloszenia {case['number']}: {decision_type}.",
        created_at,
    )
    return get_case(conn, case_id)


def escalate_record(conn, case_id, reason, actor):
    case = get_case_or_error(conn, case_id)
    if case["status"] in FINAL_STATUSES:
        raise ApiError(HTTPStatus.CONFLICT, "CASE_FINAL", "Nie mozna eskalowac finalnej sprawy.")
    created_at = today_iso()
    reason = str(reason or "Eskalacja manualna.").strip()
    conn.execute("UPDATE cases SET status = 'ESKALOWANE', priority = 'PILNY' WHERE id = ?", (case_id,))
    conn.execute(
        "INSERT INTO escalations(id, case_id, reason, author, created_at) VALUES (?, ?, ?, ?, ?)",
        (new_id("esc"), case_id, reason, actor["name"], created_at),
    )
    add_history(conn, case_id, "ESKALOWANE", actor, reason, created_at)
    add_notification(
        conn,
        case_id,
        case["number"],
        "ESKALACJA",
        case["email"],
        f"Zgloszenie {case['number']} zostalo eskalowane do kierownika.",
        created_at,
    )
    return get_case(conn, case_id)


def generate_label_record(conn, case_id, courier, actor):
    case = get_case_or_error(conn, case_id)
    if case["type"] != "ZWROT":
        raise ApiError(HTTPStatus.BAD_REQUEST, "NOT_RETURN", "Etykieta dotyczy tylko zwrotow.")
    if case["decision"]:
        raise ApiError(HTTPStatus.CONFLICT, "CASE_FINAL", "Sprawa ma juz decyzje.")
    created_at = today_iso()
    tracking = f"TRK-{secrets.randbelow(1_000_000):06d}"
    existing = conn.execute("SELECT id FROM return_shipments WHERE case_id = ?", (case_id,)).fetchone()
    if existing:
        conn.execute(
            """
            UPDATE return_shipments SET courier = ?, tracking_number = ?, format = 'PDF', generated_at = ?
            WHERE case_id = ?
            """,
            (courier, tracking, created_at, case_id),
        )
    else:
        conn.execute(
            """
            INSERT INTO return_shipments(id, case_id, courier, tracking_number, format, generated_at)
            VALUES (?, ?, ?, ?, 'PDF', ?)
            """,
            (new_id("label"), case_id, courier, tracking, created_at),
        )
    conn.execute("UPDATE cases SET status = 'OCZEKUJE_NA_TOWAR' WHERE id = ?", (case_id,))
    add_history(conn, case_id, "OCZEKUJE_NA_TOWAR", actor, f"Wygenerowano etykiete zwrotna {courier}.", created_at)
    add_notification(
        conn,
        case_id,
        case["number"],
        "ETYKIETA",
        case["email"],
        f"Wyslano etykiete zwrotna {courier} dla {case['number']}.",
        created_at,
    )
    return get_case(conn, case_id)


def confirm_wms_record(conn, case_id, condition):
    case = get_case_or_error(conn, case_id)
    created_at = today_iso()
    conn.execute(
        """
        UPDATE return_shipments SET received_condition = ?, received_at = ?
        WHERE case_id = ?
        """,
        (condition or "Towar kompletny", created_at, case_id),
    )
    conn.execute("UPDATE cases SET status = 'W_TRAKCIE' WHERE id = ?", (case_id,))
    actor = {"id": "wms", "name": "Mock WMS", "role": "SYSTEM"}
    add_history(conn, case_id, "W_TRAKCIE", actor, f"Magazyn potwierdzil odbior towaru. Stan: {condition}.", created_at)
    add_notification(
        conn,
        case_id,
        case["number"],
        "WMS",
        case["email"],
        f"Mock WMS potwierdzil odbior towaru dla {case['number']}.",
        created_at,
    )
    return get_case(conn, case_id)


def evaluate_deadlines_record(conn, actor, now=None):
    cfg = config_dict(conn)
    today = str(now or today_iso())
    try:
        datetime.fromisoformat(today).date()
    except ValueError as exc:
        raise ApiError(HTTPStatus.BAD_REQUEST, "INVALID_DATE", "Data now musi miec format YYYY-MM-DD.") from exc
    system = {"id": "system", "name": "System SZRZ", "role": "SYSTEM"}
    changed = 0
    rows = conn.execute("SELECT * FROM cases WHERE status NOT IN ('ROZPATRZONE', 'ZAMKNIETE')").fetchall()
    for row in rows:
        case = case_to_dict(conn, row)
        days_left = days_between(today, case["deadlineAt"])
        last_history = case["history"][-1] if case["history"] else {"createdAt": case["createdAt"]}
        stale_days = days_between(last_history["createdAt"], today)
        has_alert = any("Alert terminu" in item["comment"] for item in case["history"])
        if days_left < 0 and case["status"] != "ESKALOWANE":
            escalate_record(conn, case["id"], "Przekroczono termin ustawowy.", system)
            changed += 1
        elif days_left <= cfg["alertThresholdDays"] and not has_alert:
            add_history(conn, case["id"], case["status"], system, f"Alert terminu: {days_left} dni.", today)
            add_notification(
                conn,
                case["id"],
                case["number"],
                "ALERT",
                case["email"],
                f"Termin dla {case['number']}: {days_left} dni.",
                today,
            )
            changed += 1
        if stale_days > cfg["staleEscalationDays"] and case["status"] != "ESKALOWANE":
            escalate_record(conn, case["id"], f"Brak zmiany statusu przez {stale_days} dni.", system)
            changed += 1
    audit(conn, actor["name"], "DEADLINES_EVALUATED", f"Oceniono reguly terminow, zmian: {changed}.")
    return {"changed": changed, **bootstrap(conn)}


def report_record(conn, filters):
    clauses = []
    params = []
    if filters.get("from"):
        clauses.append("created_at >= ?")
        params.append(filters["from"])
    if filters.get("to"):
        clauses.append("created_at <= ?")
        params.append(filters["to"])
    if filters.get("type"):
        clauses.append("type = ?")
        params.append(filters["type"])
    if filters.get("status"):
        clauses.append("status = ?")
        params.append(filters["status"])
    if filters.get("category"):
        clauses.append("category = ?")
        params.append(filters["category"])
    sql = "SELECT * FROM cases"
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    rows = conn.execute(sql, params).fetchall()
    cases = [case_to_dict(conn, row) for row in rows]
    decided = [item for item in cases if item["decision"]]
    accepted = [item for item in decided if item["decision"]["type"] != "ODRZUCENIE"]
    rejected = [item for item in decided if item["decision"]["type"] == "ODRZUCENIE"]
    durations = [days_between(item["createdAt"], item["decision"]["createdAt"]) for item in decided]
    return {
        "total": len(cases),
        "acceptedPercent": percent(len(accepted), len(decided)),
        "rejectedPercent": percent(len(rejected), len(decided)),
        "averageResolutionDays": round(sum(durations) / len(durations), 1) if durations else 0,
        "topReasons": top_counts(cases, "reason"),
        "byStatus": counts(cases, "status"),
        "byType": counts(cases, "type"),
    }


def add_history(conn, case_id, status, actor, comment, created_at=None):
    conn.execute(
        """
        INSERT INTO status_history(id, case_id, status, actor, role, comment, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            new_id("hist"),
            case_id,
            status,
            actor["name"],
            actor.get("role", "SYSTEM"),
            comment or "",
            created_at or today_iso(),
        ),
    )


def add_notification(conn, case_id, case_number, kind, recipient, body, created_at=None):
    conn.execute(
        """
        INSERT INTO notifications(id, case_id, case_number, type, recipient, body, channel, created_at, delivered_within_seconds)
        VALUES (?, ?, ?, ?, ?, ?, 'EMAIL/SMS', ?, 60)
        """,
        (new_id("notif"), case_id, case_number, kind, recipient, body, created_at or today_iso()),
    )


def audit(conn, actor, action, details):
    conn.execute(
        "INSERT INTO audit_log(id, actor, action, details, created_at) VALUES (?, ?, ?, ?, ?)",
        (new_id("audit"), actor, action, details, today_iso()),
    )


def get_case_or_error(conn, case_id):
    case = get_case(conn, case_id)
    if not case:
        raise ApiError(HTTPStatus.NOT_FOUND, "CASE_NOT_FOUND", "Nie znaleziono sprawy.")
    return case


def next_case_number(conn, case_type, year):
    prefix = "ZWR" if case_type == "ZWROT" else "REC"
    pattern = f"{prefix}-{year}-%"
    count = conn.execute("SELECT COUNT(*) AS count FROM cases WHERE number LIKE ?", (pattern,)).fetchone()["count"]
    return f"{prefix}-{year}-{count + 1:05d}"


def normalize_attachments(value):
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if not value:
        return []
    return [item.strip() for item in str(value).split(",") if item.strip()]


def required(data, key):
    value = data.get(key)
    if value is None or str(value).strip() == "":
        raise ApiError(HTTPStatus.BAD_REQUEST, "REQUIRED_FIELD", f"Pole {key} jest wymagane.")
    return str(value)


def new_id(prefix):
    return f"{prefix}-{uuid.uuid4()}"


def today_iso():
    return date.today().isoformat()


def add_days(iso_date, days):
    return (datetime.fromisoformat(iso_date).date() + timedelta(days=int(days))).isoformat()


def days_between(from_iso, to_iso):
    return (datetime.fromisoformat(to_iso).date() - datetime.fromisoformat(from_iso).date()).days


def percent(value, total):
    return round((value / total) * 100, 1) if total else 0


def counts(items, field):
    result = {}
    for item in items:
        key = item.get(field) or "BRAK"
        result[key] = result.get(key, 0) + 1
    return result


def top_counts(items, field, limit=5):
    counted = counts(items, field)
    return [
        {"reason": key, "count": value}
        for key, value in sorted(counted.items(), key=lambda entry: entry[1], reverse=True)[:limit]
    ]


class Handler(SimpleHTTPRequestHandler):
    server_version = "SZRZ/1.0"

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def do_GET(self):
        self.route("GET")

    def do_POST(self):
        self.route("POST")

    def do_PUT(self):
        self.route("PUT")

    def route(self, method):
        parsed = urlparse(self.path)
        path = parsed.path
        query = {key: values[-1] for key, values in parse_qs(parsed.query).items()}
        try:
            if path.startswith("/api/"):
                response = self.handle_api(method, path, query)
                self.json_response(response)
            else:
                self.serve_static(path)
        except ApiError as exc:
            self.json_response({"error": {"code": exc.code, "message": exc.message}}, exc.status)
        except Exception as exc:
            self.json_response(
                {"error": {"code": "SERVER_ERROR", "message": str(exc)}},
                HTTPStatus.INTERNAL_SERVER_ERROR,
            )

    def handle_api(self, method, path, query):
        body = self.read_json()
        with connect() as conn:
            if method == "GET" and path == "/api/bootstrap":
                return bootstrap(conn)
            if method == "POST" and path == "/api/auth/login":
                return self.login(conn, body)
            if method == "GET" and path == "/api/auth/me":
                return {"user": require_user(self)}
            if method == "POST" and path == "/api/reset-demo":
                user = require_user(self, "ADMINISTRATOR")
                reset_demo(conn)
                audit(conn, user["name"], "RESET_DEMO", "Przywrocono dane demonstracyjne.")
                return bootstrap(conn)
            if method == "GET" and path == "/api/orders":
                return {"orders": [row_to_order(row) for row in conn.execute("SELECT * FROM orders ORDER BY number").fetchall()]}
            if method == "POST" and path == "/api/orders/verify":
                return self.verify_order(conn, body)
            if method == "GET" and path == "/api/cases":
                require_user(self, "PRACOWNIK_OBSLUGI")
                return {"cases": list_cases(conn, query.get("query"), query.get("status"), query.get("type"))}
            if method == "POST" and path == "/api/cases":
                actor = self.optional_user() or {"id": "public", "name": "Klient", "role": "KLIENT"}
                return {"case": create_case_record(conn, body, actor), **bootstrap(conn)}
            if method == "GET" and path == "/api/cases/status":
                case = get_case(conn, number=query.get("number"), email=query.get("email"))
                if not case:
                    raise ApiError(HTTPStatus.NOT_FOUND, "CASE_NOT_FOUND", "Nie odnaleziono sprawy.")
                return {"case": case}
            if method == "POST" and path == "/api/deadlines/evaluate":
                return evaluate_deadlines_record(conn, require_user(self, "KIEROWNIK"), body.get("now"))
            if method == "GET" and path == "/api/reports":
                require_user(self, "KIEROWNIK")
                return {"report": report_record(conn, query)}
            if method == "GET" and path == "/api/users":
                require_user(self, "ADMINISTRATOR")
                return {"users": [user_to_dict(row) for row in conn.execute("SELECT * FROM users ORDER BY role, name").fetchall()]}
            if method == "POST" and path == "/api/users":
                user = require_user(self, "ADMINISTRATOR")
                return {"user": self.save_user(conn, body, user), **bootstrap(conn)}
            if method == "GET" and path == "/api/config":
                return {"config": config_dict(conn)}
            if method == "PUT" and path == "/api/config":
                user = require_user(self, "ADMINISTRATOR")
                return {"config": self.update_config(conn, body, user), **bootstrap(conn)}
            if method == "GET" and path == "/api/notifications":
                require_user(self, "PRACOWNIK_OBSLUGI")
                return {"notifications": list_notifications(conn)}
            if method == "GET" and path == "/api/audit-log":
                require_user(self, "ADMINISTRATOR")
                return {"auditLog": list_audit(conn)}

            parts = [unquote(part) for part in path.strip("/").split("/")]
            if len(parts) >= 3 and parts[0] == "api" and parts[1] == "cases":
                case_id = parts[2]
                if method == "GET" and len(parts) == 3:
                    require_user(self, "PRACOWNIK_OBSLUGI")
                    return {"case": get_case_or_error(conn, case_id)}
                if method == "PUT" and parts[3:] == ["status"]:
                    return {"case": update_status_record(conn, case_id, body.get("status"), body.get("comment"), can_operate(self)), **bootstrap(conn)}
                if method == "POST" and parts[3:] == ["decision"]:
                    return {"case": create_decision_record(conn, case_id, body, can_operate(self)), **bootstrap(conn)}
                if method == "POST" and parts[3:] == ["escalate"]:
                    return {"case": escalate_record(conn, case_id, body.get("reason"), can_operate(self)), **bootstrap(conn)}
                if method == "POST" and parts[3:] == ["return-label"]:
                    return {"case": generate_label_record(conn, case_id, body.get("courier") or "InPost", can_operate(self)), **bootstrap(conn)}
                if method == "POST" and parts[3:] == ["wms-receipt"]:
                    can_operate(self)
                    return {"case": confirm_wms_record(conn, case_id, body.get("condition") or "Towar kompletny"), **bootstrap(conn)}

            if len(parts) == 3 and parts[0] == "api" and parts[1] == "users":
                admin = require_user(self, "ADMINISTRATOR")
                if method == "PUT":
                    return {"user": self.save_user(conn, {**body, "id": parts[2]}, admin), **bootstrap(conn)}
            if len(parts) == 4 and parts[0] == "api" and parts[1] == "users" and parts[3] == "toggle":
                admin = require_user(self, "ADMINISTRATOR")
                return {"user": self.toggle_user(conn, parts[2], admin), **bootstrap(conn)}

        raise ApiError(HTTPStatus.NOT_FOUND, "NOT_FOUND", "Nie znaleziono endpointu.")

    def login(self, conn, body):
        email = required(body, "email").lower()
        password = required(body, "password")
        row = conn.execute("SELECT * FROM users WHERE lower(email) = lower(?)", (email,)).fetchone()
        if not row or not row["active"] or not verify_password(password, row["password_hash"]):
            raise ApiError(HTTPStatus.UNAUTHORIZED, "BAD_CREDENTIALS", "Nieprawidlowe dane logowania.")
        user = user_to_dict(row)
        audit(conn, user["name"], "LOGIN", user["email"])
        return {"token": sign_token(user), "user": user}

    def verify_order(self, conn, body):
        order = conn.execute(
            "SELECT * FROM orders WHERE upper(number) = upper(?) AND lower(email) = lower(?)",
            (body.get("orderNumber") or "", body.get("email") or ""),
        ).fetchone()
        if not order:
            raise ApiError(HTTPStatus.NOT_FOUND, "ORDER_NOT_FOUND", "Nie znaleziono zamowienia.")
        return {"order": row_to_order(order)}

    def save_user(self, conn, data, actor):
        user_id = data.get("id") or new_id("usr")
        role = data.get("role") or "PRACOWNIK_OBSLUGI"
        if role not in ROLES:
            raise ApiError(HTTPStatus.BAD_REQUEST, "INVALID_ROLE", "Nieprawidlowa rola.")
        name = required(data, "name").strip()
        email = required(data, "email").strip().lower()
        active = 1 if data.get("active", True) else 0
        existing = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if existing:
            conn.execute(
                "UPDATE users SET name = ?, email = ?, role = ?, active = ? WHERE id = ?",
                (name, email, role, active, user_id),
            )
            action = "USER_UPDATE"
        else:
            password = data.get("password") or "ChangeMe123!"
            conn.execute(
                """
                INSERT INTO users(id, name, email, role, active, password_hash, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (user_id, name, email, role, active, hash_password(password), today_iso()),
            )
            action = "USER_CREATE"
        audit(conn, actor["name"], action, email)
        return user_to_dict(conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone())

    def toggle_user(self, conn, user_id, actor):
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row:
            raise ApiError(HTTPStatus.NOT_FOUND, "USER_NOT_FOUND", "Nie znaleziono uzytkownika.")
        active = 0 if row["active"] else 1
        conn.execute("UPDATE users SET active = ? WHERE id = ?", (active, user_id))
        audit(conn, actor["name"], "USER_TOGGLE", row["email"])
        return user_to_dict(conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone())

    def update_config(self, conn, data, actor):
        old = config_dict(conn)
        new_config = {}
        for key, fallback in DEFAULT_CONFIG.items():
            value = int(data.get(key) or old.get(key) or fallback)
            if value <= 0:
                raise ApiError(HTTPStatus.BAD_REQUEST, "INVALID_CONFIG", "Wartosci konfiguracji musza byc dodatnie.")
            new_config[key] = value
            conn.execute(
                "INSERT INTO config(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, str(value)),
            )
        audit(
            conn,
            actor["name"],
            "CONFIG_UPDATE",
            f"reklamacja {old['complaintDeadlineDays']}->{new_config['complaintDeadlineDays']}, "
            f"zwrot {old['returnDeadlineDays']}->{new_config['returnDeadlineDays']}, "
            f"alert {old['alertThresholdDays']}->{new_config['alertThresholdDays']}",
        )
        return new_config

    def optional_user(self):
        header = self.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            return None
        try:
            return decode_token(header.removeprefix("Bearer ").strip())
        except ApiError:
            return None

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0") or "0")
        if not length:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise ApiError(HTTPStatus.BAD_REQUEST, "BAD_JSON", "Nieprawidlowy JSON.") from exc

    def json_response(self, payload, status=HTTPStatus.OK):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def serve_static(self, path):
        if path == "/":
            path = "/index.html"
        target = (ROOT / path.lstrip("/")).resolve()
        if not str(target).startswith(str(ROOT)) or not target.is_file():
            raise ApiError(HTTPStatus.NOT_FOUND, "STATIC_NOT_FOUND", "Nie znaleziono pliku.")
        content = target.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type(target))
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def log_message(self, fmt, *args):
        if os.environ.get("SZRZ_QUIET") != "1":
            super().log_message(fmt, *args)


def content_type(path):
    suffix = path.suffix.lower()
    return {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".pdf": "application/pdf",
    }.get(suffix, "application/octet-stream")


def run():
    init_db()
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"SZRZ running at http://{host}:{port}/", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    try:
        run()
    except KeyboardInterrupt:
        sys.exit(0)
