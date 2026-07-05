// 카드뉴스 하드 룰 검증기 (rule-based, 확정적)
// - 최대 12장, Q&A 1문항=1카드
// - 커버 제목: 최대 2줄, 따옴표·쉼표·하이픈 외 문장부호 금지
// - 카테고리 박스: 대괄호 금지
// - 본문 분량: 로고 침범 위험 시 플래그 (실제 폰트 환경 확인 필요)
const MAX_SLIDES = 12;
const MAX_BODY_CHARS = 380; // 32pt 기준 휴리스틱 — 초과 시 로고 침범 위험 플래그

// 허용 문장부호: 곡선/직선 따옴표, 쉼표, 하이픈류. 그 외 문장부호는 경고.
const COVER_FORBIDDEN_RE = /[.!?:;()[\]{}~·…/\\@#$%^&*+=|<>]/g;

function validateCardPlan(plan) {
  const errors = [];
  const warnings = [];

  const totalSlides = 2 + (plan.cards?.length || 0); // 커버 + 카드 + 마무리
  if (totalSlides > MAX_SLIDES) {
    errors.push(`총 ${totalSlides}장 — 최대 ${MAX_SLIDES}장을 초과합니다. 카드를 줄이세요.`);
  }
  if (!plan.coverTitle || !plan.coverTitle.trim()) {
    errors.push('커버 제목이 비어 있습니다.');
  } else {
    const lines = plan.coverTitle.split('\n');
    if (lines.length > 2) errors.push(`커버 제목이 ${lines.length}줄 — 최대 2줄입니다.`);
    const bad = plan.coverTitle.match(COVER_FORBIDDEN_RE);
    if (bad) {
      warnings.push(
        `커버 제목에 금지 문장부호 ${[...new Set(bad)].join(' ')} — 따옴표·쉼표·하이픈만 허용됩니다.`
      );
    }
  }
  if (!plan.category || !plan.category.trim()) {
    errors.push('기사 카테고리(또는 시리즈명)가 비어 있습니다.');
  } else if (/[[\]]/.test(plan.category)) {
    errors.push('카테고리 박스에 대괄호를 쓸 수 없습니다.');
  }

  (plan.cards || []).forEach((card, i) => {
    const label = `카드 ${i + 1}`;
    if (!card.title || !card.title.trim()) errors.push(`${label}: 제목이 비어 있습니다.`);
    const bodyLen = (card.body || '').replace(/\s+/g, ' ').length;
    if (bodyLen === 0) errors.push(`${label}: 본문이 비어 있습니다.`);
    if (bodyLen > MAX_BODY_CHARS) {
      warnings.push(
        `${label}: 본문 ${bodyLen}자 — DGIST 로고를 넘을 수 있습니다. 실제 폰트 환경에서 확인 필요.`
      );
    }
    // Q&A 카드: 질문 1개 = 카드 1장
    const qCount = (card.title.match(/Q\d+|Q\./gi) || []).length +
      ((card.body || '').match(/(^|\n)\s*Q\d*[.)]/g) || []).length;
    if (qCount > 1) warnings.push(`${label}: 질문이 ${qCount}개로 보입니다 — 1문항 1카드 원칙.`);
  });

  return { ok: errors.length === 0, errors, warnings, totalSlides };
}

module.exports = { validateCardPlan, MAX_SLIDES, MAX_BODY_CHARS };
