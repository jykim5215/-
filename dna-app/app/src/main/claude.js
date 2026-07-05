// Claude API 연동 — 키는 환경변수 또는 Electron safeStorage로 암호화 저장 (코드 하드코딩 금지)
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-opus-4-8';
const PROMPT_VERSION = 'v1';
const PROMPTS_DIR = path.join(__dirname, '..', '..', 'prompts', PROMPT_VERSION);
const RULES = fs.readFileSync(
  path.join(__dirname, '..', '..', 'rules', 'quote_rules.md'),
  'utf8'
);

function loadPrompt(name) {
  return fs.readFileSync(path.join(PROMPTS_DIR, `${name}.md`), 'utf8');
}

function modelVersion(promptName) {
  return `${MODEL}+prompts/${PROMPT_VERSION}/${promptName}`;
}

function getClient(apiKey) {
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) {
    const err = new Error('API 키가 설정되지 않았습니다. 설정에서 Claude API 키를 등록하세요.');
    err.code = 'NO_API_KEY';
    throw err;
  }
  return new Anthropic({ apiKey: key });
}

// 시스템 프롬프트 = 프롬프트(버전 관리) + 불변 규칙(하드코딩) + 스타일 예시(RAG 동적 삽입)
function buildSystem(promptName, styleExamples = []) {
  const parts = [loadPrompt(promptName), '# 불변 규칙\n\n' + RULES];
  if (styleExamples.length) {
    parts.push(
      '# 스타일 예시 (문체 참고용 — 내용을 베끼지 말 것)\n\n' +
        styleExamples.map((e, i) => `## 예시 ${i + 1}\n${e}`).join('\n\n')
    );
  }
  return parts.join('\n\n---\n\n');
}

// 단계 5: 기사 초안 생성
async function generateDraft({ apiKey, project, materials, styleExamples = [] }) {
  const client = getClient(apiKey);
  const materialBlock = materials
    .map(
      (m, i) =>
        `<자료 idx="${i + 1}" 종류="${m.kind}" 제목="${m.title}" 출처="${m.source}">\n${m.content}\n</자료>`
    )
    .join('\n\n');
  const user = [
    `기사 프로젝트: ${project.title}`,
    `키워드: ${(project.keywords || []).join(', ')}`,
    project.article_type ? `기사 유형: ${project.article_type}` : '',
    '',
    '아래 수집 자료를 근거로 기사 초안을 작성하라.',
    materialBlock,
  ]
    .filter(Boolean)
    .join('\n');

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    system: buildSystem('draft_writer', styleExamples),
    messages: [{ role: 'user', content: user }],
  });
  const msg = await stream.finalMessage();
  const text = msg.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return { text, modelVersion: modelVersion('draft_writer'), usage: msg.usage };
}

// 단계 6: 기사 → 카드뉴스 구성안(JSON)
async function planCardnews({ apiKey, draftText, styleExamples = [] }) {
  const client = getClient(apiKey);
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    system: buildSystem('cardnews_planner', styleExamples),
    messages: [{ role: 'user', content: `다음 기사를 카드뉴스 구성안 JSON으로 변환하라.\n\n${draftText}` }],
  });
  const msg = await stream.finalMessage();
  const text = msg.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  const jsonText = text.replace(/^```json?\s*/i, '').replace(/```\s*$/, '');
  let plan;
  try {
    plan = JSON.parse(jsonText);
  } catch {
    throw new Error('카드뉴스 구성안 JSON 파싱 실패:\n' + text.slice(0, 500));
  }
  return { plan, modelVersion: modelVersion('cardnews_planner'), usage: msg.usage };
}

module.exports = { MODEL, generateDraft, planCardnews, buildSystem, modelVersion };
