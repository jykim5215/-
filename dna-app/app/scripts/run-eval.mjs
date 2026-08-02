// 평가 하네스 실행기 — 골드셋 전체를 자동 검사기로 돌리고 회귀를 감지한다.
// 사용법:
//   npm run eval                       # 검사 + 기준선 대비 회귀 비교 (하락 시 exit 1 = 배포 차단)
//   npm run eval -- --update-baseline  # 현재 결과를 기준선으로 저장
//   npm run eval -- --judge            # LLM-as-judge 정성 채점 포함 (API 키 필요)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { runCase } = require(path.join(APP, 'src/eval/checkers.js'));

const GOLDSET = path.join(APP, 'eval/goldset/cases.jsonl');
const REPORT = path.join(APP, 'eval/report-latest.json');
const BASELINE = path.join(APP, 'eval/report-baseline.json');
const TEMPLATE = path.join(APP, '..', 'templates', '인스타그램_카드뉴스_2025개편.pptx');

const args = process.argv.slice(2);
const updateBaseline = args.includes('--update-baseline');
const withJudge = args.includes('--judge');

const cases = fs.readFileSync(GOLDSET, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const templateBuffer = fs.existsSync(TEMPLATE) ? fs.readFileSync(TEMPLATE) : null;

let totalChecks = 0;
let passedChecks = 0;
const caseResults = [];

for (const c of cases) {
  const checks = await runCase(c, { templateBuffer });
  // 음성 케이스: 검사기가 실패를 잡아내는 것이 정답
  const expectFail = c.input?.expectFail === true;
  const normalized = expectFail
    ? checks.map((ch) => ({ ...ch, name: `[음성] ${ch.name}`, pass: ch.name.includes('인용') ? !ch.pass : ch.pass }))
    : checks;
  for (const ch of normalized) {
    totalChecks++;
    if (ch.pass) passedChecks++;
  }
  caseResults.push({ id: c.id, type: c.type, checks: normalized });
}

// LLM-as-judge (선택)
if (withJudge) {
  const { judgeText } = require(path.join(APP, 'src/eval/judge.js'));
  for (const c of cases.filter((x) => x.type === 'draft' && !x.input?.expectFail)) {
    try {
      const { scores } = await judgeText({ output: c.output });
      caseResults.find((r) => r.id === c.id).judge = scores;
      console.log(`  judge[${c.id}]: overall ${scores.overall}/5`);
    } catch (e) {
      console.error(`  judge[${c.id}] 실패: ${e.message}`);
    }
  }
}

const passRate = totalChecks ? passedChecks / totalChecks : 0;
const report = {
  timestamp: new Date().toISOString(),
  totalChecks,
  passedChecks,
  passRate: Number(passRate.toFixed(4)),
  cases: caseResults,
};
fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));

// ---- 출력 ----
console.log(`\n골드셋 평가: ${passedChecks}/${totalChecks} 통과 (${(passRate * 100).toFixed(1)}%)`);
for (const r of caseResults) {
  for (const ch of r.checks) {
    console.log(`  ${ch.pass ? '✓' : '✗'} [${r.id}] ${ch.name}${ch.pass ? '' : ' — ' + ch.detail}`);
  }
}

// ---- 회귀 비교 (점수 하락 = 배포 차단) ----
if (updateBaseline) {
  fs.writeFileSync(BASELINE, JSON.stringify(report, null, 2));
  console.log('\n기준선 갱신 완료 → eval/report-baseline.json');
} else if (fs.existsSync(BASELINE)) {
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  console.log(`\n기준선 대비: ${(base.passRate * 100).toFixed(1)}% → ${(passRate * 100).toFixed(1)}%`);
  if (passRate < base.passRate) {
    console.error('✗ 회귀 감지 — 통과율이 기준선보다 낮습니다. 배포를 차단하세요.');
    process.exit(1);
  }
  console.log('✓ 회귀 없음');
} else {
  console.log('\n기준선 없음 — `npm run eval -- --update-baseline`으로 저장하세요.');
}
