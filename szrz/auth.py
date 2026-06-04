import base64
import hashlib
import hmac
import json
import secrets
import time
from http import HTTPStatus

from .db import connect
from .errors import ApiError
from .repository import user_to_dict
from .settings import ROLE_RANK, SECRET, TOKEN_TTL_SECONDS

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
