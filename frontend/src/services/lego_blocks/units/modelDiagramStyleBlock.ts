// The stylesheet of a model diagram, as one string so the same rules reach the
// app and the exported page. The rules are those of the hand-built
// gpt-with-sparse-network.html, scoped under `.mdg`; the colours are tokens on
// that root, light by default and dark under `data-theme="dark"`.
const LIGHT = `--bg:#f6f7f9;--panel:#ffffff;--fg:#161a22;--muted:#5a6473;--rule:#d8dce4;
--tile:#b7c0cf;--slab:#f3f5f8;--bar:#dd8327;--neuron:#7b2d8e;--ex:#1493c9;--tgreen:#2c7d59;--hint:#dc4b45;
--c1:#e58a2b;--c2:#dc4b45;--c3:#e062a8;--c4:#3b76d6;--c5:#23a9bd;--c6:#3d9b5f;--c7:#8f6bd9;--c8:#a8862a;`
const DARK = `--bg:#0f1218;--panel:#171b24;--fg:#e7eaf0;--muted:#9aa4b4;--rule:#2b313d;
--tile:#3d4656;--slab:#1a1f29;--bar:#f0a050;--neuron:#c896ea;--ex:#5cc8f0;--tgreen:#6fcf9f;--hint:#ee6660;
--c1:#f09a3e;--c2:#ee6660;--c3:#ee7fbd;--c4:#5b93ee;--c5:#3fc3d6;--c6:#58b97b;--c7:#a98cf0;--c8:#cfae4a;color-scheme:dark;`

export const MODEL_DIAGRAM_CSS_BLOCK = `
.mdg{${LIGHT}
--sans:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif;--mono:"IBM Plex Mono",ui-monospace,Menlo,Consolas,monospace;
background:var(--bg);color:var(--fg);font-family:var(--sans);font-size:15px;line-height:1.55;display:flex;flex-direction:column;gap:16px;min-width:0;text-align:left}
.mdg[data-theme="dark"]{${DARK}}
.mdg.app{--bg:hsl(var(--background));--panel:hsl(var(--card));--fg:hsl(var(--foreground));--muted:hsl(var(--muted-foreground));--rule:hsl(var(--border));
--sans:-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display",Inter,system-ui,sans-serif;background:transparent}
.mdg.app .stageframe{border:0;border-radius:0;background:transparent;width:100%;max-width:100%}
.mdg.app.full{background:var(--bg)}
.mdg.app:not(.full) .stageframe{align-self:flex-start;flex:none;overflow:hidden;-webkit-mask-image:linear-gradient(to right,transparent 0,#000 56px,#000 calc(100% - 56px),transparent 100%);mask-image:linear-gradient(to right,transparent 0,#000 56px,#000 calc(100% - 56px),transparent 100%)}
.mdg.app .viewbtns{top:auto;bottom:12px;right:12px;flex-direction:row;align-items:stretch;gap:0;height:32px;border:1px solid var(--rule);border-radius:9px;overflow:hidden;background:var(--panel);box-shadow:0 1px 3px rgb(0 0 0 / .12)}
.mdg.app .viewbtns button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:34px;width:auto;height:100%;margin:0;padding:0 9px;font-size:12.5px;line-height:1;border:0;border-radius:0;background:transparent;box-shadow:none;backdrop-filter:none;-webkit-backdrop-filter:none;color:var(--fg)}
.mdg.app .viewbtns button+button{border-left:1px solid var(--rule)} .mdg.app .viewbtns button[aria-pressed="true"]{background:hsl(var(--primary));color:hsl(var(--primary-foreground))} .mdg.app .viewbtns button[hidden]{display:none} .mdg.app .viewbtns button:hover{background:color-mix(in srgb,var(--fg) 8%,transparent)} .mdg.app .viewbtns button.run{padding:0 12px 0 9px} .mdg.app .viewbtns svg{display:block;flex:none}
.mdg.app .stepbtns{display:none}
.mdg.app:not(.full) .viewbtns{right:64px}
.mdg.app .navsec{margin-left:auto} .mdg.app .navtools{display:flex;gap:6px;margin-left:14px} .mdg.app .navtools button{font-size:12px;padding:4px 10px;white-space:nowrap}
.mdg.app{gap:12px;outline:none}
.mdg.app .stageframe{min-height:min(68vh,640px)}
.mdg.app button{border-radius:8px;transition:background-color .12s,border-color .12s,color .12s}
.mdg.app .strip{display:none}
.mdg.app .stepbtns .walk{display:none}
.mdg.app .nav{display:flex;flex-direction:column;gap:10px;position:relative}
.mdg.app .bar2{padding-bottom:12px;border-bottom:1px solid var(--rule)} .mdg.app.full .bar2{border-bottom:0;padding-bottom:0}
.mdg.app.full .nav{grid-area:1 / 1 / 2 / -1} .mdg.app.full .bar2{grid-area:2 / 1 / 3 / -1}
.mdg.app .navrow{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0} .mdg.app .navrow .track{margin-left:16px;padding-top:15px}
.mdg.app .navhome{font-size:12.5px;padding:5px 11px;border-radius:999px} .mdg.app .navhome[aria-pressed="true"]{background:hsl(var(--primary));color:hsl(var(--primary-foreground));border-color:hsl(var(--primary));box-shadow:none}
.mdg.app .navarrow{width:28px;height:28px;padding:0;font-size:18px;line-height:1;border-radius:999px;display:grid;place-items:center;flex:none}
.mdg.app .navcur{display:flex;align-items:baseline;gap:10px;border:0;background:transparent;padding:3px 8px;font-size:17px;font-weight:600;min-width:0}
.mdg.app .navcur:hover{background:color-mix(in srgb,var(--fg) 8%,transparent)}
.mdg.app .navname{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mdg.app .navcount{font-family:var(--mono);font-size:12px;font-weight:400;color:var(--muted);white-space:nowrap}
.mdg.app .navcaret{font-size:11px;color:var(--muted)}
.mdg.app .navsec{margin-left:auto;font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);white-space:nowrap}
.mdg.app .track{display:flex;flex-wrap:wrap;gap:10px 8px;align-items:flex-start;position:relative}
.mdg.app .seg{display:flex;flex-direction:column;gap:5px;min-width:0;flex:none}
.mdg.app .dots{display:flex;gap:5px;align-items:center;height:20px;padding:0 7px;border-radius:999px;background:color-mix(in srgb,var(--fg) 5%,transparent)}
.mdg.app .seg.cur .dots{background:color-mix(in srgb,var(--fg) 10%,transparent)}
.mdg.app .dot{width:8px;height:8px;padding:0;border-radius:999px;border:1.5px solid color-mix(in srgb,var(--fg) 38%,transparent);background:transparent;flex:none;box-shadow:none;transition:transform .12s,background-color .12s,border-color .12s}
.mdg.app .dot:hover{transform:scale(1.45);border-color:var(--fg)}
.mdg.app .dot.done{background:color-mix(in srgb,var(--fg) 38%,transparent);border-color:transparent}
.mdg.app .dot.cur{background:hsl(var(--primary));border-color:hsl(var(--primary));transform:scale(1.5)}
.mdg.app .dots{align-self:flex-start}
.mdg.app .seglabel{font-size:9.5px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);white-space:nowrap;padding:0 7px}
.mdg.app .seg.cur .seglabel{color:var(--fg)}
.mdg.app .bubble{position:absolute;transform:translateX(-50%);background:var(--fg);color:var(--bg);font-size:12px;font-weight:500;padding:3px 8px;border-radius:6px;white-space:nowrap;pointer-events:none;z-index:6}
.mdg.app .navlist{position:absolute;top:38px;left:0;z-index:20;display:flex;flex-wrap:wrap;gap:12px 20px;max-width:min(100%,920px);max-height:60vh;overflow:auto;padding:12px 14px;background:var(--panel);border:1px solid var(--rule);border-radius:12px;box-shadow:0 14px 36px rgb(0 0 0 / .16)}
.mdg.app .lsec{display:flex;flex-direction:column;gap:1px;min-width:176px}
.mdg.app .lhead{font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);padding:2px 8px 4px}
.mdg.app .litem{border:0;background:transparent;text-align:left;font-size:13px;padding:4px 8px;border-radius:6px;box-shadow:none}
.mdg.app .litem:hover{background:color-mix(in srgb,var(--fg) 8%,transparent)} .mdg.app .litem[aria-current="step"]{background:hsl(var(--primary));color:hsl(var(--primary-foreground))}
.mdg.app.full .nav{grid-column:1 / -1;border-bottom:0;padding-bottom:0}
.mdg.app .viewbtns button,.mdg.app .stepbtns button{background:color-mix(in srgb,var(--panel) 78%,transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);box-shadow:0 1px 2px rgb(0 0 0 / .06)}
.mdg.app .bar2{gap:10px 22px;font-size:12.5px;align-items:center} .mdg.app .bar2 button{font-size:12.5px;padding:4px 10px;white-space:nowrap}
.mdg.app .bar2 .g{gap:6px;flex-wrap:nowrap} .mdg.app .bar2 .l{font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);white-space:nowrap;margin-right:2px}
.mdg.app .bar2 .g.join{gap:0} .mdg.app .bar2 .g.join .l{margin-right:8px} .mdg.app .bar2 .g.join button{border-radius:0;margin-left:-1px;position:relative}
.mdg.app .bar2 .g.join button:first-of-type{border-radius:7px 0 0 7px;margin-left:0} .mdg.app .bar2 .g.join button:last-of-type{border-radius:0 7px 7px 0} .mdg.app .bar2 .g.join button:only-of-type{border-radius:7px}
.mdg.app .bar2 .g.join button[aria-pressed="true"]{z-index:1;background:hsl(var(--primary));color:hsl(var(--primary-foreground));border-color:hsl(var(--primary));outline:0;box-shadow:none}
.mdg.app .bar2 .g.readout{gap:8px;padding:4px 12px;border-radius:7px;background:color-mix(in srgb,var(--fg) 7%,transparent);font-family:var(--mono);font-size:12px;min-width:0} .mdg.app .bar2 .g.readout .l{margin:0} .mdg.app .bar2 .g.readout{padding:3px 4px} .mdg.app .bar2 .g.readout button{width:24px;height:24px;padding:0;font-size:16px;line-height:1;border-radius:6px;display:grid;place-items:center;flex:none;font-family:inherit} .mdg.app .bar2 .g.readout button:first-child{margin-right:4px} .mdg.app .bar2 .g.readout button:last-child{margin-left:4px} .mdg.app .bar2 .g.right{margin-left:auto} .mdg.app .bar2 .g.readout .mono{display:inline-block;min-width:13ch}
.mdg.app .bar2 .v.dim{color:var(--muted);font-size:12px;margin:0 6px}
.mdg.app .bar2 .v{font-size:12.5px;color:var(--fg);white-space:nowrap;font-variant-numeric:tabular-nums} .mdg.app .bar2 .g.pager button{width:26px;height:26px;padding:0;font-size:16px;line-height:1;border-radius:999px;display:grid;place-items:center} .mdg.app .bar2 .g.pager .v{min-width:52px;text-align:center}
.mdg.app .eyebrow{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:baseline;font-size:12px;color:var(--muted);padding-bottom:8px;margin-bottom:2px;border-bottom:1px solid var(--rule)} .mdg.app .eyebrow b{font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--fg)}
.mdg.app .card.open>button{top:8px}
.mdg.app{--insp:min(470px,42%)}
.mdg.app .pop{position:absolute;z-index:6;top:0;bottom:0;right:0;width:var(--insp);display:none;flex-direction:column;gap:0;overflow:auto;background:var(--bg);border-left:1px solid var(--rule)} .mdg.app.inspect .pop{display:flex}
.mdg.app:not(.full) .pop{right:56px;border-right:1px solid var(--rule)}
.mdg.app.inspect .mdg-stage,.mdg.app.inspect .mdg-labels{right:var(--insp)} .mdg.app.inspect:not(.full) .mdg-stage,.mdg.app.inspect:not(.full) .mdg-labels{right:calc(var(--insp) + 56px)}
.mdg.app.inspect .viewbtns{right:calc(var(--insp) + 12px)} .mdg.app.inspect:not(.full) .viewbtns{right:calc(var(--insp) + 68px)}
.mdg.app .pop>.card{flex:none;position:relative;background:transparent;border:0;border-radius:0;padding:14px 16px;font-size:12.5px}
.mdg.app .pop>.card[hidden]{display:none} .mdg.app .pop .popclose,.mdg.app .pop .card.open>button{position:absolute;right:12px;top:9px;font-size:12px;padding:3px 9px} .mdg.app .pop .eyebrow{padding-right:64px}
.mdg.app .card.what .morerow{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}
@container mdg (max-width:820px){ .mdg.app{--insp:min(360px,62%)} }
.mdg.app .under{grid-template-columns:minmax(0,1fr)} .mdg.app .card.what{border-radius:10px;padding:18px 22px}
.mdg.app .card.what .cols{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);gap:8px 36px;align-items:start} .mdg.app .card.what .main,.mdg.app .card.what .aside{display:flex;flex-direction:column;gap:9px;min-width:0}
.mdg.app .card.what .aside{padding-left:24px;border-left:1px solid var(--rule)} .mdg.app .card.what .more{font-size:12.5px;padding:5px 11px}
.mdg.app.full .card.what .cols{grid-template-columns:minmax(0,1fr)} .mdg.app.full .card.what .aside{padding-left:0;border-left:0}
@container mdg (max-width:820px){ .mdg.app .card.what .cols{grid-template-columns:minmax(0,1fr)} .mdg.app .card.what .aside{padding-left:0;border-left:0} }
.mdg.app tr.pickable{cursor:pointer} .mdg.app tr.pickable:hover td{background:color-mix(in srgb,var(--fg) 7%,transparent)}
.mdg.app .card{border-radius:12px;box-shadow:0 1px 2px rgb(0 0 0 / .04)}
.mdg.app .hint{font-size:12.5px}
.mdg *{box-sizing:content-box}
.mdg [hidden]{display:none!important}
.mdg h2{margin:0;font-size:17px;font-weight:600;color:var(--fg)} .mdg h3{margin:0;font-size:13px;font-weight:600;letter-spacing:.02em;color:var(--fg)}
.mdg p{margin:0} .mdg code,.mdg .mono{font-family:var(--mono);font-size:.92em}
.mdg button{font:inherit;font-size:13.5px;color:var(--fg);background:var(--panel);border:1px solid var(--rule);border-radius:5px;padding:6px 10px;cursor:pointer;margin:0}
.mdg button:hover{border-color:var(--muted)}
.mdg button:disabled{opacity:.45;cursor:default}
.mdg button:focus-visible{outline:2px solid var(--ex);outline-offset:2px}
.mdg button[aria-pressed="true"]{border-color:var(--fg);box-shadow:inset 0 0 0 1px var(--fg)}
.mdg .strip{display:flex;flex-wrap:wrap;gap:8px 10px;align-items:stretch}
.mdg .grp{display:flex;flex-direction:column;gap:5px;border:1px solid var(--rule);border-radius:6px;padding:7px 9px;background:var(--panel);min-width:0}
.mdg .grp.stack{border-style:dashed;justify-content:center;max-width:230px;color:var(--muted);font-size:12.5px;line-height:1.4}
.mdg .grp .gl{font-family:var(--mono);font-size:11px;color:var(--muted);letter-spacing:.03em}
.mdg .chips{display:flex;flex-wrap:wrap;gap:5px}
.mdg .chips button{font-size:12.5px;padding:4px 8px}
.mdg .chips button[aria-current="step"]{background:var(--neuron);border-color:var(--neuron);color:var(--bg);font-weight:600}
.mdg .stageframe{position:relative;border:1px solid var(--rule);border-radius:6px;overflow:hidden;background:var(--bg);aspect-ratio:16/8.6;min-height:420px;max-height:880px;width:calc(100% - 2px);max-width:calc(100% - 2px)}
.mdg .mdg-stage,.mdg .mdg-labels{position:absolute;inset:0}
.mdg .mdg-stage canvas{display:block;width:100%;height:100%;touch-action:none;cursor:grab}
.mdg .mdg-labels{pointer-events:none;overflow:hidden}
.mdg .lab{position:absolute;left:0;top:0;display:flex;flex-direction:column;align-items:center;gap:2px;text-align:center;font-family:var(--mono);font-size:12px;line-height:1.3;color:var(--muted);will-change:transform;white-space:nowrap}
.mdg .tag{font-family:var(--sans);font-size:10.5px;font-weight:600;letter-spacing:.09em;padding:2px 7px;border-radius:3px;white-space:nowrap}
.mdg .tag.act{background:var(--fg);color:var(--bg)} .mdg .tag.wt{border:1.5px dashed var(--fg);color:var(--fg);background:var(--bg)}
.mdg .tag.nr{border:1.5px solid var(--neuron);color:var(--neuron);background:var(--bg)}
.mdg .lab .nm{color:var(--fg);font-family:var(--sans);font-weight:600;font-size:13px}
.mdg .lab.word{color:var(--tgreen)} .mdg .lab.word.on{font-weight:600;color:var(--fg)} .mdg .lab.word.ans{color:var(--neuron)} .mdg .lab.word.pic{color:var(--bar)}
.mdg .lab.pill{font-size:11px;padding:1px 6px;border:1.5px solid var(--neuron);border-radius:3px;background:var(--bg);color:var(--fg);font-variant-numeric:tabular-nums}
.mdg .lab.pill.w{border-style:dashed}
.mdg .lab.eqn{font-size:10.5px;line-height:1.45;gap:1px;align-items:flex-start;text-align:left;z-index:2;padding:9px 12px;border:1px solid var(--rule);border-radius:8px;background:color-mix(in srgb,var(--bg) 92%,transparent);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.mdg .lab.eqn>:first-child{font-weight:600}
@container mdg (max-width:1100px){ .mdg .lab.eqn{font-size:9px;line-height:1.35;padding:6px 9px} }
.mdg .lab.ttl{pointer-events:auto;cursor:pointer;font-family:var(--sans);font-size:12.5px;font-weight:600;color:var(--fg);background:var(--bg);border:1px solid var(--rule);border-radius:4px;padding:2px 7px;white-space:normal;max-width:118px;line-height:1.2}
.mdg .dense .lab.ttl{white-space:nowrap;max-width:none;font-size:11.5px;padding:1px 6px}
.mdg .leaders{position:absolute;inset:0;width:100%;height:100%;overflow:visible} .mdg .leaders path{fill:none;stroke:var(--muted);stroke-width:1;opacity:.7}
.mdg .lab.ttl:hover,.mdg .lab.ttl.cur{border-color:var(--neuron);color:var(--neuron)}
.mdg .lab.grpl{font-family:var(--sans);font-weight:600;font-size:15px;letter-spacing:.06em;color:var(--muted)}
.mdg .lab .sm{font-weight:400;font-size:12px;letter-spacing:0}
.mdg .lab.pu{color:var(--neuron)} .mdg .lab.or{color:var(--bar)} .mdg .lab.ex{color:var(--ex);font-weight:500}
.mdg .lab.ruler{color:var(--bar);font-size:11px}
.mdg .viewbtns{position:absolute;right:10px;top:10px;display:flex;gap:6px} .mdg .viewbtns button{font-size:12px;padding:4px 9px}
.mdg .stepbtns{position:absolute;left:10px;bottom:10px;display:flex;gap:6px} .mdg .stepbtns button{font-size:12.5px;padding:5px 10px}
.mdg .legend{position:absolute;right:12px;bottom:10px;text-align:right;margin:0;font-family:var(--mono);font-size:11px;line-height:1.55;color:var(--c4);pointer-events:none}
.mdg .legend.out{position:static;text-align:left;display:flex;flex-wrap:wrap;gap:2px 22px;pointer-events:auto;white-space:normal} .mdg .legend .li{white-space:nowrap}
@container mdg (max-width:1100px){ .mdg .legend.out{display:flex} .mdg .legend.out .li{white-space:normal} }
.mdg .fallback{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:20px;text-align:center;color:var(--muted)}
.mdg .hint{font-size:13px;color:var(--muted)}
.mdg .under{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:18px;align-items:start}
.mdg .card{background:var(--panel);border:1px solid var(--rule);border-radius:6px;padding:16px 18px;display:flex;flex-direction:column;gap:9px;min-width:0}
.mdg .card.w{border-style:dashed}
.mdg .card.open{position:relative} .mdg .card.open>button{position:absolute;right:12px;top:10px;font-size:12px;padding:3px 9px} .mdg .openbody{display:flex;flex-direction:column;gap:9px;min-width:0}
.mdg input[type=range]{accent-color:var(--neuron);width:140px}
.mdg .card .hd{display:flex;gap:8px;align-items:center}
.mdg .formula{font-family:var(--mono);font-size:13px;color:var(--neuron);overflow-wrap:anywhere}
.mdg .sizes{font-family:var(--mono);font-size:12.5px;color:var(--c4);display:flex;flex-direction:column;gap:2px}
.mdg .bar2{display:flex;flex-wrap:wrap;gap:10px 26px;align-items:center}
.mdg .bar2 .g{display:flex;flex-wrap:wrap;gap:6px;align-items:center} .mdg .bar2 .l{font-size:13px;color:var(--muted)}
.mdg .nxt{color:var(--ex)}
.mdg .tscroll{overflow:auto;max-height:420px}
.mdg .pc{border-collapse:collapse;font-size:13px}
.mdg .pc td,.mdg .pc th{padding:4px 14px 4px 0;text-align:left;border:0;border-bottom:1px solid var(--rule);font-variant-numeric:tabular-nums}
.mdg .pc th{font-weight:600;font-size:12px;color:var(--muted)}
.mdg .pc td:nth-child(n+2){font-family:var(--mono);font-size:12px}
.mdg .pc tr.on td{font-weight:600}
.mdg .mx{border-collapse:collapse;font-family:var(--mono);font-size:11.5px;font-variant-numeric:tabular-nums}
.mdg .mx td,.mdg .mx th{padding:2px 6px;text-align:right;white-space:nowrap;border:0}
.mdg .mx th{font-weight:500}
.mdg .mx tr.on td{background:color-mix(in srgb,var(--neuron) 16%,transparent)}
.mdg .note{font-size:13.5px;color:var(--muted)}
.mdg .pic{position:absolute;left:12px;bottom:12px;z-index:4;width:168px;padding:6px 6px 5px;border:1px solid var(--rule);border-radius:9px;background:var(--panel);box-shadow:0 1px 3px rgb(0 0 0 / .12);cursor:zoom-in;display:flex;flex-direction:column;gap:4px;font-size:10.5px;line-height:1.3;color:var(--muted);transition:width .15s} .mdg .pic[hidden]{display:none}
.mdg .pic img{width:100%;height:auto;display:block;border-radius:5px;background:#fff} .mdg .pic.big{width:min(460px,46%);cursor:zoom-out;z-index:7} .mdg.app:not(.full) .pic{left:68px}
.mdg .side{display:contents} .mdg .sideclose{display:none}
.mdg.full{box-sizing:border-box;width:100%;height:100%;padding:12px 16px;overflow:hidden;display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-rows:auto auto auto minmax(0,1fr);gap:0 14px}
.mdg.full.overlay{position:fixed;inset:0;z-index:2147483000;width:auto;height:auto;padding-top:40px}
.mdg.full .bar2{grid-area:1 / 1 / 2 / -1;margin:0 0 10px} .mdg.full .nav{grid-area:2 / 1 / 3 / -1;margin:0 0 10px} .mdg.full .strip{grid-area:3 / 1 / 4 / -1;margin:0 0 10px}
.mdg.full .strip{flex-wrap:nowrap;overflow-x:auto;padding-bottom:2px} .mdg.full .grp{flex:none} .mdg.full .chips{flex-wrap:nowrap} .mdg.full .chips button{white-space:nowrap} .mdg.full .grp.stack{display:none}
.mdg.full .stageframe{grid-area:4 / 1 / 5 / 2;margin:0;aspect-ratio:auto;max-height:none;min-height:0;height:calc(100% - 2px)}
.mdg.full .side{display:none;grid-area:4 / 2 / 5 / 3;width:min(440px,38vw);min-height:0;overflow:auto;flex-direction:column;gap:14px;padding-right:2px}
.mdg.full.notes .side{display:flex}
.mdg.full .side .under{grid-template-columns:minmax(0,1fr)} .mdg.full .side>*{flex:none}
.mdg.full .sideclose{display:block;align-self:flex-end;font-size:12px;padding:3px 9px}
@container mdg (max-width:1100px){ .mdg .legend{display:none} }
@container mdg (max-width:980px){ .mdg .under{grid-template-columns:minmax(0,1fr)} }
@container mdg (max-width:700px){ .mdg .lab.sec{display:none} .mdg .lab{font-size:10.5px} }
.mdg-host{container:mdg / inline-size}
`
