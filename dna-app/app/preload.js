// 렌더러에 노출하는 최소 API 표면 (contextBridge)
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('dnaAPI', {
  settingsGet: invoke('settings:get'),
  settingsSet: invoke('settings:set'),
  hasApiKey: invoke('settings:hasApiKey'),
  hasSmtpPass: invoke('settings:hasSmtpPass'),
  mailVerify: invoke('mail:verify'),
  mailSend: invoke('mail:send'),

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
  validateCardplan: invoke('validate:cardplan'),
  validateEmail: invoke('validate:email'),

  extractUrl: invoke('extract:url'),
  extractFile: invoke('extract:file'),
  transcribeDiagnose: invoke('transcribe:diagnose'),
  transcribeAudio: invoke('transcribe:audio'),
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
});
