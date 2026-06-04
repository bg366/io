import sqlite3

from .settings import DB_PATH

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
            from .demo import seed_demo

            seed_demo(conn)

def table_empty(conn, table):
    return conn.execute(f"SELECT COUNT(*) AS count FROM {table}").fetchone()["count"] == 0
