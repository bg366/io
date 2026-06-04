import json
import os
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

from .auth import can_operate, decode_token, hash_password, require_user, sign_token, verify_password
from .db import connect, init_db
from .demo import reset_demo
from .errors import ApiError
from .repository import bootstrap, config_dict, get_case, list_audit, list_cases, list_notifications, row_to_order, user_to_dict
from .services import (
    audit,
    confirm_wms_record,
    create_case_record,
    create_decision_record,
    escalate_record,
    evaluate_deadlines_record,
    generate_label_record,
    get_case_or_error,
    report_record,
    update_status_record,
)
from .settings import DEFAULT_CONFIG, ROOT, ROLES
from .utils import new_id, required, today_iso

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
