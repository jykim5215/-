import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { Store } = require('../src/main/db');
const projects = require('../src/main/projects');
const records = require('../src/main/records');

test('저장 계층 + 학습 레코드 파이프라인', async () => {
  const store = await Store.open(null); // 메모리 전용

  // 프로젝트 + 자료
  const pid = projects.createProject(store, { title: '조정부 승격', keywords: ['조정부', '학생단체 승격'] });
  assert.ok(pid);
  assert.equal(projects.listProjects(store).length, 1);

  // 출처 없는 자료는 저장 불가
  assert.throws(
    () => projects.addMaterial(store, { projectId: pid, kind: 'note', title: 'x', content: 'y', source: '  ' }),
    /출처/
  );
  projects.addMaterial(store, {
    projectId: pid, kind: 'transcript', title: '녹취', content: '지난 2년간 실적을 쌓아 왔다.', source: '직접 취재',
  });
  assert.equal(projects.listMaterials(store, pid).length, 1);

  // 레코드: AI 초안 → 최종본 → edit distance
  const rid = records.createRecord(store, {
    projectId: pid, stage: 'draft',
    input: { keywords: ['조정부'] },
    aiOutput: '조정부가 승격되었다.',
    modelVersion: 'claude-opus-4-8+prompts/v1/draft_writer',
  });
  const dist = records.finalizeRecord(store, rid, '조정부가 학생단체로 승격되었다.');
  assert.ok(dist > 0);

  records.setFeedback(store, rid, { rating: 4, tags: ['구조 좋음'] });
  assert.throws(() => records.setFeedback(store, rid, { rating: 9 }), /1~5/);

  // 지표
  const m = records.metrics(store);
  assert.equal(m.length, 1);
  assert.equal(m[0].stage, 'draft');
  assert.equal(m[0].avg_rating, 4);

  // 산출물 버전 관리
  const v1 = projects.saveStageOutput(store, { projectId: pid, stage: 'draft', content: 'v1' });
  const v2 = projects.saveStageOutput(store, { projectId: pid, stage: 'draft', content: 'v2' });
  assert.equal(v1.version, 1);
  assert.equal(v2.version, 2);
  assert.equal(projects.latestStageOutput(store, pid, 'draft').content, 'v2');
});

test('개인정보 마스킹 export', async () => {
  const store = await Store.open(null);
  const pid = projects.createProject(store, { title: 't', keywords: [] });
  records.createRecord(store, {
    projectId: pid, stage: 'draft',
    input: { context: '취재원 김민준, 연락처 010-1234-5678, kim@dgist.ac.kr' },
    aiOutput: '김민준 학생은 010-1234-5678로 연락 가능하다.',
    modelVersion: 'test',
  });

  const jsonl = records.exportDataset(store, { maskNames: ['김민준'] });
  assert.ok(!jsonl.includes('010-1234-5678'), '전화번호 마스킹');
  assert.ok(!jsonl.includes('kim@dgist.ac.kr'), '이메일 마스킹');
  assert.ok(!jsonl.includes('김민준'), '실명 마스킹');
  assert.ok(jsonl.includes('김○○'), '이니셜 처리');
  assert.ok(jsonl.includes('[연락처]') && jsonl.includes('[이메일]'));

  // 삭제 요청 처리 (거버넌스)
  records.deleteRecordsByProject(store, pid);
  assert.equal(records.exportDataset(store).length, 0);
});
