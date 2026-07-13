// 렌더러에 노출하는 최소 API 표면 (contextBridge)
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('dnaAPI', {
  settingsGet: invoke('settings:get'),
  settingsSet: invoke('settings:set'),
  hasApiKey: invoke('settings:hasApiKey'),
  hasSmtpPass: invoke('settings:hasSmtpPass'),
  updateStatus: invoke('update:status'),
  updateCheck: invoke('update:check'),
  updateInstall: invoke('update:install'),
  onUpdateEvent(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('update:event', listener);
    return () => ipcRenderer.removeListener('update:event', listener);
  },
  googleConfigure: invoke('google:configure'),
  googleStatus: invoke('google:status'),
  googleConnect: invoke('google:connect'),
  googleDisconnect: invoke('google:disconnect'),
  driveListFiles: invoke('drive:listFiles'),
  driveDownloadFile: invoke('drive:downloadFile'),
  driveUploadFile: invoke('drive:uploadFile'),
  devStatus: invoke('dev:status'),
  devUploadReference: invoke('dev:uploadReference'),
  devAnalyzeReferences: invoke('dev:analyzeReferences'),
  devApplyAutomationProfile: invoke('dev:applyAutomationProfile'),
  mailVerify: invoke('mail:verify'),
  mailSend: invoke('mail:send'),
  mailImapVerify: invoke('mail:imapVerify'),
  mailInboxList: invoke('mail:inboxList'),
  mailInboxRead: invoke('mail:inboxRead'),
  mailContacts: invoke('mail:contacts'),

  projectCreate: invoke('project:create'),
  projectList: invoke('project:list'),
  projectGet: invoke('project:get'),
  projectSetStage: invoke('project:setStage'),
  projectRename: invoke('project:rename'),
  projectDelete: invoke('project:delete'),
  materialAdd: invoke('material:add'),
  materialList: invoke('material:list'),
  materialDelete: invoke('material:delete'),
  materialUpdate: invoke('material:update'),

  outputSave: invoke('output:save'),
  outputLatest: invoke('output:latest'),
  outputVersions: invoke('output:versions'),
  outputGet: invoke('output:get'),
  recordFinalize: invoke('record:finalize'),
  recordFeedback: invoke('record:feedback'),
  recordMetrics: invoke('record:metrics'),
  datasetExport: invoke('dataset:export'),

  validateQuotes: invoke('validate:quotes'),
  validateReadiness: invoke('validate:readiness'),
  validateCardplan: invoke('validate:cardplan'),
  validateEmail: invoke('validate:email'),

  extractUrl: invoke('extract:url'),
  extractFile: invoke('extract:file'),
  filePreview: invoke('file:preview'),
  filePreviewPath: invoke('file:previewPath'),
  fileStoreLocal: invoke('file:storeLocal'),
  transcribeDiagnose: invoke('transcribe:diagnose'),
  transcribeAudio: invoke('transcribe:audio'),
  transcribeSetup: invoke('transcribe:setup'),
  onTranscribeSetupEvent(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('transcribe:setupEvent', listener);
    return () => ipcRenderer.removeListener('transcribe:setupEvent', listener);
  },
  archiveSearch: invoke('archive:search'),
  archiveCount: invoke('archive:count'),
  backupRun: invoke('backup:run'),

  aiSuggestMaterials: invoke('ai:suggestMaterials'),
  openExternal: invoke('shell:openExternal'),

  aiBrainstorm: invoke('ai:brainstorm'),
  aiEmail: invoke('ai:email'),
  aiAnalyze: invoke('ai:analyze'),
  aiDraft: invoke('ai:draft'),
  aiCardplan: invoke('ai:cardplan'),
  cardnewsGenerate: invoke('cardnews:generate'),
  draftExportDocx: invoke('draft:exportDocx'),
  draftExportPdf: invoke('draft:exportPdf'),
  spellCheck: invoke('spell:check'),
  showFile: invoke('shell:showFile'),
  openPath: invoke('shell:openPath'),
});
