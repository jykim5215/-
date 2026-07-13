// GitHub 릴리스 원커맨드 발행 — 새 버전 exe 빌드 + latest.yml + GitHub Releases 업로드
//
// 사용: package.json의 version을 올린 뒤 `npm run release:github`
// - gh CLI 로그인 토큰을 GH_TOKEN으로 전달하므로 별도 토큰 설정이 필요 없다.
// - 발행되면 설치된 앱이 프로필 → 앱 업데이트에서 새 버전을 받아 자동 설치한다.
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = path.join(APP, 'package.json');
let pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

// --bump patch|minor|major : 버전을 올리고 시작 (기본: 현재 버전 그대로)
const bumpIdx = process.argv.indexOf('--bump');
if (bumpIdx >= 0) {
  const kind = process.argv[bumpIdx + 1] || 'patch';
  const [ma, mi, pa] = pkg.version.split('.').map(Number);
  pkg.version = kind === 'major' ? `${ma + 1}.0.0` : kind === 'minor' ? `${ma}.${mi + 1}.0` : `${ma}.${mi}.${pa + 1}`;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`▶ 버전 올림 (${kind}): ${pkg.version}`);
}

let token = process.env.GH_TOKEN || '';
if (!token) {
  try {
    token = execSync('gh auth token', { encoding: 'utf8' }).trim();
  } catch {
    console.error('✗ GH_TOKEN이 없고 gh CLI 로그인도 없습니다. `gh auth login` 후 다시 실행하세요.');
    process.exit(1);
  }
}

console.log(`▶ v${pkg.version} 빌드 + GitHub Releases 발행 (jykim5215/-)`);
const result = spawnSync('npx', ['electron-builder', '--win', 'nsis', '--publish', 'always'], {
  cwd: APP,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, GH_TOKEN: token },
});
if (result.status !== 0) {
  console.warn('⚠ electron-builder publish가 중간에 실패했습니다 — 산출물 업로드를 직접 마무리합니다.');
}

// 업로드 자가 복구: latest.yml이 릴리스에 없으면 앱이 업데이트를 감지하지 못한다.
// (전송 오류로 exe만 올라가는 사례가 있어 항상 검증 후 보정)
const tag = `v${pkg.version}`;
const exeName = `dna-desk-setup-${pkg.version}.exe`;
const dist = path.join(APP, 'dist');
const exePath = path.join(dist, exeName);
if (!fs.existsSync(exePath)) {
  console.error(`✗ ${exeName}가 없습니다 — 빌드 실패. 로그를 확인하세요.`);
  process.exit(1);
}
const crypto = await import('node:crypto');
const buf = fs.readFileSync(exePath);
const sha = crypto.createHash('sha512').update(buf).digest('base64');
fs.writeFileSync(path.join(dist, 'latest.yml'), [
  `version: ${pkg.version}`,
  'files:',
  `  - url: ${exeName}`,
  `    sha512: ${sha}`,
  `    size: ${buf.length}`,
  `path: ${exeName}`,
  `sha512: ${sha}`,
  `releaseDate: '${new Date().toISOString()}'`,
  '',
].join('\n'));

const gh = (args) => spawnSync('gh', args, { cwd: dist, stdio: 'inherit', shell: true, env: { ...process.env, GH_TOKEN: token } });
const view = spawnSync('gh', ['release', 'view', tag, '-R', 'jykim5215/-'], { shell: true, env: { ...process.env, GH_TOKEN: token } });
if (view.status !== 0) {
  gh(['release', 'create', tag, '-R', 'jykim5215/-', '--title', `"DNA 편집 스튜디오 ${tag}"`, '--notes', '"자동 업데이트 릴리스"']);
}
const up = gh(['release', 'upload', tag, exeName, `${exeName}.blockmap`, 'latest.yml', '-R', 'jykim5215/-', '--clobber']);
if (up.status !== 0) process.exit(up.status || 1);
console.log(`✓ 발행 완료 — 설치된 앱에서 프로필 → 앱 업데이트로 ${tag}을 받을 수 있습니다.`);
