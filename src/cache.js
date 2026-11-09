'use strict';

// Caché en memoria con caducidad por entrada. Las entradas caducadas se
// conservan (hasta maxEntries) para poder servirlas «rancias» si la API
// devuelve 429.
class TtlCache {
  constructor({ maxEntries = 500, now = () => Date.now() } = {}) {
    this.maxEntries = maxEntries;
    this.now = now;
    this.map = new Map();
  }

  set(key, value, ttlSeconds) {
    this.map.delete(key);
    this.map.set(key, { value, expires: this.now() + ttlSeconds * 1000 });
    while (this.map.size > this.maxEntries) {
      this.map.delete(this.map.keys().next().value);
    }
  }

  // Devuelve el valor solo si no ha caducado.
  get(key) {
    const e = this.map.get(key);
    if (!e || e.expires <= this.now()) return undefined;
    return e.value;
  }

  // Devuelve el valor aunque haya caducado.
  getStale(key) {
    const e = this.map.get(key);
    return e ? e.value : undefined;
  }

  clear() {
    this.map.clear();
  }
}

module.exports = { TtlCache };
