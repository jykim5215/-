import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const gemini = require('../src/main/gemini');

function okResponse(body) {
  return {
    ok: true,
    status: 200,
    async json() {
      return body;
    },
  };
}

test('gemini — generateContent 요청과 JSON 파싱', async () => {
  let seenUrl = '';
  let seenOptions = null;
  const { data, modelVersion, usage } = await gemini.runJson({
    apiKey: 'test-key',
    promptName: 'brainstorm',
    user: '키워드: 테스트',
    fetchImpl: async (url, options) => {
      seenUrl = url;
      seenOptions = options;
      return okResponse({
        candidates: [{ content: { parts: [{ text: '{"ok":true,"items":[1,2]}' }] } }],
        usageMetadata: { totalTokenCount: 123 },
      });
    },
  });

  assert.match(seenUrl, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-2\.5-flash:generateContent$/);
  assert.equal(seenOptions.method, 'POST');
  assert.equal(seenOptions.headers['x-goog-api-key'], 'test-key');
  const payload = JSON.parse(seenOptions.body);
  assert.equal(payload.generationConfig.responseMimeType, 'application/json');
  assert.equal(data.ok, true);
  assert.deepEqual(data.items, [1, 2]);
  assert.match(modelVersion, /^gemini-2\.5-flash\+gemini\/generateContent\+prompts\/v1\/brainstorm$/);
  assert.equal(usage.totalTokenCount, 123);
});

test('gemini — fenced JSON도 파싱', () => {
  const text = '```json\n{"ok":true}\n```';
  assert.equal(gemini.extractJsonText(text), '{"ok":true}');
});

test('gemini — Google OAuth 토큰과 사용자 프로젝트 헤더', async () => {
  let headers;
  await gemini.runJson({
    oauth: { accessToken: 'oauth-token', projectId: 'dna-project' },
    promptName: 'brainstorm',
    user: '키워드: 테스트',
    fetchImpl: async (_url, options) => {
      headers = options.headers;
      return okResponse({
        candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
      });
    },
  });
  assert.equal(headers.Authorization, 'Bearer oauth-token');
  assert.equal(headers['x-goog-user-project'], 'dna-project');
  assert.equal(headers['x-goog-api-key'], undefined);
});

test('gemini — 자동화 프로필을 시스템 지침에 주입', async () => {
  let payload;
  await gemini.runJson({
    oauth: { accessToken: 'oauth-token', projectId: 'dna-project' },
    automationContext: '카드뉴스는 최대 12장으로 유지한다.',
    promptName: 'brainstorm',
    user: '키워드: 테스트',
    fetchImpl: async (_url, options) => {
      payload = JSON.parse(options.body);
      return okResponse({
        candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
      });
    },
  });
  assert.match(payload.systemInstruction.parts[0].text, /앱 자동화 프로필/);
  assert.match(payload.systemInstruction.parts[0].text, /최대 12장/);
});

test('gemini — 개발자 자료 분석 프롬프트', async () => {
  let payload;
  const { profile } = await gemini.analyzeDeveloperBundle({
    oauth: { accessToken: 'oauth-token' },
    files: [{ name: 'guide.md', kind: 'article_guideline', text: '직접인용은 원문 그대로 유지한다.' }],
    fetchImpl: async (_url, options) => {
      payload = JSON.parse(options.body);
      return okResponse({
        candidates: [{ content: { parts: [{ text: '{"summary":"ok","rules":["rule"]}' }] } }],
      });
    },
  });
  assert.equal(profile.summary, 'ok');
  assert.match(payload.contents[0].parts[0].text, /guide\.md/);
});

test('gemini — 빈 응답 오류 안내', () => {
  assert.throws(
    () => gemini.parseResponseText({ promptFeedback: { blockReason: 'SAFETY' } }),
    /Gemini 응답에 텍스트가 없습니다: SAFETY/
  );
});
