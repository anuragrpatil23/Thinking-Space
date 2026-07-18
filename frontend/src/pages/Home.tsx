import HomeFlatOrch from '@/components/orchestrators/HomeFlatOrch'

// Home is the flat (non-spatial) frame — the iOS/web presentation of the same
// content the spatial canvas anchor renders. Electron routes to <HomeCanvas />
// instead (see App.tsx). The old bespoke dashboard composition was retired in
// favor of this shared-content frame so the two homes stay in lockstep.
export default function Home() {
  return <HomeFlatOrch />
}
