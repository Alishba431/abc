import { getServerUrl } from './config';
import { loadSession } from './session';

// Plain-language messages for server error codes (never show raw codes to users).
const MESSAGES = {
  UNAUTHENTICATED: 'Your email or password is incorrect, or your session expired. Please sign in again.',
  FORBIDDEN: "Your account doesn't have permission to do that.",
  OUT_OF_STOCK: 'Sorry, that item just sold out.',
  PAYMENT_DECLINED: 'Your payment was declined. Please try another card.',
  PAYMENT_CAPTURE_FAILED: "We couldn't complete the payment. You have not been charged.",
  INVALID_DISCOUNT_CODE: "That discount code isn't valid.",
  TRANSFER_WINDOW_CLOSED: 'The transfer window is closed for that date.',
  SQUAD_FULL: 'The destination squad is already full.',
  NOT_IN_SQUAD: 'That player is no longer in the selected squad.',
  PLAYER_ON_LOAN: 'That player is currently on loan and cannot be moved.',
  MIN_POSITION_VIOLATION: 'This move would leave the squad without enough players in that position.',
  CROSS_TENANT_TRANSFER: 'Players can only move between clubs of the same organisation.',
  MATCH_NOT_IN_PROGRESS: "The match isn't in progress, so scores can't be recorded.",
  INVALID_COMPENSATION: 'That event has already been corrected or cannot be corrected.',
  RATE_LIMITED: 'Too many requests. Please wait a few seconds and try again.',
  VALIDATION_ERROR: 'Some of the information entered is missing or invalid.',
  INVALID_BASE_VERSION: 'This change was based on newer data than the server has.',
};

export function friendlyError(code, fallback) {
  return MESSAGES[code] || fallback || 'Something went wrong. Please try again.';
}

export class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function api(path, { method = 'GET', body, auth = true, timeoutMs = 8000 } = {}) {
  const base = await getServerUrl();
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const s = await loadSession();
    if (s) headers.Authorization = `Bearer ${s.token}`;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
  } catch (e) {
    throw new ApiError("Can't reach the server. Check your connection and the server address in Settings.", 'NETWORK', 0);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const code = data && data.error ? data.error.code : 'HTTP_' + res.status;
    throw new ApiError(friendlyError(code), code, res.status);
  }
  return data;
}
