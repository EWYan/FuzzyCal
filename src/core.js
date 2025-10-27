// Core logic extracted for Node testing and reuse in extension

function validateExpression(expr) {
  if (!expr || !expr.trim()) return '请输入表达式';
  const disallowed = /["'`\\;]/; // reject quotes, backslashes, semicolons
  if (disallowed.test(expr)) return '包含不安全字符';

  const allowedWords = new Set([
    'pi','PI','e','E',
    'sin','cos','tan','asin','acos','atan','atan2',
    'pow','sqrt','abs','log','ln','exp','min','max',
    'floor','ceil','round','trunc'
  ]);

  const wordRe = /[A-Za-z_]+/g;
  let m;
  while ((m = wordRe.exec(expr)) !== null) {
    const w = m[0];
    if (!allowedWords.has(w)) {
      return `不支持的标识符: ${w}`;
    }
  }
  return undefined;
}

function evaluateExpression(expr, opts) {
  try {
    return evaluateExpressionMapped(expr);
  } catch (err) {
    if (!opts || !opts._leadingZeroHexTried) {
      const converted = promoteLeadingZeroNumbers(expr);
      if (converted && converted !== expr) {
        return evaluateExpression(converted, { _leadingZeroHexTried: true });
      }
    }
    throw err;
  }
}

function evaluateExpressionMapped(expr) {
  const map = {
    'pi': 'Math.PI', 'PI': 'Math.PI', 'e': 'Math.E', 'E': 'Math.E',
    'sin': 'Math.sin', 'cos': 'Math.cos', 'tan': 'Math.tan',
    'asin': 'Math.asin', 'acos': 'Math.acos', 'atan': 'Math.atan', 'atan2': 'Math.atan2',
    'pow': 'Math.pow', 'sqrt': 'Math.sqrt', 'abs': 'Math.abs', 'log': 'Math.log', 'ln': 'Math.log',
    'exp': 'Math.exp', 'min': 'Math.min', 'max': 'Math.max',
    'floor': 'Math.floor', 'ceil': 'Math.ceil', 'round': 'Math.round', 'trunc': 'Math.trunc'
  };

  let s = expr;
  // Avoid replacing inside already-mapped tokens (e.g., don't turn Math.PI into Math.Math.PI)
  for (const [k, v] of Object.entries(map)) {
    const re = new RegExp(`(?<![A-Za-z0-9_\.])${k}\\b`, 'g');
    s = s.replace(re, v);
  }
  s = s.replace(/\^/g, '**');

  const fn = new Function('"use strict"; return (' + s + ');');
  return fn();
}

function promoteLeadingZeroNumbers(expr) {
  if (!expr || typeof expr !== 'string') return expr;
  let converted = false;
  const replaced = expr.replace(/\b0[0-9a-fA-F_]{2,}\b/g, (match) => {
    if (/^0+$/.test(match)) return match;
    converted = true;
    return '0x' + match.replace(/_/g, '');
  });
  return converted ? replaced : expr;
}

function buildNumberResults(value) {
  const items = [];
  const asNumber = Number(value);
  if (Number.isInteger(asNumber) && Math.abs(asNumber) <= Number.MAX_SAFE_INTEGER) {
    const n = BigInt(asNumber);
    items.push({ label: `${asNumber}`, description: 'Dec' });
    items.push({ label: toHex(n), description: 'Hex' });
    items.push({ label: toBin(n), description: 'Bin' });
    items.push({ label: toOct(n), description: 'Oct' });
  } else {
    items.push({ label: `${asNumber}`, description: 'Dec (float or large)' });
  }
  return items;
}

function parseBaseSpec(s) {
  const str = s.trim();
  const arrow = /(.*?)(?:\-\>|\s+to\s+)(.*)/i;
  const m = str.match(arrow);
  if (m) {
    return { left: m[1].trim(), right: m[2].trim() };
  }
  return { left: str, right: '' };
}

function detectBaseFromTag(tag) {
  const t = tag.toLowerCase();
  if (t === 'hex' || t === '16' || t === '0x') return 16;
  if (t === 'dec' || t === '10') return 10;
  if (t === 'bin' || t === '2' || t === '0b') return 2;
  if (t === 'oct' || t === '8' || t === '0o' || t === '0') return 8;
  const n = Number.parseInt(t, 10);
  if (n >= 2 && n <= 36) return n;
  return undefined;
}

function convertBases(input) {
  const { left, right } = parseBaseSpec(input);
  const mBaseHash = left.match(/^\s*(\d{1,2})\s*#\s*([\-+]?[0-9a-zA-Z_]+)\s*$/);
  let valueBigInt, fromBase;
  if (mBaseHash) {
    fromBase = clampBase(Number(mBaseHash[1]));
    valueBigInt = parseBigIntBase(mBaseHash[2], fromBase);
  } else {
    const mBaseWord = left.match(/^\s*base\s*(\d{1,2})\s+([\-+]?[0-9a-zA-Z_]+)\s*$/i);
    if (mBaseWord) {
      fromBase = clampBase(Number(mBaseWord[1]));
      valueBigInt = parseBigIntBase(mBaseWord[2], fromBase);
    } else {
      valueBigInt = parseBigIntAuto(left);
    }
  }

  const targetBase = right ? detectBaseFromTag(right) : undefined;
  const res = {
    hex: toHex(valueBigInt),
    dec: valueBigInt.toString(10),
    bin: toBin(valueBigInt),
    oct: toOct(valueBigInt)
  };
  if (targetBase && right) {
    return { ...res, first: formatBase(valueBigInt, targetBase) };
  }
  return res;
}

function clampBase(b) {
  if (b < 2) return 2;
  if (b > 36) return 36;
  return b;
}

function parseBigIntAuto(s) {
  let str = s.trim();
  let sign = 1n;
  if (str.startsWith('+')) str = str.slice(1);
  if (str.startsWith('-')) { sign = -1n; str = str.slice(1); }
  str = str.replace(/_/g, '');
  if (/^0[0-9]+$/i.test(str)) {
    const parsed = safeBigInt('0x' + str);
    if (parsed !== undefined) return sign * parsed;
  }
  if (/^0[0-9a-f]+$/i.test(str) && /[a-f]/i.test(str)) {
    const parsedHex = safeBigInt('0x' + str);
    if (parsedHex !== undefined) return sign * parsedHex;
  }
  const lower = str.toLowerCase();
  if (lower.startsWith('0x')) return sign * BigInt('0x' + str.slice(2));
  if (lower.startsWith('0b')) return sign * BigInt('0b' + str.slice(2));
  if (lower.startsWith('0o')) return sign * BigInt('0o' + str.slice(2));
  if (/^[0-9a-f]+h$/i.test(str)) return sign * BigInt('0x' + str.slice(0, -1));
  if (/^[01]+b$/i.test(str)) return sign * BigInt('0b' + str.slice(0, -1));
  if (/^[0-7]+o$/i.test(str)) return sign * BigInt('0o' + str.slice(0, -1));
  if (/^[0-9]+$/.test(str)) return sign * BigInt(str);
  // If it's pure hex digits/letters and has at least one A-F, treat as hex
  if (/^[0-9a-f]+$/i.test(str) && /[a-f]/i.test(str)) return sign * BigInt('0x' + str);
  throw new Error('无法识别的数字格式');
}

function safeBigInt(text) {
  try {
    return BigInt(text);
  } catch {
    return undefined;
  }
}

function parseBigIntBase(s, base) {
  const clean = s.replace(/_/g, '').trim();
  const sign = clean.startsWith('-') ? -1n : 1n;
  const body = clean.replace(/^[-+]/, '').toLowerCase();
  const digits = '0123456789abcdefghijklmnopqrstuvwxyz';
  const maxIdx = base - 1;
  let acc = 0n;
  for (const ch of body) {
    const idx = BigInt(digits.indexOf(ch));
    if (idx < 0n || Number(idx) > maxIdx) throw new Error('超出基数的字符');
    acc = acc * BigInt(base) + idx;
  }
  return sign * acc;
}

function toHex(n) { return (n < 0n ? '-0x' + (-n).toString(16) : '0x' + n.toString(16)).toUpperCase(); }
function toBin(n) { return (n < 0n ? '-0b' + (-n).toString(2) : '0b' + n.toString(2)); }
function toOct(n) { return (n < 0n ? '-0o' + (-n).toString(8) : '0o' + n.toString(8)); }

function formatBase(n, base) {
  const prefix = base === 16 ? '0x' : base === 2 ? '0b' : base === 8 ? '0o' : '';
  const body = (n < 0n ? (-n).toString(base) : n.toString(base));
  return (n < 0n ? '-' : '') + (prefix || '') + (base === 16 ? body.toUpperCase() : body);
}

// --- Safer validator that ignores numeric tokens so hex like 0xAB doesn't look like identifier 'xab'
function stripNumericTokens(input) {
  let s = String(input);
  const reps = [
    /[+-]?\s*0x[0-9a-f_]+/gi,
    /[+-]?\s*0b[01_]+/gi,
    /[+-]?\s*0o[0-7_]+/gi,
    /[+-]?\s*[0-9a-f_]+h\b/gi,
    /\b0[0-9a-f_]+\b/gi,
    /[+-]?\s*[01_]+b\b/gi,
    /[+-]?\s*[0-7_]+o\b/gi,
    /[+-]?\s*\d{1,2}\s*#\s*[0-9a-z_]+/gi,
    /[+-]?\s*base\s*\d{1,2}\s+[0-9a-z_]+/gi,
    /[+-]?\s*(?:\d[0-9_]*)(?:\.\d[0-9_]*)?/g,
  ];
  for (const re of reps) s = s.replace(re, '0');
  return s;
}

function validateExpressionFixed(expr) {
  if (!expr || !String(expr).trim()) return '请输入表达式';
  if (/["'`\\;]/.test(expr)) return '包含不安全字符';
  const allowed = new Set(['pi','PI','e','E','sin','cos','tan','asin','acos','atan','atan2','pow','sqrt','abs','log','ln','exp','min','max','floor','ceil','round','trunc']);
  const cleaned = stripNumericTokens(String(expr));
  const wordRe = /[A-Za-z_]+/g;
  let m;
  while ((m = wordRe.exec(cleaned)) !== null) {
    const w = m[0];
    if (!allowed.has(w)) return `不支持的标识符: ${w}`;
  }
  return undefined;
}

module.exports = {
  validateExpression: validateExpressionFixed,
  evaluateExpression,
  buildNumberResults,
  convertBases,
  parseBigIntAuto,
  parseBigIntBase,
  toHex,
  toBin,
  toOct,
  formatBase,
};
