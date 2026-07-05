// 원클릭 바탕화면 바로가기 생성 (신문/펜/DNA 아이콘)
// 사용법: node scripts/create-shortcut.mjs   (앱 디렉터리에서)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ICON = path.join(APP, 'assets', 'icon.svg');
const NAME = 'DNA 편집 스튜디오';
const desktop = path.join(os.homedir(), 'Desktop');

function linux() {
  const entry = `[Desktop Entry]
Type=Application
Name=${NAME}
Comment=디지스트신문 DNA 편집 지원 앱
Exec=sh -c 'cd "${APP}" && npx electron .'
Icon=${ICON}
Terminal=false
Categories=Office;Publishing;
`;
  const apps = path.join(os.homedir(), '.local', 'share', 'applications');
  fs.mkdirSync(apps, { recursive: true });
  fs.writeFileSync(path.join(apps, 'dna-desk.desktop'), entry);
  if (fs.existsSync(desktop)) {
    const p = path.join(desktop, 'dna-desk.desktop');
    fs.writeFileSync(p, entry);
    fs.chmodSync(p, 0o755);
  }
  console.log('✓ Linux 바로가기 생성 (.desktop)');
}

function windows() {
  // Windows .lnk는 .ico가 필요 — assets/icon.ico가 있으면 사용, 없으면 기본 아이콘
  const ico = path.join(APP, 'assets', 'icon.ico');
  const iconLine = fs.existsSync(ico) ? `$s.IconLocation = '${ico}';` : '';
  const ps = `
$ws = New-Object -ComObject WScript.Shell;
$s = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\\${NAME}.lnk');
$s.TargetPath = 'cmd.exe';
$s.Arguments = '/c cd /d "${APP.replace(/\\/g, '\\\\')}" && npx electron .';
$s.WorkingDirectory = '${APP.replace(/\\/g, '\\\\')}';
${iconLine}
$s.Save();`;
  execFileSync('powershell.exe', ['-NoProfile', '-Command', ps]);
  console.log('✓ Windows 바로가기 생성 (.lnk)' + (iconLine ? '' : ' — assets/icon.ico를 만들면 아이콘이 적용됩니다 (icon.svg → ico 변환)'));
}

function macos() {
  const cmd = path.join(desktop, `${NAME}.command`);
  fs.writeFileSync(cmd, `#!/bin/sh\ncd "${APP}" && npx electron .\n`);
  fs.chmodSync(cmd, 0o755);
  console.log('✓ macOS 바로가기 생성 (.command) — 아이콘은 파일 정보(⌘I)에서 icon.svg를 붙여넣어 적용할 수 있습니다.');
}

try {
  if (process.platform === 'linux') linux();
  else if (process.platform === 'win32') windows();
  else if (process.platform === 'darwin') macos();
  else console.log('지원하지 않는 플랫폼:', process.platform);
} catch (e) {
  console.error('바로가기 생성 실패:', e.message);
  process.exit(1);
}
