import { isExcalidrawPathBlock } from '@/services/lego_blocks/units/excalidrawPathBlock'
import { configuredVaultNameBlock } from '@/services/lego_blocks/units/vaultNameBlock'

function toObsidianFileTarget(path: string): string {
  return path.toLowerCase().endsWith('.md') ? path.slice(0, -3) : path
}

export function isExcalidrawFile(path: string): boolean {
  return isExcalidrawPathBlock(path)
}

export function buildObsidianOpenUrl(path: string): string {
  const vaultName = configuredVaultNameBlock() ?? 'Thinking Space iCloud'
  const fileTarget = toObsidianFileTarget(path)
  return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(fileTarget)}`
}

export function openFileInObsidian(path: string): void {
  window.location.href = buildObsidianOpenUrl(path)
}
