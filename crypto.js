// Commit-reveal на SHA-256 через crypto.subtle.
// Работает одинаково в браузере (HTTPS или localhost) и в Node 20+ (globalThis.crypto).

const subtle = globalThis.crypto.subtle;

// Каноничная сериализация: ключи объектов сортируются,
// чтобы одинаковые данные давали одинаковый хэш у обоих игроков.
function canonical(value) {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

// Случайная соль: 16 байт в hex (32 символа).
export function makeSalt() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return toHex(bytes);
}

// Хэш коммита: sha256(каноничный JSON данных + ':' + соль), hex.
export async function commit(data, salt) {
  if (typeof salt !== 'string' || salt.length < 16) throw new Error('commit: слишком короткая соль');
  const text = canonical(data) + ':' + salt;
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return toHex(digest);
}

// Проверка раскрытия: данные и соль дают тот же хэш.
export async function verify(data, salt, hash) {
  if (typeof hash !== 'string' || typeof salt !== 'string') return false;
  try {
    return (await commit(data, salt)) === hash.toLowerCase();
  } catch {
    return false;
  }
}

export { canonical };
