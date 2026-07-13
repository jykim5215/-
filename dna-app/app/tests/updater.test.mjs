import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const {
  createUpdaterController,
  createInitialStatus,
  errorMessage,
  publicInfo,
} = require('../src/main/updater');

class FakeUpdater extends EventEmitter {
  constructor() {
    super();
    this.checks = 0;
    this.installed = false;
  }

  async checkForUpdates() {
    this.checks += 1;
    this.emit('checking-for-update');
    this.emit('update-available', { version: '0.4.0', releaseName: 'Next' });
    this.emit('download-progress', { percent: 42, transferred: 42, total: 100 });
    this.emit('update-downloaded', { version: '0.4.0' });
  }

  quitAndInstall() {
    this.installed = true;
  }
}

test('updater — 초기 상태와 공개 정보 정규화', () => {
  assert.equal(createInitialStatus({ getVersion: () => '0.3.1' }, false).status, 'unsupported');
  assert.deepEqual(publicInfo({ version: 'v0.4.0', files: [{ url: 'x', size: 3 }] }), {
    version: '0.4.0',
    releaseName: '',
    releaseDate: '',
    files: [{ url: 'x', size: 3 }],
  });
  assert.match(errorMessage(new Error('latest.yml 404')), /업데이트 메타데이터/);
});

test('updater — 다운로드 완료 후 재시작 설치 가능', async () => {
  const fake = new FakeUpdater();
  const sent = [];
  const app = { isPackaged: true, getVersion: () => '0.3.1' };
  const controller = createUpdaterController({
    app,
    updater: fake,
    startupDelayMs: 1,
    getWindow: () => ({
      webContents: {
        isDestroyed: () => false,
        send: (_channel, payload) => sent.push(payload),
      },
    }),
  });

  const status = await controller.checkForUpdates({ manual: true });
  assert.equal(fake.checks, 1);
  assert.equal(status.status, 'downloaded');
  assert.equal(status.availableVersion, '0.4.0');
  assert.equal(status.downloaded, true);
  assert.equal(sent.some((item) => item.status === 'downloading'), true);

  controller.installUpdate();
  assert.equal(fake.installed, true);
  assert.equal(controller.getStatus().status, 'installing');
});
