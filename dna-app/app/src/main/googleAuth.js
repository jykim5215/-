const crypto = require('crypto');
const http = require('http');

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';
const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/generative-language.retriever',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
];

function parseClientCredentials(raw) {
  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    throw new Error('Google OAuth JSON을 읽을 수 없습니다.');
  }
  const config = parsed?.installed || parsed?.web;
  if (!config?.client_id || !config?.client_secret) {
    throw new Error('데스크톱 OAuth 클라이언트 JSON이 아닙니다.');
  }
  return {
    clientId: String(config.client_id),
    clientSecret: String(config.client_secret),
    projectId: String(config.project_id || ''),
    type: parsed.installed ? 'installed' : 'web',
  };
}

function base64Url(buffer) {
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createPkce() {
  const verifier = base64Url(crypto.randomBytes(48));
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function buildAuthorizationUrl({ clientId, redirectUri, state, challenge }) {
  const url = new URL(AUTH_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();
  return url.toString();
}

function scopesFromToken(tokens) {
  return String(tokens?.scope || '')
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function missingScopes(tokens, requiredScopes = SCOPES) {
  const granted = new Set(scopesFromToken(tokens));
  return requiredScopes.filter((scope) => !granted.has(scope));
}

async function responseJson(response, label) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${label} 실패: ${body.error_description || body.error || response.status}`);
  }
  return body;
}

async function exchangeCode({
  code,
  clientId,
  clientSecret,
  redirectUri,
  verifier,
  fetchImpl = globalThis.fetch,
}) {
  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  return responseJson(response, 'Google 토큰 교환');
}

async function refreshAccessToken({
  clientId,
  clientSecret,
  refreshToken,
  fetchImpl = globalThis.fetch,
}) {
  if (!refreshToken) throw new Error('Google 재로그인이 필요합니다.');
  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  return responseJson(response, 'Google 토큰 갱신');
}

async function fetchProfile(accessToken, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const profile = await responseJson(response, 'Google 프로필 조회');
  return {
    id: String(profile.sub || ''),
    name: String(profile.name || ''),
    givenName: String(profile.given_name || ''),
    email: String(profile.email || ''),
    emailVerified: Boolean(profile.email_verified),
    picture: String(profile.picture || ''),
  };
}

function successHtml(ok, message) {
  const color = ok ? '#13795b' : '#b3261e';
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><title>DNA 편집 스튜디오</title>
    <body style="font-family:system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#f7f8fa;color:#17191f">
      <main style="width:min(420px,calc(100% - 40px));background:white;border:1px solid #e3e5e9;padding:28px">
        <div style="font-size:12px;font-weight:800;color:${color};margin-bottom:10px">DNA 편집 스튜디오</div>
        <h1 style="font-size:22px;margin:0 0 8px">${ok ? 'Google 계정 연결 완료' : '연결하지 못했습니다'}</h1>
        <p style="font-size:14px;line-height:1.6;color:#5d626d;margin:0">${message}</p>
      </main>
    </body></html>`;
}

async function connect({
  clientId,
  clientSecret,
  openExternal,
  fetchImpl = globalThis.fetch,
  timeoutMs = 600000,
}) {
  if (!clientId || !clientSecret) throw new Error('Google OAuth 클라이언트를 먼저 등록하세요.');
  const state = base64Url(crypto.randomBytes(24));
  const { verifier, challenge } = createPkce();

  let resolveCallback;
  let rejectCallback;
  const callback = new Promise((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });

  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
    if (requestUrl.pathname !== '/oauth2/callback') {
      response.writeHead(404).end();
      return;
    }
    const error = requestUrl.searchParams.get('error');
    const returnedState = requestUrl.searchParams.get('state');
    const code = requestUrl.searchParams.get('code');
    if (error || returnedState !== state || !code) {
      const message = error === 'access_denied'
        ? '사용자가 연결을 취소했습니다.'
        : 'OAuth 응답을 확인할 수 없습니다.';
      response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(successHtml(false, message));
      rejectCallback(new Error(message));
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(successHtml(true, '이 창을 닫고 DNA 편집 스튜디오로 돌아가세요.'));
    resolveCallback(code);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const redirectUri = `http://127.0.0.1:${address.port}/oauth2/callback`;
  const authUrl = buildAuthorizationUrl({ clientId, redirectUri, state, challenge });
  const timer = setTimeout(() => rejectCallback(new Error('Google 로그인 시간이 만료되었습니다. 브라우저 인증창에서 다시 시도해 주세요.')), timeoutMs);

  try {
    await openExternal(authUrl);
    const code = await callback;
    const tokens = await exchangeCode({
      code,
      clientId,
      clientSecret,
      redirectUri,
      verifier,
      fetchImpl,
    });
    const profile = await fetchProfile(tokens.access_token, fetchImpl);
    return {
      profile,
      tokens: {
        accessToken: tokens.access_token || '',
        refreshToken: tokens.refresh_token || '',
        idToken: tokens.id_token || '',
        scope: tokens.scope || SCOPES.join(' '),
        tokenType: tokens.token_type || 'Bearer',
        expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000,
      },
    };
  } finally {
    clearTimeout(timer);
    await new Promise((resolve) => server.close(resolve));
  }
}

module.exports = {
  AUTH_ENDPOINT,
  TOKEN_ENDPOINT,
  USERINFO_ENDPOINT,
  SCOPES,
  parseClientCredentials,
  createPkce,
  buildAuthorizationUrl,
  scopesFromToken,
  missingScopes,
  exchangeCode,
  refreshAccessToken,
  fetchProfile,
  connect,
};
