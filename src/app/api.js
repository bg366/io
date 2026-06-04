import { session } from "./state.js";

export async function apiRequest(path, options = {}) {
  const {
    method = "GET",
    body,
    requireAuth = false,
    skipAuth = false,
  } = options;

  if (requireAuth && !session.token) {
    throw new Error("Ta operacja wymaga zalogowania i odpowiedniej roli.");
  }

  const headers = {
    Accept: "application/json",
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (!skipAuth && session.token) {
    headers.Authorization = `Bearer ${session.token}`;
  }

  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("Nie mozna polaczyc sie z backendem API. Sprawdz, czy serwer jest uruchomiony.");
  }

  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(apiErrorMessage(response, payload));
  }
  return payload;
}
export async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}
export function apiErrorMessage(response, payload) {
  if (payload?.message) return payload.message;
  if (payload?.error?.message) return payload.error.message;
  if (typeof payload?.error === "string") return payload.error;
  if (payload?.details) return Array.isArray(payload.details) ? payload.details.join(", ") : payload.details;
  if (response.status === 401) return "Nie jestes zalogowany albo sesja wygasla.";
  if (response.status === 403) return "Brak uprawnien do tej operacji.";
  if (response.status === 404) return "Nie znaleziono zasobu w API.";
  return `API zwrocilo blad ${response.status}.`;
}
