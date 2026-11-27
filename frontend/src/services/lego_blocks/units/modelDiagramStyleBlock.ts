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
.mdg.app{gap:12px;outline:none}
.mdg.app .stageframe{min-height:min(68vh,640px)}
.mdg.app button{border-radius:8px;transition:background-color .12s,border-color .12s,color .12s}
.mdg.app .strip{flex-wrap:nowrap;overflow-x:auto;gap:4px 18px;align-items:center;padding:2px 0 8px;border-bottom:1px solid var(--rule);scrollbar-width:none;scroll-behavior:smooth}
.mdg.app .strip::-webkit-scrollbar{display:none}
.mdg.app .grp{flex:none;flex-direction:row;align-items:center;gap:6px;border:0;border-radius:0;padding:0;background:transparent}
.mdg.app .grp .gl{font-family:var(--sans);font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;white-space:nowrap;opacity:.8}
.mdg.app .grp.stack{display:none}
.mdg.app .chips{flex-wrap:nowrap;gap:2px}
.mdg.app .chips button{border:0;background:transparent;color:var(--muted);font-size:12.5px;padding:4px 9px;white-space:nowrap}
.mdg.app .chips button:hover{background:hsl(var(--muted));color:var(--fg)}
.mdg.app .chips button[aria-current="step"]{background:hsl(var(--primary));color:hsl(var(--primary-foreground));font-weight:600}
.mdg.app .viewbtns button,.mdg.app .stepbtns button{background:color-mix(in srgb,var(--panel) 78%,transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);box-shadow:0 1px 2px rgb(0 0 0 / .06)}
.mdg.app .stepbtns{left:50%;transform:translateX(-50%);bottom:12px}
.mdg.app .bar2{gap:8px 20px;font-size:13px} .mdg.app .bar2 button{font-size:12.5px;padding:4px 9px}
.mdg.app .card{border-radius:12px;box-shadow:0 1px 2px rgb(0 0 0 / .04)}
.mdg.app .hint{font-size:12.5px}
.mdg.app.full .strip{border-bottom:0;padding-bottom:2px}
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
.mdg .lab.eqn{font-size:10px;line-height:1.25;gap:1px;align-items:flex-start;text-align:left}
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
.mdg .side{display:contents} .mdg .sideclose{display:none}
.mdg.full{box-sizing:border-box;width:100%;height:100%;padding:12px 16px;overflow:hidden;display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-rows:auto auto minmax(0,1fr);gap:10px 14px}
.mdg.full.overlay{position:fixed;inset:0;z-index:2147483000;width:auto;height:auto;padding-top:40px}
.mdg.full .bar2,.mdg.full .strip{grid-column:1 / -1}
.mdg.full .strip{flex-wrap:nowrap;overflow-x:auto;padding-bottom:2px} .mdg.full .grp{flex:none} .mdg.full .chips{flex-wrap:nowrap} .mdg.full .chips button{white-space:nowrap} .mdg.full .grp.stack{display:none}
.mdg.full .stageframe{grid-column:1;aspect-ratio:auto;max-height:none;min-height:0;height:calc(100% - 2px)}
.mdg.full .side{display:none;grid-column:2;width:min(440px,38vw);min-height:0;overflow:auto;flex-direction:column;gap:14px;padding-right:2px}
.mdg.full.notes .side{display:flex}
.mdg.full .side .under{grid-template-columns:minmax(0,1fr)} .mdg.full .side>*{flex:none}
.mdg.full .sideclose{display:block;align-self:flex-end;font-size:12px;padding:3px 9px}
@container mdg (max-width:1100px){ .mdg .legend{display:none} }
@container mdg (max-width:980px){ .mdg .under{grid-template-columns:minmax(0,1fr)} }
@container mdg (max-width:700px){ .mdg .lab.sec{display:none} .mdg .lab{font-size:10.5px} }
.mdg-host{container:mdg / inline-size}
`
