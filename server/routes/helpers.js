'use strict';

// Small shared helpers for route handlers — no external validation library,
// keeping the dependency footprint light.

// Wrap an async handler so thrown/rejected errors reach the Express error handler.
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// Throw a 400 with a message the client can display.
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function badRequest(message) {
  throw new HttpError(400, message);
}

function requireFields(body, fields) {
  for (const f of fields) {
    const v = body[f];
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
      badRequest(`Missing required field: ${f}`);
    }
  }
}

function toInt(value, field) {
  const n = Number(value);
  if (!Number.isInteger(n)) badRequest(`${field} must be an integer`);
  return n;
}

function toNumber(value, field) {
  const n = Number(value);
  if (Number.isNaN(n)) badRequest(`${field} must be a number`);
  return n;
}

module.exports = { asyncHandler, HttpError, badRequest, requireFields, toInt, toNumber };
