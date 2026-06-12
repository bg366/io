import http.client
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = os.path.join(ROOT, "server.py")
HOST = "127.0.0.1"

EMPLOYEE_EMAIL = "marta.ops@example.com"
MANAGER_EMAIL = "tomasz.manager@example.com"
ADMIN_EMAIL = "ewa.admin@example.com"
DEMO_PASSWORD = "demo123"


def free_port():
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind((HOST, 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not os.path.exists(SERVER):
            raise AssertionError("server.py is required for API verification")

        cls.tmpdir = tempfile.TemporaryDirectory()
        cls.db_path = os.path.join(cls.tmpdir.name, "szrz-test.sqlite")
        cls.port = free_port()

        env = os.environ.copy()
        env["SZRZ_DB"] = cls.db_path
        env["PORT"] = str(cls.port)
        env["SZRZ_PORT"] = str(cls.port)
        env["SZRZ_QUIET"] = "1"
        env["PYTHONUNBUFFERED"] = "1"

        cls.server = subprocess.Popen(
            [sys.executable, "server.py"],
            cwd=ROOT,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        cls.wait_for_server()

    @classmethod
    def tearDownClass(cls):
        server = getattr(cls, "server", None)
        if server and server.poll() is None:
            server.terminate()
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait(timeout=5)
        tmpdir = getattr(cls, "tmpdir", None)
        if tmpdir:
            tmpdir.cleanup()

    @classmethod
    def wait_for_server(cls):
        deadline = time.time() + 10
        last_error = None
        while time.time() < deadline:
            if cls.server.poll() is not None:
                raise AssertionError(
                    f"server.py exited during startup with code {cls.server.returncode}"
                )
            try:
                conn = http.client.HTTPConnection(HOST, cls.port, timeout=1)
                conn.request("GET", "/api/bootstrap")
                response = conn.getresponse()
                response.read()
                conn.close()
                if response.status < 500:
                    return
            except OSError as exc:
                last_error = exc
            time.sleep(0.1)
        raise AssertionError(f"server.py did not start on port {cls.port}: {last_error}")

    def setUp(self):
        self.reset_demo()

    def request(self, method, path, body=None, token=None, expected=None):
        payload = None
        headers = {"Accept": "application/json"}
        if body is not None:
            payload = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
            headers["Content-Length"] = str(len(payload))
        if token:
            headers["Authorization"] = "Bearer " + token

        conn = http.client.HTTPConnection(HOST, self.port, timeout=5)
        conn.request(method, path, body=payload, headers=headers)
        response = conn.getresponse()
        raw = response.read().decode("utf-8")
        conn.close()

        data = None
        if raw:
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                self.fail(f"{method} {path} returned non-JSON response: {raw[:500]}")

        if expected is not None:
            allowed = expected if isinstance(expected, tuple) else (expected,)
            self.assertIn(
                response.status,
                allowed,
                f"{method} {path} returned {response.status}, expected {allowed}: {data}",
            )
        return response.status, data

    def reset_demo(self):
        self.request(
            "POST",
            "/api/reset-demo",
            token=self.login(ADMIN_EMAIL),
            expected=(200, 204),
        )

    def login(self, email=EMPLOYEE_EMAIL, password=DEMO_PASSWORD):
        _, data = self.request(
            "POST",
            "/api/auth/login",
            {"email": email, "password": password},
            expected=200,
        )
        token = self.token_from(data)
        self.assertTrue(token, f"login response should include an access token: {data}")
        return token

    def token_from(self, data):
        if not isinstance(data, dict):
            return None
        return data.get("token") or data.get("accessToken") or data.get("access_token")

    def list_from(self, data, key):
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            for candidate in (key, "items", "data", "results"):
                value = data.get(candidate)
                if isinstance(value, list):
                    return value
        return []

    def object_from(self, data, key):
        if isinstance(data, dict):
            value = data.get(key)
            if isinstance(value, dict):
                return value
            value = data.get("data")
            if isinstance(value, dict):
                return value
            return data
        return {}

    def create_case(self, case_type="REKLAMACJA", email="piotr.zielinski@example.com"):
        payload = {
            "type": case_type,
            "channel": "ONLINE",
            "orderNumber": "ORD-2026-1003",
            "email": email,
            "phone": "+48600600600",
            "description": "Towar nie spelnia oczekiwan zgloszenia testowego.",
            "reason": "Test automatyczny API",
            "attachments": ["photo.png"],
        }
        _, data = self.request("POST", "/api/cases", payload, expected=(200, 201))
        case = self.object_from(data, "case")
        self.assertTrue(case.get("id"), data)
        self.assertTrue(case.get("number"), data)
        self.assertEqual(case.get("type"), case_type)
        return case

    def case_by_id(self, case_id, token=None):
        token = token or self.login(EMPLOYEE_EMAIL)
        _, data = self.request("GET", "/api/cases", token=token, expected=200)
        cases = self.list_from(data, "cases")
        for case in cases:
            if case.get("id") == case_id:
                return case
        self.fail(f"case {case_id} not found in /api/cases response: {data}")

    def test_bootstrap_returns_seeded_cases_orders_and_config(self):
        _, data = self.request("GET", "/api/bootstrap", expected=200)

        orders = self.list_from(data.get("orders") if isinstance(data, dict) else data, "orders")
        cases = self.list_from(data.get("cases") if isinstance(data, dict) else data, "cases")
        config = data.get("config") if isinstance(data, dict) else None

        self.assertGreaterEqual(len(orders), 3)
        self.assertGreaterEqual(len(cases), 2)
        self.assertIsInstance(config, dict)
        self.assertEqual(config.get("complaintDeadlineDays"), 30)
        self.assertEqual(config.get("returnDeadlineDays"), 14)

    def test_login_works_and_protected_endpoint_rejects_without_token(self):
        self.request("GET", "/api/auth/me", expected=(401, 403))

        token = self.login(EMPLOYEE_EMAIL)
        _, data = self.request("GET", "/api/auth/me", token=token, expected=200)
        user = self.object_from(data, "user")

        self.assertEqual(user.get("email"), EMPLOYEE_EMAIL)
        self.assertEqual(user.get("role"), "PRACOWNIK_OBSLUGI")

    def test_public_create_case_validates_order_and_persists(self):
        self.request(
            "POST",
            "/api/cases",
            {
                "type": "REKLAMACJA",
                "channel": "ONLINE",
                "orderNumber": "ORD-404",
                "email": "piotr.zielinski@example.com",
                "description": "Nie powinno przejsc walidacji.",
                "reason": "Brak zamowienia",
            },
            expected=(400, 404, 422),
        )

        _, verify_data = self.request(
            "POST",
            "/api/orders/verify",
            {"orderNumber": "ORD-2026-1003", "email": "piotr.zielinski@example.com"},
            expected=200,
        )
        verified_order = self.object_from(verify_data, "order")
        self.assertEqual(verified_order.get("number"), "ORD-2026-1003")

        created = self.create_case("REKLAMACJA")
        self.assertTrue(created["number"].startswith("REC-"))
        self.assertEqual(created.get("status"), "NOWE")

        persisted = self.case_by_id(created["id"])
        self.assertEqual(persisted.get("number"), created["number"])

    def test_public_status_lookup_works(self):
        created = self.create_case("REKLAMACJA")

        path = f"/api/cases/status?number={created['number']}&email=piotr.zielinski@example.com"
        _, data = self.request("GET", path, expected=200)
        found = self.object_from(data, "case")

        self.assertEqual(found.get("number"), created["number"])
        self.assertEqual(found.get("email"), "piotr.zielinski@example.com")
        self.assertEqual(found.get("status"), "NOWE")

    def test_status_update_writes_history_and_notification(self):
        token = self.login(EMPLOYEE_EMAIL)
        created = self.create_case("REKLAMACJA")

        _, data = self.request(
            "PUT",
            f"/api/cases/{created['id']}/status",
            {"status": "W_TRAKCIE", "comment": "Smoke test: przyjeto do kolejki obslugi."},
            token=token,
            expected=200,
        )
        updated = self.object_from(data, "case")

        self.assertEqual(updated.get("status"), "W_TRAKCIE")
        self.assertTrue(
            any(
                entry.get("status") == "W_TRAKCIE"
                and "przyjeto do kolejki" in entry.get("comment", "")
                for entry in updated.get("history", [])
            ),
            updated,
        )

        _, notifications_data = self.request("GET", "/api/notifications", token=token, expected=200)
        notifications = self.list_from(notifications_data, "notifications")
        self.assertTrue(
            any(
                item.get("caseNumber") == created["number"]
                and item.get("type") in ("STATUS", "STATUS_CHANGE")
                for item in notifications
            ),
            notifications,
        )

    def test_rejection_decision_requires_justification_and_decision_is_immutable(self):
        token = self.login(EMPLOYEE_EMAIL)
        created = self.create_case("REKLAMACJA")

        self.request(
            "POST",
            f"/api/cases/{created['id']}/decision",
            {"type": "ODRZUCENIE", "justification": "   "},
            token=token,
            expected=(400, 422),
        )

        _, data = self.request(
            "POST",
            f"/api/cases/{created['id']}/decision",
            {"type": "ZWROT_GOTOWKI", "justification": "Reklamacja zasadna."},
            token=token,
            expected=(200, 201),
        )
        decided = self.object_from(data, "case")
        self.assertEqual(decided.get("status"), "ROZPATRZONE")
        self.assertEqual(decided.get("decision", {}).get("type"), "ZWROT_GOTOWKI")

        self.request(
            "POST",
            f"/api/cases/{created['id']}/decision",
            {"type": "NAPRAWA", "justification": "Proba zmiany decyzji."},
            token=token,
            expected=(400, 409, 422),
        )
        persisted = self.case_by_id(created["id"], token=token)
        self.assertEqual(persisted.get("decision", {}).get("type"), "ZWROT_GOTOWKI")

    def test_return_label_and_wms_receipt_flow(self):
        token = self.login(EMPLOYEE_EMAIL)
        created = self.create_case("ZWROT")

        _, label_data = self.request(
            "POST",
            f"/api/cases/{created['id']}/return-label",
            {"courier": "InPost"},
            token=token,
            expected=(200, 201),
        )
        waiting = self.object_from(label_data, "case")
        label = waiting.get("returnLabel") or waiting.get("returnShipment") or {}

        self.assertEqual(waiting.get("status"), "OCZEKUJE_NA_TOWAR")
        self.assertEqual(label.get("courier"), "InPost")
        self.assertTrue(label.get("trackingNumber"), waiting)

        _, receipt_data = self.request(
            "POST",
            f"/api/cases/{created['id']}/wms-receipt",
            {"condition": "Towar kompletny"},
            token=token,
            expected=200,
        )
        received = self.object_from(receipt_data, "case")
        self.assertEqual(received.get("status"), "W_TRAKCIE")
        self.assertTrue(
            any("Magazyn" in entry.get("comment", "") or "WMS" in entry.get("actor", "") for entry in received.get("history", [])),
            received,
        )

    def test_deadline_evaluation_creates_alert_and_escalation(self):
        admin_token = self.login(ADMIN_EMAIL)
        manager_token = self.login(MANAGER_EMAIL)
        self.request(
            "PUT",
            "/api/config",
            {"alertThresholdDays": 99999, "staleEscalationDays": 99999},
            token=admin_token,
            expected=200,
        )
        created = self.create_case("REKLAMACJA")

        self.request(
            "POST",
            "/api/deadlines/evaluate",
            {"now": "2026-06-05"},
            token=manager_token,
            expected=200,
        )
        alerted = self.case_by_id(created["id"], token=manager_token)
        self.assertTrue(
            any("Alert terminu" in entry.get("comment", "") for entry in alerted.get("history", [])),
            alerted,
        )

        self.request(
            "POST",
            "/api/deadlines/evaluate",
            {"now": "2099-01-01"},
            token=manager_token,
            expected=200,
        )
        escalated = self.case_by_id(created["id"], token=manager_token)
        self.assertEqual(escalated.get("status"), "ESKALOWANE")
        self.assertTrue(escalated.get("escalations"), escalated)

        _, notifications_data = self.request("GET", "/api/notifications", token=manager_token, expected=200)
        notifications = self.list_from(notifications_data, "notifications")
        types = {item.get("type") for item in notifications if item.get("caseNumber") == created["number"]}
        self.assertIn("ALERT", types)
        self.assertIn("ESKALACJA", types)

    def test_report_aggregation(self):
        token = self.login(EMPLOYEE_EMAIL)
        case_one = self.create_case("REKLAMACJA")
        self.request(
            "POST",
            f"/api/cases/{case_one['id']}/decision",
            {"type": "ZWROT_GOTOWKI", "justification": "Uznano reklamacje."},
            token=token,
            expected=(200, 201),
        )

        _, data = self.request("GET", "/api/reports", token=self.login(MANAGER_EMAIL), expected=200)
        report = self.object_from(data, "report")

        self.assertGreaterEqual(report.get("total", 0), 3)
        self.assertGreaterEqual(report.get("byType", {}).get("REKLAMACJA", 0), 1)
        self.assertGreaterEqual(report.get("byStatus", {}).get("ROZPATRZONE", 0), 1)
        self.assertIn("acceptedPercent", report)
        self.assertIn("topReasons", report)

    def test_admin_config_update_and_user_create_toggle_are_audited(self):
        token = self.login(ADMIN_EMAIL)

        _, config_data = self.request(
            "PUT",
            "/api/config",
            {
                "complaintDeadlineDays": 31,
                "returnDeadlineDays": 15,
                "alertThresholdDays": 3,
                "staleEscalationDays": 6,
            },
            token=token,
            expected=200,
        )
        config = self.object_from(config_data, "config")
        self.assertEqual(config.get("complaintDeadlineDays"), 31)
        self.assertEqual(config.get("returnDeadlineDays"), 15)

        _, user_data = self.request(
            "POST",
            "/api/users",
            {
                "name": "Karolina Tester",
                "email": "karolina.tester@example.com",
                "role": "PRACOWNIK_OBSLUGI",
                "active": True,
            },
            token=token,
            expected=(200, 201),
        )
        user = self.object_from(user_data, "user")
        self.assertTrue(user.get("id"), user_data)

        _, updated_user_data = self.request(
            "PUT",
            f"/api/users/{user['id']}",
            {
                "name": "Karolina Tester",
                "email": "karolina.tester@example.com",
                "role": "KIEROWNIK",
                "active": True,
            },
            token=token,
            expected=200,
        )
        updated_user = self.object_from(updated_user_data, "user")
        self.assertEqual(updated_user.get("role"), "KIEROWNIK")

        _, toggled_data = self.request(
            "POST",
            f"/api/users/{user['id']}/toggle",
            token=token,
            expected=200,
        )
        toggled_user = self.object_from(toggled_data, "user")
        self.assertFalse(toggled_user.get("active"))

        _, audit_data = self.request("GET", "/api/audit-log", token=token, expected=200)
        audit_log = self.list_from(audit_data, "auditLog")
        actions = {entry.get("action") for entry in audit_log}
        self.assertIn("CONFIG_UPDATE", actions)
        self.assertIn("USER_CREATE", actions)
        self.assertIn("USER_UPDATE", actions)
