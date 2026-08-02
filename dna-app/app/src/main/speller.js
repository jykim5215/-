// 한국어 맞춤법 검사 — 2중 엔진
//
// 1) nara  : 부산대 인공지능연구실 + (주)나라인포테크 한국어 맞춤법/문법 검사기
//            (nara-speller.co.kr). hanspell/py-hanspell이 쓰는 공개 프로토콜:
//            POST /speller/results (form: text1) → 응답 HTML의 `data = [...]` JSON.
//            ※ 개인·학술 목적 무료 서비스다. 요청은 사용자가 버튼을 누를 때만,
//              청크를 순차 전송(동시 요청 금지)하며 출처를 UI에 표기한다.
// 2) local : 오프라인 규칙 검사기 — 자주 틀리는 표기·띄어쓰기 확정 패턴만.
//            네트워크 불가/응답 실패 시 폴백.
//
// 반환 형식 (두 엔진 공통):
//   { engine: 'nara'|'local', items: [{ orgStr, candWords: [..], help }] }

const NARA_URL = 'https://nara-speller.co.kr/speller/results';
const CHUNK_LIMIT = 450; // 검사기 1회 요청 한도(어절 기준 제한)를 넘지 않도록 분할

// ---- 텍스트 분할: 문단 경계 우선, 넘치면 문장 경계 ----
function chunkText(text, limit = CHUNK_LIMIT) {
  const chunks = [];
  for (const para of String(text).split(/\n{2,}/)) {
    if (!para.trim()) continue;
    if (para.length <= limit) { chunks.push(para); continue; }
    let buf = '';
    for (const sent of para.split(/(?<=[.!?다요죠])\s+/)) {
      if ((buf + ' ' + sent).length > limit && buf) { chunks.push(buf); buf = sent; }
      else buf = buf ? buf + ' ' + sent : sent;
    }
    if (buf) chunks.push(buf);
  }
  return chunks;
}

// ---- nara 응답 파싱: HTML 속 `data = [...]` JSON ----
function parseNaraHtml(html) {
  const m = String(html).match(/\bdata\s*=\s*(\[[\s\S]*?\]);/);
  if (!m) return [];
  let data;
  try { data = JSON.parse(m[1]); } catch { return []; }
  const items = [];
  for (const block of data) {
    for (const e of block.errInfo || []) {
      const cands = String(e.candWord || '')
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean);
      if (!e.orgStr || !cands.length) continue;
      items.push({
        orgStr: e.orgStr,
        candWords: cands,
        help: String(e.help || '')
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .trim(),
      });
    }
  }
  return items;
}

async function checkWithNara(text, { fetchImpl = fetch } = {}) {
  const items = [];
  for (const chunk of chunkText(text)) {
    const res = await fetchImpl(NARA_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': 'Mozilla/5.0 (DNA-Desk speller; personal use)',
      },
      body: 'text1=' + encodeURIComponent(chunk),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`맞춤법 서버 응답 오류: HTTP ${res.status}`);
    items.push(...parseNaraHtml(await res.text()));
  }
  // 동일 교정 중복 제거
  const seen = new Set();
  return items.filter((it) => {
    const k = it.orgStr + '→' + it.candWords.join('|');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---- 로컬 규칙 검사기 (확정적인 패턴만 — 문맥 의존 교정은 넣지 않는다) ----
const LOCAL_RULES = [
  // 표기 혼동
  { re: /됬/g, fix: (s) => s.replace(/됬/g, '됐'), org: '됬', cand: '됐', help: "'되었-'의 준말은 '됐-'입니다." },
  { re: /되서/g, fix: null, org: '되서', cand: '돼서', help: "'되어서'의 준말은 '돼서'입니다." },
  { re: /되요/g, fix: null, org: '되요', cand: '돼요', help: "'되어요'의 준말은 '돼요'입니다." },
  { re: /뵈요/g, fix: null, org: '뵈요', cand: '봬요', help: "'뵈어요'의 준말은 '봬요'입니다." },
  { re: /몇일/g, fix: null, org: '몇일', cand: '며칠', help: "'몇 일'이 아니라 '며칠'이 표준어입니다." },
  { re: /왠만/g, fix: null, org: '왠만', cand: '웬만', help: "'웬만하다'가 맞습니다. '왠'은 '왠지'에서만 씁니다." },
  { re: /웬지/g, fix: null, org: '웬지', cand: '왠지', help: "'왜인지'의 준말은 '왠지'입니다." },
  { re: /오랫만/g, fix: null, org: '오랫만', cand: '오랜만', help: "'오랜만'이 맞습니다 ('오래간만'의 준말)." },
  { re: /어떻해/g, fix: null, org: '어떻해', cand: '어떡해', help: "'어떻게 해'의 준말은 '어떡해'입니다." },
  { re: /희안/g, fix: null, org: '희안', cand: '희한', help: "'희한(稀罕)하다'가 맞습니다." },
  { re: /금새/g, fix: null, org: '금새', cand: '금세', help: "'금시에'의 준말은 '금세'입니다." },
  { re: /구지/g, fix: null, org: '구지', cand: '굳이', help: "'굳이'가 맞는 표기입니다." },
  { re: /할께/g, fix: null, org: '할께', cand: '할게', help: "'-ㄹ게'는 예사소리로 적습니다." },
  { re: /않되/g, fix: null, org: '않되', cand: '안 되', help: "부정 부사는 '안', '않-'은 '아니하-'의 준말입니다." },
  { re: /그리고나서/g, fix: null, org: '그리고나서', cand: '그러고 나서', help: "'그러고 나서'가 맞는 표현입니다." },
];
// 띄어쓰기: 의존명사 '수' — "…ㄹ수 있다/없다" (관형형 어미 ㄹ 받침 + 수, 확정적)
const SU_RE = /([가-힣])수\s*(있|없)/g;
function hasRieulJong(ch) {
  const code = ch.codePointAt(0) - 0xac00;
  if (code < 0 || code > 11171) return false;
  return code % 28 === 8; // 종성 인덱스 8 = ㄹ
}

function localSpellCheck(text) {
  const items = [];
  for (const rule of LOCAL_RULES) {
    if (rule.re.test(text)) {
      items.push({ orgStr: rule.org, candWords: [rule.cand], help: rule.help + ' (로컬 규칙)' });
    }
    rule.re.lastIndex = 0;
  }
  let m;
  const seen = new Set();
  while ((m = SU_RE.exec(text)) !== null) {
    if (!hasRieulJong(m[1])) continue;
    const org = `${m[1]}수 ${m[2]}`;
    if (seen.has(org)) continue;
    seen.add(org);
    items.push({
      orgStr: org,
      candWords: [`${m[1]} 수 ${m[2]}`],
      help: "의존명사 '수'는 앞말과 띄어 씁니다. (로컬 규칙)",
    });
  }
  SU_RE.lastIndex = 0;
  return items;
}

// ---- 통합 진입점: nara 우선, 실패 시 local 폴백 ----
async function checkSpelling(text, opts = {}) {
  try {
    const items = await checkWithNara(text, opts);
    return { engine: 'nara', items };
  } catch (e) {
    return { engine: 'local', items: localSpellCheck(text), naraError: e.message };
  }
}

module.exports = { checkSpelling, checkWithNara, localSpellCheck, parseNaraHtml, chunkText, NARA_URL };
