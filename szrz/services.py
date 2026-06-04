import json
import secrets
from datetime import datetime
from http import HTTPStatus

from .errors import ApiError
from .repository import bootstrap, case_to_dict, config_dict, get_case
from .settings import CASE_TYPES, CHANNELS, DECISION_TYPES, FINAL_STATUSES, ROLE_RANK, STATUSES
from .utils import add_days, days_between, new_id, percent, required, today_iso, top_counts, counts

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
