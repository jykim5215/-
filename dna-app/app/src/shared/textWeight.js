// 카드뉴스 파란 헤더 바 폭 계산 — 하드 룰:
// 글자 가중치(한글 1.0, 라틴·숫자 0.55, 공백 0.4) 합산 → EMU 스케일링으로 동적 계산
const W_HANGUL = 1.0;
const W_LATIN_DIGIT = 0.55;
const W_SPACE = 0.4;
const W_OTHER = 0.7; // 문장부호 등 기본값

function isHangul(cp) {
  return (
    (cp >= 0xac00 && cp <= 0xd7a3) || // 완성형
    (cp >= 0x1100 && cp <= 0x11ff) || // 자모
    (cp >= 0x3130 && cp <= 0x318f)    // 호환 자모
  );
}

function charWeight(ch) {
  const cp = ch.codePointAt(0);
  if (ch === ' ') return W_SPACE;
  if (isHangul(cp)) return W_HANGUL;
  if ((cp >= 0x30 && cp <= 0x39) || (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) {
    return W_LATIN_DIGIT;
  }
  return W_OTHER;
}

function textWeight(text) {
  let sum = 0;
  for (const ch of String(text)) sum += charWeight(ch);
  return sum;
}

// EMU 폭 = 좌우 패딩 + 가중치 합 × 한글 1글자 폭(EMU)
// perCharEmu: 해당 폰트 크기에서 한글 1글자가 차지하는 EMU (템플릿 실측으로 보정)
function headerBarWidthEmu(text, { perCharEmu, paddingEmu = 0, minEmu = 0, maxEmu = Infinity }) {
  const w = paddingEmu + textWeight(text) * perCharEmu;
  return Math.round(Math.min(Math.max(w, minEmu), maxEmu));
}

module.exports = { textWeight, charWeight, headerBarWidthEmu };
