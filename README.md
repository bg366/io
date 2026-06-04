# SZRZ complaint and return PoC

SZRZ is a proof of concept for handling complaints (`REKLAMACJA`) and returns (`ZWROT`) from customer intake through employee processing, deadline monitoring, decisions, notifications, and admin configuration.

## Stack

- Frontend: dependency-free HTML, CSS, and JavaScript.
- Domain PoC: JavaScript modules in `src/` with Node's built-in test runner.
- Backend target: Python standard library HTTP server in `server.py`.
- Database target: SQLite, configured with the `SZRZ_DB` environment variable.
- API tests: Python `unittest` using `http.client`, `subprocess`, `tempfile`, and JSON.

## Run

Start the backend API:

```bash
python3 server.py
```

For an explicit database and port:

```bash
SZRZ_DB=data/szrz.sqlite PORT=8000 python3 server.py
```

Open `http://127.0.0.1:8000/`. The Python server serves both the frontend and `/api/*`; opening `index.html` directly will not work for API calls.

## Test

Run the Python API verification with `unittest` discovery:

```bash
python3 -m unittest discover -s test -p '*_test.py'
```

Run the JavaScript domain tests:

```bash
node --test
```

If `package.json` scripts are available:

```bash
npm test
npm run test:api
npm run test:frontend
```

The API tests start `server.py` on a free local port, set `SZRZ_DB` to a temporary SQLite database, exercise the HTTP endpoints, and stop the process.

## Demo Credentials

All seeded demo accounts use password `demo123`.

| Role | Email |
| --- | --- |
| Employee | `marta.ops@example.com` |
| Manager | `tomasz.manager@example.com` |
| Admin | `ewa.admin@example.com` |

Seeded customer orders:

| Order | Customer email |
| --- | --- |
| `ORD-2026-1001` | `jan.kowalski@example.com` |
| `ORD-2026-1002` | `anna.nowak@example.com` |
| `ORD-2026-1003` | `piotr.zielinski@example.com` |

## Mocked Or Skipped

Implemented as local mocks for the PoC:

- ERP order verification: local seeded order records.
- ERP refunds: local decision/refund intent only.
- WMS: local receipt endpoint.
- Email/SMS: in-app notification outbox.
- Courier labels: generated placeholder courier/tracking data.
- E-commerce sync: omitted or represented as local case/order state.

Skipped production concerns:

- Real external ERP, WMS, e-commerce, SMS, email, and carrier integrations.
- Redis, RabbitMQ, Celery workers, and separate report workers.
- Production JWT refresh-token hardening and token blacklist.
- Real file upload storage, antivirus scanning, and carrier PDF generation.
- Deployment, backups, SLA/RPO/RTO automation, and full GDPR retention workflows.
- Full WCAG/i18n audit.

## Endpoint Summary

Public/demo endpoints:

- `GET /api/bootstrap` - return seeded cases, orders, users, config, notifications, and audit data.
- `POST /api/reset-demo` - reset demo data in the configured SQLite database.
- `GET /api/orders` - list seeded mock ERP orders.
- `POST /api/orders/verify` - verify `{ "orderNumber": "...", "email": "..." }`.
- `POST /api/cases` - create a complaint or return case.
- `GET /api/cases/status?number=REC-2026-00001&email=jan.kowalski@example.com` - public status lookup.

Authentication:

- `POST /api/auth/login` - login with email/password and return an access token.
- `GET /api/auth/me` - return the authenticated user; requires bearer token.

Case processing:

- `GET /api/cases` - list cases; requires employee, manager, or admin.
- `PUT /api/cases/{id}/status` - update status and write history/notification.
- `POST /api/cases/{id}/decision` - create immutable final decision.
- `POST /api/cases/{id}/escalate` - manually escalate a case.
- `POST /api/cases/{id}/return-label` - generate placeholder return label/tracking.
- `POST /api/cases/{id}/wms-receipt` - mock warehouse receipt confirmation.
- `POST /api/deadlines/evaluate` - evaluate deadline alerts/escalations; accepts optional `{ "now": "YYYY-MM-DD" }` for deterministic tests.

Reporting and administration:

- `GET /api/reports` - aggregate totals, status/type counts, decision percentages, and top reasons.
- `GET /api/users` - list users.
- `POST /api/users` - create user.
- `PUT /api/users/{id}` - update user.
- `POST /api/users/{id}/toggle` - activate/deactivate user.
- `GET /api/config` - read deadline/escalation config.
- `PUT /api/config` - update deadline/escalation config.
- `GET /api/notifications` - list notification outbox records.
- `GET /api/audit-log` - list audit events.

## Core Rules

- Case numbers use `REC-RRRR-NNNNN` for complaints and `ZWR-RRRR-NNNNN` for returns.
- Complaint deadline defaults to 30 days.
- Return deadline defaults to 14 days.
- Alert threshold defaults to 2 days.
- Stale escalation defaults to 5 days without status change.
- Rejection decisions require a non-empty justification.
- Approved decisions are immutable.
- Status changes, labels, WMS receipts, decisions, config updates, and user changes should create history, notifications, or audit records as appropriate.
