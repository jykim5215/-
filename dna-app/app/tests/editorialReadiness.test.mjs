import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { splitDraft, buildEditorialReadiness } = require('../src/shared/editorialReadiness');

test('출고 점검 - 제목, 본문, 확인 필요 항목을 분리한다', () => {
  const parsed = splitDraft('기사 제목\n\n본문입니다.\n\n---확인 필요---\n- 수치 확인\n- 반론 취재');
  assert.equal(parsed.title, '기사 제목');
  assert.equal(parsed.body, '본문입니다.');
  assert.deepEqual(parsed.todos, ['수치 확인', '반론 취재']);
});

test('출고 점검 - 근거 없음, 인용 누락, 미확인 항목은 출고를 막는다', () => {
  const report = buildEditorialReadiness({
    draft: '짧은 제목\n\n본문에 “확인되지 않은 말”이 있다.\n\n---확인 필요---\n- 당사자 반론',
    materials: [],
    quoteResults: [{ text: '확인되지 않은 말', verdict: { status: 'missing' } }],
  });
  assert.equal(report.ready, false);
  assert.deepEqual(report.blockers.map((item) => item.id).sort(), ['quotes', 'sources', 'todos']);
  assert.ok(report.score < 60);
});

test('출고 점검 - 충분한 본문, 복수 출처, 일치 인용이면 통과한다', () => {
  const report = buildEditorialReadiness({
    draft: `근거를 갖춘 기사 제목\n\n${'기사 본문 문장입니다. '.repeat(40)}`,
    materials: [
      { source: '학생회 공식 답변' },
      { source: '정보공개청구 자료' },
    ],
    quoteResults: [{ text: '원문 인용', verdict: { status: 'exact' } }],
  });
  assert.equal(report.ready, true);
  assert.equal(report.blockers.length, 0);
  assert.equal(report.score, 100);
  assert.equal(report.metrics.sourceCount, 2);
});

test('출고 점검 - 드롭 시 만든 임시 출처는 실제 취재 근거로 계산하지 않는다', () => {
  const report = buildEditorialReadiness({
    draft: `기사 제목입니다\n\n${'기사 본문입니다. '.repeat(40)}`,
    materials: [{ source: '로컬 파일 · answer.pdf (출처 보완 필요)' }],
    quoteResults: [],
  });
  assert.equal(report.metrics.materialCount, 1);
  assert.equal(report.metrics.sourceCount, 0);
  assert.equal(report.checks.find((item) => item.id === 'sources').status, 'block');
});
