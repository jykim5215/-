const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function listPngs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => /\.png$/i.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((name) => path.join(dir, name));
}

function exportWithPowerPoint(pptxPath, outDir) {
  if (process.platform !== 'win32') {
    throw new Error('PowerPoint COM export is Windows-only.');
  }
  const scriptPath = path.join(os.tmpdir(), `dna-ppt-export-${Date.now()}.ps1`);
  const script = `
param([string]$PptxPath, [string]$OutDir)
$ErrorActionPreference = 'Stop'
$ppt = $null
$presentation = $null
try {
  $ppt = New-Object -ComObject PowerPoint.Application
  $ppt.Visible = 1
  $presentation = $ppt.Presentations.Open($PptxPath, $true, $false, $false)
  $presentation.Export($OutDir, "PNG")
} finally {
  if ($presentation -ne $null) { $presentation.Close() | Out-Null }
  if ($ppt -ne $null) { $ppt.Quit() | Out-Null }
}
`;
  fs.writeFileSync(scriptPath, script, 'utf8');
  try {
    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      pptxPath,
      outDir,
    ], { encoding: 'utf8', timeout: 120000 });
    if (result.status !== 0) {
      throw new Error((result.stderr || result.stdout || 'PowerPoint PNG export failed.').trim());
    }
    const files = listPngs(outDir);
    if (!files.length) throw new Error('PowerPoint가 PNG 파일을 만들지 못했습니다.');
    return { engine: 'powerpoint', files };
  } finally {
    try { fs.unlinkSync(scriptPath); } catch { /* ignore */ }
  }
}

function possibleSofficePaths() {
  return [
    process.env.SOFFICE_PATH,
    process.env.LIBREOFFICE_PATH,
    'soffice',
    'libreoffice',
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  ].filter(Boolean);
}

function exportWithLibreOffice(pptxPath, outDir) {
  let lastError = null;
  for (const exe of possibleSofficePaths()) {
    const result = spawnSync(exe, [
      '--headless',
      '--convert-to',
      'png',
      '--outdir',
      outDir,
      pptxPath,
    ], { encoding: 'utf8', timeout: 120000 });
    if (result.error) {
      lastError = result.error;
      continue;
    }
    if (result.status === 0) {
      const files = listPngs(outDir);
      if (files.length) return { engine: 'libreoffice', files };
      lastError = new Error('LibreOffice가 PNG 파일을 만들지 못했습니다.');
      continue;
    }
    lastError = new Error((result.stderr || result.stdout || 'LibreOffice PNG export failed.').trim());
  }
  throw lastError || new Error('LibreOffice 실행 파일을 찾지 못했습니다.');
}

function exportPptxToPngs(pptxPath, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const errors = [];
  try {
    return exportWithPowerPoint(pptxPath, outDir);
  } catch (error) {
    errors.push(`PowerPoint: ${error.message || error}`);
  }
  try {
    return exportWithLibreOffice(pptxPath, outDir);
  } catch (error) {
    errors.push(`LibreOffice: ${error.message || error}`);
  }
  const err = new Error('PNG 변환을 실행할 수 없습니다. PowerPoint 또는 LibreOffice가 필요합니다.');
  err.details = errors;
  throw err;
}

module.exports = {
  exportPptxToPngs,
  listPngs,
};
