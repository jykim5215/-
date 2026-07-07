// 인터뷰 오디오 → 텍스트 받아쓰기
//
// 취재원 보호가 최우선이라 로컬 whisper.cpp를 기본 백엔드로 쓴다 (오디오가 기기를 떠나지 않음).
// whisper.cpp 바이너리·모델 경로는 설정(whisperBin, whisperModel)에 저장한다.
// ffmpeg가 있으면 16kHz mono WAV로 변환 후 전사한다 (whisper.cpp 요구 포맷).
//
// 설치 안내(바이너리 없을 때 사용자에게 노출):
//   1) github.com/ggerganov/whisper.cpp 빌드 → whisper-cli (구버전: main) 바이너리
//   2) 한국어 지원 모델 다운로드 (예: ggml-large-v3.bin 또는 ggml-medium.bin)
//   3) 앱 설정에서 whisperBin, whisperModel 경로 지정
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function which(bin) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim().split('\n')[0] : null;
}

// 오디오를 16kHz mono WAV로 변환 (ffmpeg 있을 때). 반환: wav 경로 + 임시 여부
function toWav16k(inputPath, ffmpegPath) {
  const ff = ffmpegPath || which('ffmpeg');
  if (!ff) {
    // ffmpeg 없음 — 입력이 이미 wav면 그대로 시도, 아니면 안내
    if (/\.wav$/i.test(inputPath)) return { wav: inputPath, temp: false };
    throw new Error(
      'ffmpeg가 필요합니다 (오디오를 WAV로 변환). ffmpeg 설치 후 다시 시도하거나, 16kHz WAV 파일을 넣으세요.'
    );
  }
  const out = path.join(os.tmpdir(), `dna_stt_${Date.now()}.wav`);
  const r = spawnSync(ff, ['-y', '-i', inputPath, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', out], {
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error('오디오 변환 실패(ffmpeg): ' + (r.stderr || '').slice(-300));
  return { wav: out, temp: true };
}

// whisper.cpp 실행 → 전사 텍스트. opts: { whisperBin, whisperModel, ffmpeg, lang }
function transcribeAudio(inputPath, opts = {}) {
  const bin = opts.whisperBin || which('whisper-cli') || which('whisper') || which('main');
  if (!bin) {
    const err = new Error(
      '받아쓰기 엔진(whisper.cpp)이 설정되지 않았습니다.\n' +
        '설정에서 whisper 바이너리·모델 경로를 지정하세요.\n' +
        '① whisper.cpp 빌드(whisper-cli) ② 한국어 모델(ggml-*.bin) 다운로드 ③ 설정에 경로 입력'
    );
    err.code = 'NO_WHISPER';
    throw err;
  }
  if (!opts.whisperModel || !fs.existsSync(opts.whisperModel)) {
    const err = new Error('whisper 모델 파일이 없습니다. 설정에서 ggml-*.bin 모델 경로를 지정하세요.');
    err.code = 'NO_MODEL';
    throw err;
  }

  const { wav, temp } = toWav16k(inputPath, opts.ffmpeg);
  const outBase = path.join(os.tmpdir(), `dna_stt_out_${Date.now()}`);
  try {
    const args = ['-m', opts.whisperModel, '-f', wav, '-l', opts.lang || 'ko', '-otxt', '-of', outBase, '-nt'];
    const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) throw new Error('전사 실패(whisper): ' + (r.stderr || r.stdout || '').slice(-300));
    const txtPath = outBase + '.txt';
    const text = fs.existsSync(txtPath) ? fs.readFileSync(txtPath, 'utf8').trim() : (r.stdout || '').trim();
    fs.existsSync(txtPath) && fs.unlinkSync(txtPath);
    return { text, engine: 'whisper.cpp', model: path.basename(opts.whisperModel) };
  } finally {
    if (temp && fs.existsSync(wav)) fs.unlinkSync(wav);
  }
}

// 백엔드 사용 가능 여부 진단 (설정 화면용)
function diagnose(opts = {}) {
  return {
    whisperBin: opts.whisperBin || which('whisper-cli') || which('whisper') || which('main') || null,
    whisperModel: opts.whisperModel && fs.existsSync(opts.whisperModel) ? opts.whisperModel : null,
    ffmpeg: opts.ffmpeg || which('ffmpeg') || null,
  };
}

module.exports = { transcribeAudio, diagnose, toWav16k, which };
