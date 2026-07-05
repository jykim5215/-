// 렌더러에 노출하는 최소 API 표면 (contextBridge)
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('dnaAPI', {
  settingsGet: invoke('settings:get'),
  settingsSet: invoke('settings:set'),
  hasApiKey: invoke('settings:hasApiKey'),

  projectCreate: invoke('project:create'),
  projectList: invoke('project:list'),
  projectGet: invoke('project:get'),
  projectSetStage: invoke('project:setStage'),
  materialAdd: invoke('material:add'),
  materialList: invoke('material:list'),

  outputSave: invoke('output:save'),
  outputLatest: invoke('output:latest'),
  recordFinalize: invoke('record:finalize'),
  recordFeedback: invoke('record:feedback'),
  recordMetrics: invoke('record:metrics'),
  datasetExport: invoke('dataset:export'),

  validateQuotes: invoke('validate:quotes'),
  validateCardplan: invoke('validate:cardplan'),
  validateEmail: invoke('validate:email'),

  extractUrl: invoke('extract:url'),
  extractFile: invoke('extract:file'),
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
  showFile: invoke('shell:showFile'),
});
