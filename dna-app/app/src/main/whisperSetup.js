// whisper.cpp 자동 설치 — 받아쓰기 엔진(바이너리)과 한국어 모델을 다운로드해
// 앱 데이터 폴더에 설치하고 경로를 돌려준다. (오디오는 계속 기기 안에서만 처리)
//
// - 바이너리: github.com/ggml-org/whisper.cpp 릴리스의 Windows x64 zip
// - 모델:    huggingface.co/ggerganov/whisper.cpp 의 ggml-*.bin (기본 small — 한국어 지원 다국어 모델)
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const RELEASES_API = 'https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=8';
const MODEL_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';
const MODELS = {
  small: { file: 'ggml-small.bin', label: 'small (467MB, 권장 — 속도·정확도 균형)' },
  medium: { file: 'ggml-medium.bin', label: 'medium (1.5GB, 더 정확·느림)' },
  base: { file: 'ggml-base.bin', label: 'base (148MB, 빠름·정확도 낮음)' },
};

async function downloadToFile(url, dest, { onProgress, label } = {}) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`다운로드 실패 (HTTP ${res.status}): ${url}`);
  const total = Number(res.headers.get('content-length') || 0);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  const stream = fs.createWriteStream(tmp);
  let transferred = 0;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      stream.write(Buffer.from(value));
      transferred += value.length;
      onProgress?.({ stage: label, transferred, total, percent: total ? Math.round((transferred / total) * 100) : 0 });
    }
  } finally {
    await new Promise((resolve) => stream.end(resolve));
  }
  fs.renameSync(tmp, dest);
  return dest;
}

async function findWindowsBinaryAsset(fetchImpl = fetch) {
  const res = await fetchImpl(RELEASES_API, {
    headers: { 'User-Agent': 'DNA-Desk whisper setup', Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`whisper.cpp 릴리스 조회 실패 (HTTP ${res.status})`);
  const releases = await res.json();
  for (const release of releases) {
    const asset = (release.assets || []).find((a) => /bin-x64\.zip$/i.test(a.name) && !/cublas|blas/i.test(a.name))
      || (release.assets || []).find((a) => /bin-x64\.zip$/i.test(a.name));
    if (asset) return { url: asset.browser_download_url, name: asset.name, tag: release.tag_name };
  }
  throw new Error('whisper.cpp 릴리스에서 Windows 바이너리(zip)를 찾지 못했습니다. 직접 빌드해 설정에 경로를 넣어 주세요.');
}

async function installBinary(dir, { onProgress, fetchImpl = fetch } = {}) {
  const binDir = path.join(dir, 'bin');
  // 이미 설치돼 있으면 재사용
  for (const exe of ['whisper-cli.exe', 'main.exe']) {
    const p = path.join(binDir, exe);
    if (fs.existsSync(p)) return p;
  }
  const asset = await findWindowsBinaryAsset(fetchImpl);
  onProgress?.({ stage: 'binary', message: `엔진 다운로드: ${asset.name} (${asset.tag})` });
  const zipPath = path.join(dir, asset.name);
  await downloadToFile(asset.url, zipPath, { onProgress, label: 'binary' });
  const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
  fs.mkdirSync(binDir, { recursive: true });
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const flat = path.basename(name); // zip 내부 폴더 구조는 평탄화
    fs.writeFileSync(path.join(binDir, flat), await entry.async('nodebuffer'));
  }
  fs.unlinkSync(zipPath);
  for (const exe of ['whisper-cli.exe', 'main.exe', 'whisper.exe']) {
    const p = path.join(binDir, exe);
    if (fs.existsSync(p)) return p;
  }
  throw new Error('바이너리 zip에서 whisper 실행 파일을 찾지 못했습니다.');
}

async function installModel(dir, modelName, { onProgress, fetchImpl = fetch } = {}) {
  const model = MODELS[modelName] || MODELS.small;
  const dest = path.join(dir, 'models', model.file);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 10 * 1024 * 1024) return dest;
  onProgress?.({ stage: 'model', message: `한국어 모델 다운로드: ${model.file}` });
  await downloadToFile(`${MODEL_BASE}/${model.file}`, dest, { onProgress, label: 'model' });
  return dest;
}

// 전체 설치. 반환: { bin, model }
async function setupWhisper({ dir, model = 'small', onProgress, fetchImpl = fetch } = {}) {
  if (!dir) throw new Error('설치 폴더(dir)가 필요합니다.');
  fs.mkdirSync(dir, { recursive: true });
  const bin = await installBinary(dir, { onProgress, fetchImpl });
  const modelPath = await installModel(dir, model, { onProgress, fetchImpl });
  onProgress?.({ stage: 'done', message: '받아쓰기 엔진 설치 완료' });
  return { bin, model: modelPath };
}

module.exports = { setupWhisper, installBinary, installModel, findWindowsBinaryAsset, MODELS };
