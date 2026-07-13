import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { parseAddressEntries, mergeContacts, searchContacts } = require('../src/main/contacts');

test('contacts — 주소 파싱: 이름 <이메일>, 나열, 혼합', () => {
  assert.deepEqual(parseAddressEntries('동아리연합회 <council@dgist.ac.kr>'), [
    { name: '동아리연합회', email: 'council@dgist.ac.kr' },
  ]);
  assert.deepEqual(parseAddressEntries('a@dgist.ac.kr, b@dgist.ac.kr'), [
    { name: '', email: 'a@dgist.ac.kr' },
    { name: '', email: 'b@dgist.ac.kr' },
  ]);
  const mixed = parseAddressEntries('"학생팀" <st@dgist.ac.kr>; plain@dgist.ac.kr');
  assert.equal(mixed.length, 2);
  assert.equal(mixed[0].name, '학생팀');
  assert.equal(mixed[1].email, 'plain@dgist.ac.kr');
  assert.deepEqual(parseAddressEntries('not-an-email'), []);
});

test('contacts — 병합: 중복은 count 증가, 이름은 더 긴 쪽 유지', () => {
  let list = mergeContacts([], ['council@dgist.ac.kr'], '2026-07-01T00:00:00Z');
  list = mergeContacts(list, ['동아리연합회 <council@dgist.ac.kr>', 'new@dgist.ac.kr'], '2026-07-02T00:00:00Z');
  const c = list.find((x) => x.email === 'council@dgist.ac.kr');
  assert.equal(c.count, 2);
  assert.equal(c.name, '동아리연합회');
  assert.equal(list.length, 2);
  // 자주 쓴 주소가 앞으로
  assert.equal(list[0].email, 'council@dgist.ac.kr');
});

test('contacts — 검색: 이름/이메일 부분일치, 대소문자 무시', () => {
  const list = mergeContacts([], ['동아리연합회 <council@dgist.ac.kr>', '학생팀 <student@dgist.ac.kr>']);
  assert.equal(searchContacts(list, 'coun')[0].email, 'council@dgist.ac.kr');
  assert.equal(searchContacts(list, '학생팀')[0].email, 'student@dgist.ac.kr');
  assert.equal(searchContacts(list, 'COUNCIL').length, 1);
  assert.equal(searchContacts(list, '').length, 2); // 빈 검색 = 상위 목록
});
