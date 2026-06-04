import uuid
from datetime import date, datetime, timedelta
from http import HTTPStatus

from .errors import ApiError

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
