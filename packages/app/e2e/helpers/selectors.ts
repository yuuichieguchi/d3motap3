export const S = {
  // Header
  appHeader: '.app-header',
  appTitle: '.app-header h1',
  statusBadge: '.status-badge',

  // Source Panel
  sourcePanel: '.source-panel-v2',
  addSourceBtn: '.add-source-btn',
  sourceItem: '.source-item',
  sourceRemoveBtn: '.source-remove-btn',
  emptyMessage: '.empty-message',

  // Dialog
  dialogOverlay: '.dialog-overlay',
  dialog: '.dialog',
  dialogCloseBtn: '.dialog-close-btn',
  sourceOptionBtn: '.source-option-btn',

  // Layout
  layoutSelector: '.layout-selector',
  layoutOptions: '.layout-options',
  layoutOption: '.layout-option',
  layoutOptionSelected: '.layout-option.selected',
  layoutWarning: '.layout-warning',

  // Preview
  previewCanvas: '.preview-canvas-element',
  previewPlaceholder: '.preview-placeholder',

  // Recording
  recordBtnStart: '.record-btn.start',
  recordBtnStop: '.record-btn.stop',
  recordBtnProcessing: '.record-btn.processing',
  elapsedTime: '.elapsed-time',

  // Script Panel
  scriptSection: '.script-section',
  scriptProgress: '.script-progress',
  progressFill: '.progress-fill',
  scriptStatus: '.script-status',
  filePath: '.file-path',

  // AI Panel
  aiSection: '.ai-section',
  aiTabs: '.ai-tabs',
  aiResult: '.ai-result',
  resetBtn: '.reset-btn',

  // Common
  errorBox: '.error-box',
  resultBox: '.result-box',
  controlGroup: '.control-group',
  sourceList: '.source-list',

  // Recording Section
  recordingSection: '.recording-section',
  appFooter: '.app-footer',

  // Navigation
  navBtn: '.nav-btn',
  editBtn: '.edit-btn',

  // Editor View
  editorView: '.editor-view',
  editorHeader: '.editor-header',
  editorExportBtn: '.editor-export-btn',
  editorPreview: '.editor-preview',
  editorVideo: '.editor-video',
  editorEmptyState: '.editor-empty-state',
  editorToolbar: '.editor-toolbar',
  editorPlayback: '.editor-playback',
  playBtn: '.play-btn',
  seekBar: '.seek-bar',
  timeDisplay: '.time-display',
  exportProgressBar: '.export-progress-bar',

  // Timeline
  timeline: '.timeline',
  timelineEmpty: '.timeline-empty',
  timelineTrack: '.timeline-track',
  timelineClip: '.timeline-clip',
  timelineClipSelected: '.timeline-clip.selected',
  transitionIndicator: '.transition-indicator',
  transitionActive: '.transition-indicator.has-transition',
  timelineOverlay: '.timeline-overlay',
  timelineOverlaySelected: '.timeline-overlay.selected',
  timelinePlayhead: '.timeline-playhead',
  overlayTextLabel: '.overlay-text-label',
  overlayTrack: '.overlay-track',
  clipTrack: '.clip-track',

  // Panels
  textOverlayEditor: '.text-overlay-editor',
  dialogContent: '.dialog-content',
  exportProgress: '.export-progress',

  // Terminal
  terminalInputArea: '.terminal-input-area',
  terminalFocused: '.terminal-input-area.terminal-focused',

  // AI extras
  captionControls: '.caption-controls',
  captionBtnApply: '.caption-btn.apply',
  captionBtnClear: '.caption-btn.clear',
  scriptRunControls: '.script-run-controls',
  scriptRunBtn: '.script-run-btn',
} as const;
