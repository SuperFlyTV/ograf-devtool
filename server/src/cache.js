class Cache {
  constructor() {
    this.cache = {};
  }

  get(key) {
    const entry = this.cache[key];
    if (!entry) return null;

    if (entry.expires < Date.now()) {
      delete this.cache[key];
      return null;
    }

    return entry.value;
  }

  set(key, value, ttl) {
    this.cache[key] = {
      value,
      expires: Date.now() + ttl,
    };
  }

  delete(key) {
    delete this.cache[key];
  }

  clear() {
    this.cache = {};
  }
}

module.exports = Cache;
