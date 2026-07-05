// 배포 zip 생성 + 보안 점검 (개발 공통 원칙 1)
// - 개인정보(로컬 경로·토큰) 및 하드코딩된 API 키 스캔 → 발견 시 빌드 중단
// - node_modules / 로컬 데이터 / .git 제외
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const JSZip = require('jszip');

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(APP, '..'); // dna-app/
const pkg = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));

const EXCLUDE_DIRS = new Set(['node_modules', 'dist', '.git', 'data']);
const TEXT_EXT = new Set(['.js', '.mjs', '.json', '.md', '.html', '.css', '.sql']);

// 잠재적 비밀정보/개인정보 패턴
const SECRET_PATTERNS = [
  { re: /sk-ant-[a-zA-Z0-9-_]{10,}/, name: 'Anthropic API 키' },
  { re: /(api[_-]?key|token|secret|password)\s*[:=]\s*["'][A-Za-z0-9+/_-]{16,}["']/i, name: '하드코딩된 자격증명' },
  { re: /\/home\/[a-z0-9_-]+\/(?!-\b)/i, name: '로컬 홈 경로' },
  { re: /\/Users\/[A-Za-z0-9._-]+\//, name: 'macOS 사용자 경로' },
  { re: /C:\\Users\\[A-Za-z0-9._-]+/, name: 'Windows 사용자 경로' },
  { re: /ghp_[A-Za-z0-9]{20,}/, name: 'GitHub 토큰' },
];

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (EXCLUDE_DIRS.has(e.name)) continue;
      yield* walk(path.join(dir, e.name));
    } else {
      yield path.join(dir, e.name);
    }
  }
}

// 1) 보안 스캔
const findings = [];
for (const file of walk(APP)) {
  if (!TEXT_EXT.has(path.extname(file))) continue;
  const rel = path.relative(APP, file);
  const content = fs.readFileSync(file, 'utf8');
  for (const { re, name } of SECRET_PATTERNS) {
    const m = content.match(re);
    if (m) findings.push(`${rel}: ${name} 의심 (${m[0].slice(0, 40)}…)`);
  }
}
if (findings.length) {
  console.error('✗ 보안 스캔 실패 — 배포 zip 생성 중단:');
  findings.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log('✓ 보안 스캔 통과 (API 키/토큰/로컬 경로 없음)');

// 2) zip 패키징: app 소스 + 템플릿 + 문서
const zip = new JSZip();
for (const file of walk(APP)) {
  zip.file(path.join('dna-desk', 'app', path.relative(APP, file)), fs.readFileSync(file));
}
const templates = path.join(ROOT, 'templates');
if (fs.existsSync(templates)) {
  for (const f of fs.readdirSync(templates)) {
    zip.file(path.join('dna-desk', 'templates', f), fs.readFileSync(path.join(templates, f)));
  }
}
const rootReadme = path.join(ROOT, 'README.md');
if (fs.existsSync(rootReadme)) zip.file('dna-desk/README.md', fs.readFileSync(rootReadme));

const outDir = path.join(ROOT, 'dist');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `dna-desk-v${pkg.version}.zip`);
const buf = await zip.generateAsync({
  type: 'nodebuffer',
  compression: 'DEFLATE',
  compressionOptions: { level: 9 },
});
fs.writeFileSync(outPath, buf);
console.log(`✓ 배포 zip 생성: ${outPath} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
console.log('  설치: 압축 해제 → app/에서 npm install → npm start');
