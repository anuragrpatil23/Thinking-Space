// Vault paths are always relative. An absolute path names a markdown file
// outside the vault that macOS handed to the app (`open-file`); main serves it
// only if it granted that exact file. See docs/contracts/SECURITY.md.
export function isExternalDocumentPathBlock(path: string): boolean {
  return path.startsWith('/')
}
