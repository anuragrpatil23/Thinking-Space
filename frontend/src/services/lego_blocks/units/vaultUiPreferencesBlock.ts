export type ExplorerIconStyleBlock = 'outline' | 'filled'

export interface NewThoughtQuickDestinationPreferenceBlock {
  id: string
  label: string
  pathSegments: string[]
}

export interface ExplorerFolderColorPreferenceBlock {
  id: string
  folderPath: string
  color: string
  includeDescendants: boolean
}

export interface VaultSchedulerTaskPreferenceBlock {
  id: string
  action: string
  enabled: boolean
  timesOfDay: string[]
}

export type MoonSceneSpeakerBlock = 'astronaut' | 'clawd'

export const MOON_SCENE_ANIMATION_IDS_BLOCK = ['none', 'wave', 'dance', 'hop', 'cheer', 'spin', 'skate', 'wizard', 'run', 'float', 'sleep', 'hang', 'wag', 'nod', 'wobble', 'stretch', 'backflip'] as const
export type MoonSceneAnimationBlock = (typeof MOON_SCENE_ANIMATION_IDS_BLOCK)[number]

export interface MoonSceneMessagePreferenceBlock {
  id: string
  speaker: MoonSceneSpeakerBlock
  text: string
  /** HH:MM inclusive window start. A window where start > end wraps midnight. */
  startTime: string
  /** HH:MM exclusive window end. */
  endTime: string
  animation: MoonSceneAnimationBlock
  enabled: boolean
}

/** Fired on window whenever moon scene messages are saved, so the mounted
 *  scene can refresh without a reload. */
export const MOON_SCENE_MESSAGES_UPDATED_EVENT_BLOCK = 'thinking-space:moon-scene-messages-updated'

export interface VaultUiPreferencesBlock {
  explorerIconStyle: ExplorerIconStyleBlock
  newThoughtQuickDestinations: NewThoughtQuickDestinationPreferenceBlock[]
  explorerFolderColorRules: ExplorerFolderColorPreferenceBlock[]
  webullTabLabel: string
  webullTabIconText: string
  /** Gate for the experimental Webull → Sim subtab (F9 practice timeline). Off by default. */
  webullSimTabEnabled: boolean
  /**
   * Vault-relative folder the Sim timeline reads (cases/, eras.yaml, bench.md).
   * Blank means "derive a default beside the execution folder" (a sibling
   * `F9-sim`, mirroring `F9-execution`).
   */
  webullSimFolderPath: string
  fileActivityIgnoredPaths: string[]
  schedulerTasks: VaultSchedulerTaskPreferenceBlock[]
  moonSceneMessages: MoonSceneMessagePreferenceBlock[]
  /** When on (default), idle sprites occasionally play a random animation
   *  from the library (skate, wizard, float, ...) between scheduled messages. */
  moonSceneIdleAnimationsEnabled: boolean
  /** Show "Insights today" / "Memorized today" tiles + most-recent highlight
   *  rows on the home dashboard. Defaults to off — those tiles depend on a
   *  particular note structure (daily insight files / memorization sessions)
   *  most users won't have. */
  showDailyHighlights: boolean
}

export const DEFAULT_EXPLORER_FOLDER_COLOR_PRESET_BLOCK: ExplorerFolderColorPreferenceBlock[] = [
  { id: 'explorer-color-acceleration-core', folderPath: 'acceleration_core', color: '#1491d4', includeDescendants: false },
  { id: 'explorer-color-acceleration-core-webull', folderPath: 'acceleration_core/Webull', color: '#2e9fe5', includeDescendants: true },
  { id: 'explorer-color-acceleration-core-ideas-ai', folderPath: 'acceleration_core/ideas.ai', color: '#29ab87', includeDescendants: true },
  { id: 'explorer-color-acceleration-core-sfai', folderPath: 'acceleration_core/sfai', color: '#705cca', includeDescendants: true },
  { id: 'explorer-color-acceleration-core-sfj', folderPath: 'acceleration_core/sfj', color: '#e76f51', includeDescendants: true },
  { id: 'explorer-color-acceleration-core-sflc', folderPath: 'acceleration_core/sflc', color: '#f7c44c', includeDescendants: true },
  { id: 'explorer-color-lifeblood-systems', folderPath: 'lifeblood_systems', color: '#964bb4', includeDescendants: false },
  { id: 'explorer-color-lifeblood-systems-ff08', folderPath: 'lifeblood_systems/FF08', color: '#a65ac2', includeDescendants: true },
  { id: 'explorer-color-lifeblood-systems-sfcommunication', folderPath: 'lifeblood_systems/sfcommunication', color: '#8c3caa', includeDescendants: true },
  { id: 'explorer-color-lifeblood-systems-sfdl', folderPath: 'lifeblood_systems/sfdl', color: '#b26ccd', includeDescendants: true },
  { id: 'explorer-color-lifeblood-systems-sftravel', folderPath: 'lifeblood_systems/sftravel', color: '#be84dc', includeDescendants: true },
  { id: 'explorer-color-lifeblood-systems-sfw', folderPath: 'lifeblood_systems/sfw', color: '#aa5fd2', includeDescendants: true },
  { id: 'explorer-color-lifeblood-systems-understanding-myself', folderPath: 'lifeblood_systems/Understanding Myself', color: '#2e9fe5', includeDescendants: true },
]

function cloneExplorerFolderColorRulesBlock(
  rules: ExplorerFolderColorPreferenceBlock[],
): ExplorerFolderColorPreferenceBlock[] {
  return rules.map((rule) => ({ ...rule }))
}

export const DEFAULT_VAULT_UI_PREFERENCES_BLOCK: VaultUiPreferencesBlock = {
  explorerIconStyle: 'outline',
  newThoughtQuickDestinations: [],
  explorerFolderColorRules: cloneExplorerFolderColorRulesBlock(DEFAULT_EXPLORER_FOLDER_COLOR_PRESET_BLOCK),
  webullTabLabel: 'Webull',
  webullTabIconText: '',
  webullSimTabEnabled: false,
  webullSimFolderPath: '',
  fileActivityIgnoredPaths: [],
  schedulerTasks: [],
  moonSceneMessages: [],
  moonSceneIdleAnimationsEnabled: true,
  showDailyHighlights: false,
}

export function createDefaultVaultUiPreferencesBlock(): VaultUiPreferencesBlock {
  return {
    explorerIconStyle: DEFAULT_VAULT_UI_PREFERENCES_BLOCK.explorerIconStyle,
    newThoughtQuickDestinations: [],
    explorerFolderColorRules: cloneExplorerFolderColorRulesBlock(DEFAULT_VAULT_UI_PREFERENCES_BLOCK.explorerFolderColorRules),
    webullTabLabel: 'Webull',
    webullTabIconText: '',
    webullSimTabEnabled: false,
    webullSimFolderPath: '',
    fileActivityIgnoredPaths: [],
    schedulerTasks: [],
    moonSceneMessages: [],
    moonSceneIdleAnimationsEnabled: true,
    showDailyHighlights: false,
  }
}

export function normalizeExplorerIconStyleBlock(value: unknown): ExplorerIconStyleBlock {
  return value === 'filled' ? 'filled' : 'outline'
}

const HEX_COLOR_BLOCK_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

function normalizeFolderPathBlock(value: unknown): string {
  if (typeof value !== 'string') return ''
  const normalized = value
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join('/')
  return normalized
}

function normalizeHexColorBlock(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!HEX_COLOR_BLOCK_PATTERN.test(trimmed)) return ''
  const lower = trimmed.toLowerCase()
  if (lower.length === 4) {
    return `#${lower[1]}${lower[1]}${lower[2]}${lower[2]}${lower[3]}${lower[3]}`
  }
  return lower
}

function normalizeExplorerFolderColorRuleBlock(
  value: unknown,
  index: number,
): ExplorerFolderColorPreferenceBlock | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<ExplorerFolderColorPreferenceBlock>
  const folderPath = normalizeFolderPathBlock(record.folderPath)
  const color = normalizeHexColorBlock(record.color)
  if (!folderPath || !color) return null
  const id = typeof record.id === 'string' && record.id.trim()
    ? record.id.trim()
    : `explorer-color-${index + 1}`
  return {
    id,
    folderPath,
    color,
    includeDescendants: record.includeDescendants !== false,
  }
}

export function normalizeExplorerFolderColorPreferencesBlock(
  value: unknown,
): ExplorerFolderColorPreferenceBlock[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const normalized: ExplorerFolderColorPreferenceBlock[] = []
  for (const [index, candidate] of value.entries()) {
    const rule = normalizeExplorerFolderColorRuleBlock(candidate, index)
    if (!rule || seen.has(rule.id)) continue
    seen.add(rule.id)
    normalized.push(rule)
  }
  return normalized
}

function normalizePathSegmentsBlock(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((segment) => (typeof segment === 'string' ? segment.split('/') : []))
      .map((segment) => segment.trim())
      .filter(Boolean)
  }
  if (typeof value === 'string') {
    return value
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean)
  }
  return []
}

function normalizeQuickDestinationBlock(value: unknown): NewThoughtQuickDestinationPreferenceBlock | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<NewThoughtQuickDestinationPreferenceBlock>
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  const label = typeof record.label === 'string' ? record.label.trim() : ''
  const pathSegments = normalizePathSegmentsBlock(record.pathSegments)
  if (!id || !label || pathSegments.length === 0) return null
  return { id, label, pathSegments }
}

export function normalizeNewThoughtQuickDestinationsBlock(
  value: unknown,
): NewThoughtQuickDestinationPreferenceBlock[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const normalized: NewThoughtQuickDestinationPreferenceBlock[] = []
  for (const candidate of value) {
    const destination = normalizeQuickDestinationBlock(candidate)
    if (!destination || seen.has(destination.id)) continue
    seen.add(destination.id)
    normalized.push(destination)
  }
  return normalized
}

export function normalizeVaultUiPreferencesBlock(value: unknown): VaultUiPreferencesBlock {
  if (!value || typeof value !== 'object') return createDefaultVaultUiPreferencesBlock()
  const record = value as Partial<VaultUiPreferencesBlock>
  const normalizedExplorerFolderColorRules = Array.isArray(record.explorerFolderColorRules)
    ? normalizeExplorerFolderColorPreferencesBlock(record.explorerFolderColorRules)
    : cloneExplorerFolderColorRulesBlock(DEFAULT_VAULT_UI_PREFERENCES_BLOCK.explorerFolderColorRules)
  return {
    explorerIconStyle: normalizeExplorerIconStyleBlock(record.explorerIconStyle),
    newThoughtQuickDestinations: normalizeNewThoughtQuickDestinationsBlock(record.newThoughtQuickDestinations),
    explorerFolderColorRules: normalizedExplorerFolderColorRules,
    webullTabLabel: typeof record.webullTabLabel === 'string' && record.webullTabLabel.trim()
      ? record.webullTabLabel.trim()
      : 'Webull',
    webullTabIconText: typeof record.webullTabIconText === 'string'
      ? record.webullTabIconText.trim()
      : '',
    webullSimTabEnabled: typeof record.webullSimTabEnabled === 'boolean'
      ? record.webullSimTabEnabled
      : DEFAULT_VAULT_UI_PREFERENCES_BLOCK.webullSimTabEnabled,
    webullSimFolderPath: normalizeFolderPathBlock(record.webullSimFolderPath),
    fileActivityIgnoredPaths: normalizeFileActivityIgnoredPathsBlock(record.fileActivityIgnoredPaths),
    schedulerTasks: normalizeSchedulerTasksPreferenceBlock(record.schedulerTasks),
    moonSceneMessages: normalizeMoonSceneMessagesPreferenceBlock(record.moonSceneMessages),
    moonSceneIdleAnimationsEnabled: typeof record.moonSceneIdleAnimationsEnabled === 'boolean'
      ? record.moonSceneIdleAnimationsEnabled
      : true,
    showDailyHighlights: typeof record.showDailyHighlights === 'boolean'
      ? record.showDailyHighlights
      : DEFAULT_VAULT_UI_PREFERENCES_BLOCK.showDailyHighlights,
  }
}

function normalizeFileActivityIgnoredPathsBlock(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((p): p is string => typeof p === 'string' && p.trim().length > 0).map(p => p.trim())
}

function normalizeSchedulerTaskPreferenceBlock(value: unknown): VaultSchedulerTaskPreferenceBlock | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<VaultSchedulerTaskPreferenceBlock>
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  const action = typeof record.action === 'string' ? record.action.trim() : ''
  if (!id || !action) return null
  const timesOfDay = Array.isArray(record.timesOfDay)
    ? record.timesOfDay.filter((t): t is string => typeof t === 'string' && /^\d{2}:\d{2}$/.test(t.trim()))
    : []
  return {
    id,
    action,
    enabled: Boolean(record.enabled),
    timesOfDay: timesOfDay.length > 0 ? [...new Set(timesOfDay)].sort() : ['03:00'],
  }
}

function normalizeSchedulerTasksPreferenceBlock(value: unknown): VaultSchedulerTaskPreferenceBlock[] {
  if (!Array.isArray(value)) return []
  const tasks: VaultSchedulerTaskPreferenceBlock[] = []
  for (const candidate of value) {
    const task = normalizeSchedulerTaskPreferenceBlock(candidate)
    if (task) tasks.push(task)
  }
  return tasks
}

const TIME_OF_DAY_BLOCK_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

function normalizeMoonSceneMessagePreferenceBlock(
  value: unknown,
  index: number,
): MoonSceneMessagePreferenceBlock | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<MoonSceneMessagePreferenceBlock>
  const text = typeof record.text === 'string' ? record.text.trim() : ''
  if (!text) return null
  const startTime = typeof record.startTime === 'string' && TIME_OF_DAY_BLOCK_PATTERN.test(record.startTime.trim())
    ? record.startTime.trim()
    : null
  const endTime = typeof record.endTime === 'string' && TIME_OF_DAY_BLOCK_PATTERN.test(record.endTime.trim())
    ? record.endTime.trim()
    : null
  if (!startTime || !endTime) return null
  const animation = MOON_SCENE_ANIMATION_IDS_BLOCK.includes(record.animation as MoonSceneAnimationBlock)
    ? (record.animation as MoonSceneAnimationBlock)
    : 'none'
  return {
    id: typeof record.id === 'string' && record.id.trim() ? record.id.trim() : `moon-scene-message-${index + 1}`,
    speaker: record.speaker === 'clawd' ? 'clawd' : 'astronaut',
    text: text.slice(0, 120),
    startTime,
    endTime,
    animation,
    enabled: record.enabled !== false,
  }
}

export function normalizeMoonSceneMessagesPreferenceBlock(
  value: unknown,
): MoonSceneMessagePreferenceBlock[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const normalized: MoonSceneMessagePreferenceBlock[] = []
  for (const [index, candidate] of value.entries()) {
    const message = normalizeMoonSceneMessagePreferenceBlock(candidate, index)
    if (!message || seen.has(message.id)) continue
    seen.add(message.id)
    normalized.push(message)
  }
  return normalized
}

export function isMoonSceneMessageActiveBlock(
  message: MoonSceneMessagePreferenceBlock,
  now: Date = new Date(),
): boolean {
  if (!message.enabled) return false
  const minutes = now.getHours() * 60 + now.getMinutes()
  const [sh, sm] = message.startTime.split(':').map(Number)
  const [eh, em] = message.endTime.split(':').map(Number)
  const start = sh * 60 + sm
  const end = eh * 60 + em
  if (start === end) return false
  if (start < end) return minutes >= start && minutes < end
  // Window wraps midnight (e.g. 22:00 -> 06:00).
  return minutes >= start || minutes < end
}

export function serializeVaultUiPreferencesBlock(preferences: VaultUiPreferencesBlock): string {
  return `${JSON.stringify(preferences, null, 2)}\n`
}
