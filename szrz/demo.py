from .auth import hash_password
from .settings import DEFAULT_CONFIG
from .services import audit, create_case_record, generate_label_record, update_status_record
from .utils import today_iso

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
