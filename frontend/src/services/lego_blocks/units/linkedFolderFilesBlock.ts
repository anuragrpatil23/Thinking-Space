// How a folder's files are worded and ordered for a reader, for any folder view.

export function fileSizeWordBlock(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

/** README, then notes, then scripts, then everything else. */
export function folderFileRankBlock(name: string): number {
  const lower = name.toLowerCase()
  if (lower.startsWith('readme')) return 0
  if (/\.(md|txt|rst)$/.test(lower)) return 1
  if (/\.(py|sh|bash|zsh|r|jl|js|ts|ipynb|slurm|lsf)$/.test(lower)) return 2
  return 3
}

export function sortFolderFilesBlock<T extends { name: string }>(files: T[]): T[] {
  return [...files].sort((a, b) => folderFileRankBlock(a.name) - folderFileRankBlock(b.name) || a.name.localeCompare(b.name))
}
