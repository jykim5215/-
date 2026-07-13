const UPDATE_CHANNEL = 'update:event';

function safeVersion(info = {}) {
  return String(info.version || info.tag || info.releaseName || '').replace(/^v/i, '');
}

function publicInfo(info = {}) {
  return {
    version: safeVersion(info),
    releaseName: info.releaseName || '',
    releaseDate: info.releaseDate || '',
    files: Array.isArray(info.files) ? info.files.map((file) => ({
      url: file.url || '',
      size: file.size || 0,
    })) : [],
  };
}

function errorMessage(error) {
  const text = String(error?.message || error || '알 수 없는 업데이트 오류');
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network|fetch/i.test(text)) {
    return '업데이트 서버에 연결하지 못했습니다. 네트워크를 확인한 뒤 다시 시도하세요.';
  }
  if (/latest\.yml|404|Not Found/i.test(text)) {
    return '아직 배포된 업데이트 메타데이터가 없습니다. GitHub Releases에 latest.yml과 설치본을 올린 뒤 다시 확인하세요.';
  }
  return text;
}

function createInitialStatus(app, enabled) {
  return {
    enabled,
    status: enabled ? 'idle' : 'unsupported',
    currentVersion: app.getVersion ? app.getVersion() : '0.0.0',
    availableVersion: '',
    available: false,
    downloaded: false,
    checking: false,
    progress: null,
    message: enabled
      ? '업데이트 확인 대기 중'
      : '자동 업데이트는 패키징된 설치본에서만 사용할 수 있습니다.',
    error: '',
  };
}

function loadAutoUpdater() {
  return require('electron-updater').autoUpdater;
}

function createUpdaterController({
  app,
  getWindow,
  updater = loadAutoUpdater(),
  logger = console,
  startupDelayMs = 8000,
} = {}) {
  if (!app) throw new Error('updater controller requires app');
  const enabled = Boolean(app.isPackaged || process.env.DNA_ENABLE_DEV_UPDATES === '1');
  const state = createInitialStatus(app, enabled);
  let initialized = false;
  let checking = false;
  let startupTimer = null;

  function send(patch = {}) {
    Object.assign(state, patch);
    const win = typeof getWindow === 'function' ? getWindow() : null;
    if (win?.webContents && !win.webContents.isDestroyed?.()) {
      win.webContents.send(UPDATE_CHANNEL, getStatus());
    }
    return getStatus();
  }

  function getStatus() {
    return { ...state, progress: state.progress ? { ...state.progress } : null };
  }

  function ensureInitialized() {
    if (initialized) return;
    initialized = true;
    if (!enabled) return;

    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    if ('logger' in updater) updater.logger = logger;

    updater.on('checking-for-update', () => {
      checking = true;
      send({
        status: 'checking',
        checking: true,
        error: '',
        message: '새 버전을 확인하는 중입니다.',
      });
    });
    updater.on('update-available', (info) => {
      const version = safeVersion(info);
      send({
        status: 'available',
        available: true,
        availableVersion: version,
        downloaded: false,
        progress: { percent: 0 },
        message: `${version || '새 버전'} 업데이트를 다운로드합니다.`,
        info: publicInfo(info),
      });
    });
    updater.on('update-not-available', () => {
      checking = false;
      send({
        status: 'current',
        available: false,
        downloaded: false,
        checking: false,
        progress: null,
        message: '현재 최신 버전입니다.',
      });
    });
    updater.on('download-progress', (progress) => {
      checking = false;
      send({
        status: 'downloading',
        checking: false,
        progress: {
          percent: Math.max(0, Math.min(100, Number(progress.percent || 0))),
          transferred: Number(progress.transferred || 0),
          total: Number(progress.total || 0),
          bytesPerSecond: Number(progress.bytesPerSecond || 0),
        },
        message: `업데이트 다운로드 중 ${Math.round(Number(progress.percent || 0))}%`,
      });
    });
    updater.on('update-downloaded', (info) => {
      checking = false;
      const version = safeVersion(info) || state.availableVersion;
      send({
        status: 'downloaded',
        available: true,
        downloaded: true,
        checking: false,
        availableVersion: version,
        progress: { percent: 100 },
        message: '업데이트 다운로드 완료. 재시작하면 설치됩니다.',
        info: publicInfo(info),
      });
    });
    updater.on('error', (error) => {
      checking = false;
      send({
        status: 'error',
        checking: false,
        error: errorMessage(error),
        message: '업데이트 확인에 실패했습니다.',
      });
    });
  }

  async function checkForUpdates({ manual = false } = {}) {
    ensureInitialized();
    if (!enabled) return getStatus();
    if (checking) return getStatus();
    checking = true;
    send({
      status: 'checking',
      checking: true,
      error: '',
      message: manual ? '업데이트를 직접 확인하는 중입니다.' : '업데이트를 확인하는 중입니다.',
    });
    try {
      await updater.checkForUpdates();
    } catch (error) {
      checking = false;
      return send({
        status: 'error',
        checking: false,
        error: errorMessage(error),
        message: '업데이트 확인에 실패했습니다.',
      });
    }
    return getStatus();
  }

  function installUpdate() {
    ensureInitialized();
    if (!enabled) return getStatus();
    if (!state.downloaded) {
      return send({
        status: state.status,
        message: '설치할 업데이트가 아직 다운로드되지 않았습니다.',
      });
    }
    send({ status: 'installing', message: '앱을 재시작하고 업데이트를 설치합니다.' });
    updater.quitAndInstall(false, true);
    return getStatus();
  }

  function scheduleStartupCheck() {
    ensureInitialized();
    if (!enabled || startupTimer) return getStatus();
    startupTimer = setTimeout(() => {
      startupTimer = null;
      checkForUpdates({ manual: false }).catch((error) => {
        logger.warn?.('[updater]', error);
      });
    }, startupDelayMs);
    return getStatus();
  }

  return {
    getStatus,
    checkForUpdates,
    installUpdate,
    scheduleStartupCheck,
    _send: send,
  };
}

module.exports = {
  UPDATE_CHANNEL,
  createUpdaterController,
  createInitialStatus,
  publicInfo,
  errorMessage,
};
