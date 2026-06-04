import json

from .settings import DEFAULT_CONFIG
from .utils import today_iso

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
