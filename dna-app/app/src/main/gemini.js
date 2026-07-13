// Gemini API integration. API keys are provided by Electron safeStorage or
// environment variables; never hard-code keys in source.
const fs = require('fs');
const path = require('path');

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const API_BASE = process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta';
const PROMPT_VERSION = 'v1';
const PROMPTS_DIR = path.join(__dirname, '..', '..', 'prompts', PROMPT_VERSION);
const RULES_DIR = path.join(__dirname, '..', '..', 'rules');
const RULES = fs.readFileSync(path.join(RULES_DIR, 'quote_rules.md'), 'utf8');
const EMAIL_RULES = fs.readFileSync(path.join(RULES_DIR, 'email_format.md'), 'utf8');

function loadPrompt(name) {
  return fs.readFileSync(path.join(PROMPTS_DIR, `${name}.md`), 'utf8');
}

function modelVersion(promptName) {
  return `${MODEL}+gemini/generateContent+prompts/${PROMPT_VERSION}/${promptName}`;
}

function getApiKey(apiKey) {
  const key =
    apiKey ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  return key || null;
}

function authorizationHeaders({ apiKey, oauth }) {
  const key = getApiKey(apiKey);
  if (key) return { 'x-goog-api-key': key };
  if (oauth?.accessToken) {
    return {
      Authorization: `Bearer ${oauth.accessToken}`,
      ...(oauth.projectId ? { 'x-goog-user-project': oauth.projectId } : {}),
    };
  }
  const err = new Error('Gemini 연결이 필요합니다. 프로필에서 Google 계정을 연결하세요.');
  err.code = 'NO_GEMINI_AUTH';
  throw err;
}

// 시스템 프롬프트 = 프롬프트(버전 관리) + 불변 규칙(하드코딩) + 스타일 예시(RAG 동적 삽입)
function buildSystem(promptName, styleExamples = [], automationContext = '') {
  const rules = promptName === 'email_writer' ? EMAIL_RULES : RULES;
  const parts = [loadPrompt(promptName), '# 불변 규칙\n\n' + rules];
  if (automationContext && String(automationContext).trim()) {
    parts.push('# 앱 자동화 프로필\n\n' + String(automationContext).trim());
  }
  if (styleExamples.length) {
    parts.push(
      '# 스타일 예시 (문체 참고용 — 내용을 베끼지 말 것)\n\n' +
        styleExamples.map((e, i) => `## 예시 ${i + 1}\n${e}`).join('\n\n')
    );
  }
  return parts.join('\n\n---\n\n');
}

function stripJsonFence(text) {
  return String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

function extractJsonText(text) {
  const stripped = stripJsonFence(text);
  if (/^[\[{]/.test(stripped)) return stripped;

  const objectStart = stripped.indexOf('{');
  const arrayStart = stripped.indexOf('[');
  const starts = [objectStart, arrayStart].filter((n) => n >= 0);
  if (!starts.length) return stripped;

  const start = Math.min(...starts);
  const open = stripped[start];
  const close = open === '{' ? '}' : ']';
  const end = stripped.lastIndexOf(close);
  return end > start ? stripped.slice(start, end + 1).trim() : stripped;
}

function normalizeModelName(model = MODEL) {
  return String(model).replace(/^models\//, '');
}

function compactObject(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined));
}

function buildPayload({ system, user, maxTokens = 8000, json = false, temperature }) {
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: compactObject({
      maxOutputTokens: maxTokens,
      temperature: temperature ?? (json ? 0.2 : 0.45),
      topP: 0.95,
      responseMimeType: json ? 'application/json' : undefined,
    }),
  };
}

function parseResponseText(responseJson) {
  const parts = responseJson?.candidates?.[0]?.content?.parts || [];
  const text = parts
    .map((part) => part && part.text)
    .filter(Boolean)
    .join('')
    .trim();
  if (text) return text;

  const blockReason = responseJson?.promptFeedback?.blockReason;
  const finishReason = responseJson?.candidates?.[0]?.finishReason;
  const reason = blockReason || finishReason || 'empty response';
  throw new Error(`Gemini 응답에 텍스트가 없습니다: ${reason}`);
}

async function readErrorBody(response) {
  try {
    const body = await response.json();
    return body?.error?.message || JSON.stringify(body);
  } catch {
    try {
      return await response.text();
    } catch {
      return '';
    }
  }
}

async function generateContent({
  apiKey,
  oauth,
  promptName,
  user,
  styleExamples = [],
  automationContext = '',
  maxTokens = 8000,
  json = false,
  fetchImpl = globalThis.fetch,
}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('이 실행 환경에는 fetch가 없습니다. Electron/Node 버전을 확인하세요.');
  }

  const authHeaders = authorizationHeaders({ apiKey, oauth });
  const system = buildSystem(promptName, styleExamples, automationContext);
  const modelName = normalizeModelName(MODEL);
  const url = `${API_BASE}/models/${encodeURIComponent(modelName)}:generateContent`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify(buildPayload({ system, user, maxTokens, json })),
  });

  if (!response.ok) {
    const body = await readErrorBody(response);
    throw new Error(`Gemini API 오류 ${response.status}: ${body || response.statusText || 'request failed'}`);
  }

  const responseJson = await response.json();
  return {
    text: parseResponseText(responseJson),
    modelVersion: modelVersion(promptName),
    usage: responseJson.usageMetadata,
  };
}

// 단계 5: 기사 초안 생성
async function generateDraft({ apiKey, oauth, automationContext, project, materials, styleExamples = [], fetchImpl }) {
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

  const { text, modelVersion: version, usage } = await generateContent({
    apiKey,
    oauth,
    automationContext,
    promptName: 'draft_writer',
    user,
    styleExamples,
    maxTokens: 16000,
    fetchImpl,
  });
  return { text, modelVersion: version, usage };
}

// 단계 6: 기사 → 카드뉴스 구성안(JSON)
async function planCardnews({ apiKey, oauth, automationContext, draftText, styleExamples = [], fetchImpl }) {
  const { data, modelVersion: version, usage } = await runJson({
    apiKey,
    oauth,
    automationContext,
    promptName: 'cardnews_planner',
    user: `다음 기사를 카드뉴스 구성안 JSON으로 변환하라.\n\n${draftText}`,
    styleExamples,
    maxTokens: 8000,
    fetchImpl,
  });
  return { plan: data, modelVersion: version, usage };
}

// 공통: JSON 출력 프롬프트 실행
async function runJson({ apiKey, oauth, automationContext, promptName, user, styleExamples = [], maxTokens = 8000, fetchImpl }) {
  const { text, modelVersion: version, usage } = await generateContent({
    apiKey,
    oauth,
    automationContext,
    promptName,
    user,
    styleExamples,
    maxTokens,
    json: true,
    fetchImpl,
  });

  let data;
  try {
    data = JSON.parse(extractJsonText(text));
  } catch {
    throw new Error(`${promptName} JSON 파싱 실패:\n` + text.slice(0, 500));
  }
  return { data, modelVersion: version, usage };
}

// 단계 1: 키워드 브레인스토밍 → 기획안 카드
async function brainstorm({ apiKey, oauth, automationContext, keywords, context = '', fetchImpl }) {
  const user = [
    `키워드: ${keywords.join(', ')}`,
    context ? `추가 맥락: ${context}` : '',
    '위 키워드로 기획안 카드를 만들어라.',
  ].filter(Boolean).join('\n');
  return runJson({ apiKey, oauth, automationContext, promptName: 'brainstorm', user, fetchImpl });
}

// 단계 2: 취재 이메일 작성 (DNA 공식 형식은 rules/email_format.md로 시스템에 주입)
async function writeEmail({ apiKey, oauth, automationContext, reporterName, reporterTitle, recipient, purpose, questions = [], external = false, fetchImpl }) {
  const user = [
    `기자 직함: ${reporterTitle || '기자'}`,
    `기자 이름: ${reporterName || '(설정에서 이름을 입력하세요)'}`,
    `수신자: ${recipient}`,
    `수신자 구분: ${external ? '학외 인사 (매체 소개 필요)' : '학내 (매체 소개 생략 가능)'}`,
    `용건: ${purpose}`,
    questions.length ? `질문 초안:\n${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}` : '',
    '위 내용으로 DNA 공식 형식의 취재 이메일을 작성하라.',
  ].filter(Boolean).join('\n');
  return runJson({ apiKey, oauth, automationContext, promptName: 'email_writer', user, fetchImpl });
}

// 단계 3: AI 추천 자료 (수집 자료 갭 분석 → 찾아야 할 자료 제안)
async function suggestMaterials({ apiKey, oauth, automationContext, project, materials = [], checklist = [], fetchImpl }) {
  const user = [
    `기사 프로젝트: ${project.title}`,
    `키워드: ${(project.keywords || []).join(', ')}`,
    checklist.length ? `기획 단계 자료 체크리스트:\n${checklist.map((c) => `- ${c}`).join('\n')}` : '',
    materials.length
      ? `이미 수집된 자료:\n${materials.map((m) => `- [${m.kind}] ${m.title} (출처: ${m.source})`).join('\n')}`
      : '이미 수집된 자료: 없음',
    '추가로 확보하면 좋을 자료를 추천하라.',
  ].filter(Boolean).join('\n\n');
  return runJson({ apiKey, oauth, automationContext, promptName: 'material_scout', user, fetchImpl });
}

// 단계 4: 자료 분석·제언
async function analyze({ apiKey, oauth, automationContext, project, materials, fetchImpl }) {
  const materialBlock = materials
    .map((m, i) => `<자료 idx="${i + 1}" 종류="${m.kind}" 제목="${m.title}" 출처="${m.source}">\n${m.content}\n</자료>`)
    .join('\n\n');
  const user = `기사 프로젝트: ${project.title}\n키워드: ${(project.keywords || []).join(', ')}\n\n수집 자료를 종합 분석하라.\n\n${materialBlock}`;
  return runJson({ apiKey, oauth, automationContext, promptName: 'analyzer', user, maxTokens: 12000, fetchImpl });
}

async function analyzeDeveloperBundle({ apiKey, oauth, files = [], fetchImpl }) {
  const fileBlock = files
    .map((file, index) => {
      const text = String(file.text || '').slice(0, 14000);
      return `<reference idx="${index + 1}" name="${file.name}" kind="${file.kind || 'reference'}" chars="${String(file.text || '').length}">\n${text}\n</reference>`;
    })
    .join('\n\n');
  const user = [
    '아래 기사 지침, 기사 표본, 카드뉴스 표본을 분석해 DNA 편집 스튜디오의 자동화 프로필을 갱신할 수 있는 JSON을 만들어라.',
    '실제 앱 소스코드를 직접 수정하지 않고, 다음 AI 작업에 주입할 규칙·체크리스트·프롬프트 보강안을 구분하라.',
    fileBlock,
  ].join('\n\n');
  const { data, modelVersion: version, usage } = await runJson({
    apiKey,
    oauth,
    promptName: 'developer_audit',
    user,
    maxTokens: 12000,
    fetchImpl,
  });
  return { profile: data, modelVersion: version, usage };
}

module.exports = {
  MODEL,
  API_BASE,
  generateDraft,
  planCardnews,
  buildSystem,
  buildPayload,
  parseResponseText,
  extractJsonText,
  authorizationHeaders,
  modelVersion,
  runJson,
  brainstorm,
  writeEmail,
  analyze,
  suggestMaterials,
  analyzeDeveloperBundle,
};
