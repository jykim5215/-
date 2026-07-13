import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const {
  parseClientCredentials,
  createPkce,
  buildAuthorizationUrl,
  exchangeCode,
  refreshAccessToken,
  fetchProfile,
  missingScopes,
} = require('../src/main/googleAuth');

test('Google OAuth 데스크톱 클라이언트 JSON 파싱', () => {
  const config = parseClientCredentials(JSON.stringify({
    installed: {
      client_id: 'client.apps.googleusercontent.com',
      client_secret: 'secret',
      project_id: 'dna-project',
      redirect_uris: ['http://localhost'],
    },
  }));
  assert.equal(config.type, 'installed');
  assert.equal(config.clientId, 'client.apps.googleusercontent.com');
  assert.equal(config.clientSecret, 'secret');
  assert.throws(() => parseClientCredentials('{}'), /데스크톱 OAuth/);
});

test('Google OAuth PKCE와 인증 URL', () => {
  const pkce = createPkce();
  assert.ok(pkce.verifier.length >= 43);
  assert.match(pkce.challenge, /^[A-Za-z0-9_-]+$/);
  const url = new URL(buildAuthorizationUrl({
    clientId: 'client-id',
    redirectUri: 'http://127.0.0.1:43123/oauth2/callback',
    state: 'state-value',
    challenge: pkce.challenge,
  }));
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.match(url.searchParams.get('scope'), /openid/);
  assert.match(url.searchParams.get('scope'), /email/);
  assert.match(url.searchParams.get('scope'), /cloud-platform/);
  assert.match(url.searchParams.get('scope'), /drive\.readonly/);
  assert.match(url.searchParams.get('scope'), /drive\.file/);
  assert.deepEqual(missingScopes({ scope: url.searchParams.get('scope') }), []);
});

test('Google OAuth 토큰 교환과 프로필 정규화', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (String(url).includes('/token')) {
      return { ok: true, json: async () => ({ access_token: 'access', refresh_token: 'refresh' }) };
    }
    return {
      ok: true,
      json: async () => ({
        sub: 'google-user',
        name: '김유준',
        email: 'user@example.com',
        email_verified: true,
      }),
    };
  };
  const token = await exchangeCode({
    code: 'code',
    clientId: 'client',
    clientSecret: 'secret',
    redirectUri: 'http://127.0.0.1/callback',
    verifier: 'verifier',
    fetchImpl,
  });
  assert.equal(token.refresh_token, 'refresh');
  assert.match(String(calls[0].options.body), /code_verifier=verifier/);

  const profile = await fetchProfile('access', fetchImpl);
  assert.equal(profile.name, '김유준');
  assert.equal(profile.emailVerified, true);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer access');
});

test('Google OAuth 갱신 토큰', async () => {
  let body = '';
  const token = await refreshAccessToken({
    clientId: 'client',
    clientSecret: 'secret',
    refreshToken: 'refresh',
    fetchImpl: async (_url, options) => {
      body = String(options.body);
      return { ok: true, json: async () => ({ access_token: 'new-access', expires_in: 3600 }) };
    },
  });
  assert.equal(token.access_token, 'new-access');
  assert.match(body, /grant_type=refresh_token/);
});
