import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * The iOS project's `MARKETING_VERSION` must match `frontend/package.json`.
 *
 * `checkpoint-ship-ios.sh` passes `MARKETING_VERSION="$APP_VERSION"` to
 * xcodebuild, so *shipped* builds always carry the right number no matter what
 * the project file says. That is a good design — it makes the ship immune to
 * this drift — but it also means the literal in `project.pbxproj` is unused on
 * the one path anybody watches, and therefore rots unnoticed. It said 2.6.0 for
 * two months of ships once; it was found at 2.8.0 while package.json said
 * 2.9.2, and the ship script carried a comment asserting it "is kept in step",
 * which nothing implemented and which is exactly why nobody checked.
 *
 * It still matters for a plain Xcode GUI build (Product > Run), which gets no
 * override and stamps whatever the project file holds. The ship deliberately
 * won't rewrite a tracked file mid-build — that would leave the tree dirty for
 * the next run, which its own preflight rejects — so the check lives here,
 * where a version bump that forgets the project file fails loudly and locally
 * instead of silently shipping a wrong number to a GUI build months later.
 *
 * If this fails: update both `MARKETING_VERSION` literals in
 * `frontend/ios/App/App.xcodeproj/project.pbxproj` to match package.json.
 */

const REPO = path.resolve(__dirname, '..')
const PBXPROJ = path.join(REPO, 'ios/App/App.xcodeproj/project.pbxproj')

describe('ios project version tracks package.json', () => {
  const pkgVersion = JSON.parse(
    fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'),
  ).version as string

  it('reads a sane version from package.json', () => {
    expect(pkgVersion).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('has MARKETING_VERSION set in the Xcode project at all', () => {
    // Guard the guard: if the setting is renamed or removed, an empty match set
    // would make the parity assertion below vacuously pass.
    const found = [...fs.readFileSync(PBXPROJ, 'utf8').matchAll(/MARKETING_VERSION = ([^;]+);/g)]
    expect(found.length).toBeGreaterThan(0)
  })

  it('sets every MARKETING_VERSION to the package.json version', () => {
    const found = [
      ...fs.readFileSync(PBXPROJ, 'utf8').matchAll(/MARKETING_VERSION = ([^;]+);/g),
    ].map((m) => m[1].trim())
    // Every build configuration (Debug and Release) must agree — a bump that
    // updates only one leaves GUI builds inconsistent depending on scheme.
    for (const v of found) expect(v).toBe(pkgVersion)
  })
})
