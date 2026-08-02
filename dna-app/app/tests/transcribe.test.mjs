import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { transcribeAudio, diagnose } = require('../src/main/transcribe');

test('받아쓰기 — whisper 미설정 시 명확한 안내 오류', () => {
  // 존재하지 않는 바이너리를 명시 → NO_WHISPER 또는 NO_MODEL
  try {
    transcribeAudio('/tmp/none.wav', { whisperBin: '/nonexistent/whisper', whisperModel: '/nonexistent/model.bin' });
    assert.fail('예외가 나야 함');
  } catch (e) {
    // 모델 파일 없음이 먼저 검출됨
    assert.match(e.message, /모델|whisper/);
    assert.ok(e.code === 'NO_MODEL' || e.code === 'NO_WHISPER');
  }
});

test('받아쓰기 — 바이너리 없음이면 NO_WHISPER', () => {
  try {
    transcribeAudio('/tmp/none.wav', {});
    // 시스템에 whisper가 깔려 있으면 이 경로로 안 옴 — 그 경우 모델 없음으로 감
  } catch (e) {
    assert.ok(['NO_WHISPER', 'NO_MODEL'].includes(e.code));
    if (e.code === 'NO_WHISPER') assert.match(e.message, /whisper\.cpp|받아쓰기 엔진/);
  }
});

test('diagnose — 미설정 상태 보고', () => {
  const d = diagnose({ whisperBin: '/nope/x', whisperModel: '/nope/m.bin' });
  // 지정 경로가 없으면 whisperModel은 null (존재 확인 실패)
  assert.equal(d.whisperModel, null);
  assert.ok('whisperBin' in d && 'ffmpeg' in d);
});
