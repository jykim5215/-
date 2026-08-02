import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { parseNaraHtml, localSpellCheck, chunkText, checkSpelling, checkWithNara } = require('../src/main/speller');

// nara-speller 응답 형식 픽스처 (hanspell/py-hanspell이 쓰는 `data = [...]` 프로토콜)
const NARA_FIXTURE = `<html><script>
page = 1;
data = [{"str":"나는 학교에 갓다.","errInfo":[{"help":"철자 검사를 해 보니 이 어절은 분석할 수 없으므로 <br/>철자가 틀린 것으로 판단합니다.","errorIdx":0,"correctMethod":1,"start":7,"end":9,"orgStr":"갓다","candWord":"갔다|갔다가"}],"idx":0}];
</script></html>`;

test('nara 응답 파싱 — data JSON + candWord 분할 + help 태그 제거', () => {
  const items = parseNaraHtml(NARA_FIXTURE);
  assert.equal(items.length, 1);
  assert.equal(items[0].orgStr, '갓다');
  assert.deepEqual(items[0].candWords, ['갔다', '갔다가']);
  assert.ok(!items[0].help.includes('<br'));
  assert.equal(parseNaraHtml('<html>no data</html>').length, 0);
  assert.equal(parseNaraHtml('data = [broken;').length, 0);
});

test('checkWithNara — fetch 주입 + 폼 전송 + 중복 제거', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, body: opts.body });
    return { ok: true, text: async () => NARA_FIXTURE };
  };
  const items = await checkWithNara('나는 학교에 갓다.\n\n나는 학교에 갓다.', { fetchImpl });
  assert.equal(calls.length, 2); // 문단별 청크 순차 전송
  assert.ok(calls[0].body.startsWith('text1='));
  assert.equal(items.length, 1); // 동일 교정 중복 제거
});

test('checkSpelling — 서버 실패 시 로컬 폴백', async () => {
  const failFetch = async () => { throw new Error('offline'); };
  const r = await checkSpelling('회의가 잘 됬다. 우리는 갈수 없다.', { fetchImpl: failFetch });
  assert.equal(r.engine, 'local');
  assert.ok(r.naraError);
  const orgs = r.items.map((i) => i.orgStr);
  assert.ok(orgs.includes('됬'));
  assert.ok(orgs.includes('갈수 없'));
});

test('로컬 규칙 검사기 — 확정 패턴', () => {
  const items = localSpellCheck('오랫만에 몇일 쉬었다. 그렇게 하면 안되요? 볼수 있다.');
  const orgs = items.map((i) => i.orgStr);
  assert.ok(orgs.includes('오랫만'));
  assert.ok(orgs.includes('몇일'));
  assert.ok(orgs.includes('되요'));
  assert.ok(orgs.includes('볼수 있'));
  assert.equal(localSpellCheck('맞춤법이 완벽한 문장이다.').length, 0);
});

test('청크 분할 — 문단·문장 경계, 한도 준수', () => {
  const short = chunkText('한 문단.\n\n두 문단.');
  assert.deepEqual(short, ['한 문단.', '두 문단.']);
  const long = '가나다라마바사아자차카타파하 문장이다. '.repeat(40);
  const chunks = chunkText(long, 450);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((c) => c.length <= 460));
});
