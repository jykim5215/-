// 데이터셋 export (거버넌스: 버전 태그 + 변경 로그 + 마스킹)
// 사용법:
//   node scripts/export-dataset.mjs --db <sqlite경로> --tag dataset-v0.1 [--stage draft]
//     [--mask-names "김민준,박성현"] [--no-mask] [--finetune]
//
// --finetune: instruction-input-output JSONL (파인튜닝 형식) + train/val 분리(9:1)
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { Store } = require(path.join(APP, 'src/main/db.js'));
const records = require(path.join(APP, 'src/main/records.js'));

function arg(name, fallback = null) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const dbPath = arg('db');
const tag = arg('tag');
if (!dbPath || !tag) {
  console.error('사용법: node scripts/export-dataset.mjs --db <경로> --tag dataset-vX.Y [옵션]');
  process.exit(1);
}
const stage = arg('stage');
const maskNames = (arg('mask-names', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const mask = !process.argv.includes('--no-mask');
const finetune = process.argv.includes('--finetune');

const store = await Store.open(dbPath);
const jsonl = records.exportDataset(store, { stage, maskNames, mask });
const rows = jsonl ? jsonl.split('\n').map((l) => JSON.parse(l)) : [];

const outDir = path.join(APP, 'datasets', tag);
fs.mkdirSync(outDir, { recursive: true });

const INSTRUCTIONS = {
  brainstorm: '키워드로 학보사 기사 기획안을 만들어라.',
  email: 'DNA 공식 형식의 취재 이메일을 작성하라.',
  draft: '수집 자료를 근거로 학보사 기사 초안을 작성하라.',
  analyze: '수집 자료를 종합 분석하라.',
  cardnews: '기사를 카드뉴스 구성안으로 변환하라.',
  collect: '자료를 정리하라.',
};

if (finetune) {
  // 고품질 쌍만: human_final 존재 (평점 필터는 rating 존재 시)
  const pairs = rows
    .filter((r) => r.human_final)
    .map((r) => ({
      instruction: INSTRUCTIONS[r.stage] || r.stage,
      input: typeof r.input === 'string' ? r.input : JSON.stringify(r.input, null, 0),
      output: r.human_final,
      meta: { stage: r.stage, rating: r.feedback?.rating ?? null, record_id: r.record_id },
    }));
  // train/val 분리 (9:1, 결정적 셔플)
  const shuffled = [...pairs].sort((a, b) => a.meta.record_id.localeCompare(b.meta.record_id));
  const valN = Math.max(1, Math.floor(shuffled.length / 10));
  const val = shuffled.slice(0, valN);
  const train = shuffled.slice(valN);
  fs.writeFileSync(path.join(outDir, 'train.jsonl'), train.map((p) => JSON.stringify(p)).join('\n'));
  fs.writeFileSync(path.join(outDir, 'val.jsonl'), val.map((p) => JSON.stringify(p)).join('\n'));
  console.log(`파인튜닝 형식: train ${train.length} / val ${val.length}`);
} else {
  fs.writeFileSync(path.join(outDir, 'records.jsonl'), jsonl);
}

// 버전 태그 매니페스트 + 변경 로그
const manifest = {
  tag,
  created_at: new Date().toISOString(),
  records: rows.length,
  stages: [...new Set(rows.map((r) => r.stage))],
  masked: mask,
  maskedNames: maskNames.length,
  format: finetune ? 'instruction-input-output (train/val)' : 'raw records',
};
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
const changelog = path.join(APP, 'datasets', 'CHANGELOG.md');
fs.appendFileSync(changelog, `\n## ${tag} — ${manifest.created_at}\n- 레코드 ${rows.length}건, 마스킹 ${mask ? 'ON' : 'OFF'}, 형식 ${manifest.format}\n`);
console.log(`✓ export 완료: ${outDir} (레코드 ${rows.length}건, 마스킹 ${mask ? 'ON' : 'OFF'})`);
