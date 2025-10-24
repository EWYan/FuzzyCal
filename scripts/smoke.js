/* Simple smoke tests for core logic (run with: node scripts/smoke.js) */
const core = require('../src/core');

function testExpressions() {
  const cases = [
    { expr: '(2+3*4)/5', expect: 2.8 },
    { expr: 'sin(pi/6)', expect: 0.5 },
    { expr: '0xff + 42', expect: 297 },
    { expr: '2^10', expect: 1024 },
    { expr: 'log(e)', expect: 1 },
  ];
  console.log('--- Expression tests ---');
  for (const c of cases) {
    const v = core.evaluateExpression(c.expr);
    const ok = Math.abs(v - c.expect) < 1e-9;
    console.log(`${c.expr} = ${v} ${ok ? 'OK' : `EXPECTED ${c.expect}`}`);
  }
}

function testConversions() {
  const inputs = [
    'FF -> dec',
    '1010b -> hex',
    '16#FF',
    'base2 1010',
    '-0b1010',
    '255',
    '0xFF',
  ];
  console.log('\n--- Base conversion tests ---');
  for (const s of inputs) {
    const r = core.convertBases(s);
    console.log(`${s} => dec=${r.dec} hex=${r.hex} bin=${r.bin} oct=${r.oct}`);
  }
}

testExpressions();
testConversions();

