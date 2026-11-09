'use strict';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
let current = LEVELS.info;
// Secretos que nunca deben aparecer en el log (token de Hispashare, apikey).
const secrets = new Set();

function setLevel(name) {
  current = LEVELS[name] ?? LEVELS.info;
}

function addSecret(value) {
  if (value && value.length >= 4) secrets.add(value);
}

function redact(text) {
  let out = String(text);
  for (const s of secrets) out = out.split(s).join('***');
  return out;
}

function write(level, args) {
  if (LEVELS[level] < current) return;
  const msg = args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${redact(msg)}`;
  (level === 'error' || level === 'warn' ? console.error : console.log)(line);
}

module.exports = {
  setLevel,
  addSecret,
  redact,
  debug: (...a) => write('debug', a),
  info: (...a) => write('info', a),
  warn: (...a) => write('warn', a),
  error: (...a) => write('error', a),
};
