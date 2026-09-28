import random, math
import os
OUT=os.path.dirname(os.path.abspath(__file__))+'/'

ICONS={
'dashboard':'<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
'trades':'<path d="M4 7h16M4 12h16M4 17h10"/>',
'calendar':'<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/>',
'analytics':'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
'behavior':'<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9.5h.01M15 9.5h.01"/>',
'journal':'<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M9 8h6M9 12h6"/>',
'goals':'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
'settings':'<path d="M4 8h10M18 8h2M4 16h2M10 16h10"/><circle cx="16" cy="8" r="2"/><circle cx="8" cy="16" r="2"/>',
'plus':'<path d="M12 5v14M5 12h14"/>',
'bulb':'<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
'chev':'<path d="M6 9l6 6 6-6"/>',
'bell':'<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 21h4"/>',
'wallet':'<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h18M16 15h2"/>',
}
def icon(n,s=20,c='currentColor'):
    return f'<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="{c}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">{ICONS[n]}</svg>'

def logo(size=36, uid='l', c1='#4A5FD9', c2='#8B7FE8', glow=True):
    bars=[]; W=8
    for i in range(-6,7):
        x=i*W; H=100*(1-abs(i)/7.4)
        top=-H/2; bot=H/2
        cut=math.sqrt(max(0,17*17-x*x)) if abs(x)<17 else 0
        if cut>0:
            segs=[(top,-cut),(cut,bot)]
        else: segs=[(top,bot)]
        for a,b in segs:
            if b-a>3: bars.append(f'<rect x="{x-3:.1f}" y="{a:.1f}" width="6" height="{b-a:.1f}" rx="3"/>')
    f=f'<filter id="{uid}g"><feGaussianBlur stdDeviation="2.2"/></filter>' if glow else ''
    return (f'<svg width="{size}" height="{size}" viewBox="-52 -52 104 104"><defs>'
      f'<linearGradient id="{uid}" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="{c1}"/><stop offset="1" stop-color="{c2}"/></linearGradient>{f}</defs>'
      +(f'<g fill="url(#{uid})" filter="url(#{uid}g)" opacity=".55">{"".join(bars)}</g>' if glow else '')
      +f'<g fill="url(#{uid})">{"".join(bars)}</g></svg>')

def equity(w,h,stroke1,stroke2,fill_op=.28,seed=7,uid='e',grid='rgba(255,255,255,.05)',sw=2.4,dots=True,labels='#6B7290',n=90):
    r=random.Random(seed); v=[0]
    for i in range(n-1):
        v.append(v[-1]+r.gauss(0.16,0.9))
    # add drawdown dip and recovery shape
    v=[x+ (i/n)*9 for i,x in enumerate(v)]
    mn,mx=min(v),max(v)
    pad=26
    pts=[(pad+ i*(w-2*pad-30)/(n-1), pad+(1-(x-mn)/(mx-mn))*(h-2*pad-18)) for i,x in enumerate(v)]
    d='M'+' L'.join(f'{x:.1f},{y:.1f}' for x,y in pts)
    area=d+f' L{pts[-1][0]:.1f},{h-22} L{pts[0][0]:.1f},{h-22} Z'
    g=''.join(f'<line x1="{pad}" x2="{w-10}" y1="{pad+k*(h-2*pad-18)/4:.1f}" y2="{pad+k*(h-2*pad-18)/4:.1f}" stroke="{grid}"/>' for k in range(5))
    months=['Apr','May','Jun','Jul','Aug','Sep']
    xl=''.join(f'<text x="{pad+i*(w-2*pad-30)/5:.0f}" y="{h-4}" fill="{labels}" font-size="12">{m}</text>' for i,m in enumerate(months))
    lx,ly=pts[-1]
    dot=f'<circle cx="{lx:.1f}" cy="{ly:.1f}" r="5" fill="{stroke2}" stroke="#fff" stroke-opacity=".6" stroke-width="2"/>' if dots else ''
    return (f'<svg width="100%" height="{h}" viewBox="0 0 {w} {h}" preserveAspectRatio="none"><defs>'
      f'<linearGradient id="{uid}s" x1="0" x2="1"><stop offset="0" stop-color="{stroke1}"/><stop offset="1" stop-color="{stroke2}"/></linearGradient>'
      f'<linearGradient id="{uid}f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{stroke2}" stop-opacity="{fill_op}"/><stop offset="1" stop-color="{stroke2}" stop-opacity="0"/></linearGradient></defs>'
      f'{g}<path d="{area}" fill="url(#{uid}f)"/><path d="{d}" fill="none" stroke="url(#{uid}s)" stroke-width="{sw}" stroke-linejoin="round" stroke-linecap="round"/>{dot}{xl}</svg>')

def spark(w,h,color,seed,up=True,n=24,fill=True,uid='s'):
    r=random.Random(seed); v=[0]
    for i in range(n-1): v.append(v[-1]+r.gauss(0.25 if up else -0.05,0.8))
    mn,mx=min(v),max(v)
    pts=[(i*w/(n-1), 3+(1-(x-mn)/(mx-mn))*(h-6)) for i,x in enumerate(v)]
    d='M'+' L'.join(f'{x:.1f},{y:.1f}' for x,y in pts)
    a=f'<path d="{d} L{w},{h} L0,{h} Z" fill="url(#{uid})"/>' if fill else ''
    return (f'<svg width="100%" height="{h}" viewBox="0 0 {w} {h}" preserveAspectRatio="none"><defs><linearGradient id="{uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{color}" stop-opacity=".25"/><stop offset="1" stop-color="{color}" stop-opacity="0"/></linearGradient></defs>{a}<path d="{d}" fill="none" stroke="{color}" stroke-width="1.6" stroke-linejoin="round"/></svg>')

def ring(pct,size,stroke,c1,c2,track,uid,label_col,sub_col,big=48,txt='%d',sub='/ 100'):
    R=(size-stroke)/2; C=2*math.pi*R
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 {size} {size}"><defs><linearGradient id="{uid}" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="{c1}"/><stop offset="1" stop-color="{c2}"/></linearGradient></defs>'
      f'<circle cx="{size/2}" cy="{size/2}" r="{R}" fill="none" stroke="{track}" stroke-width="{stroke}"/>'
      f'<circle cx="{size/2}" cy="{size/2}" r="{R}" fill="none" stroke="url(#{uid})" stroke-width="{stroke}" stroke-linecap="round" stroke-dasharray="{C*pct/100:.1f} {C:.1f}" transform="rotate(-90 {size/2} {size/2})"/>'
      f'<text x="50%" y="{size/2+big*0.12}" text-anchor="middle" font-size="{big}" font-weight="600" fill="{label_col}" style="font-variant-numeric:tabular-nums">{txt%pct}</text>'
      f'<text x="50%" y="{size/2+big*0.12+22}" text-anchor="middle" font-size="13" fill="{sub_col}">{sub}</text></svg>')

def hourly(w,h,gain,loss,label,grid,seed=3):
    hrs=['08','09','10','11','12','13','14','15','16','17']
    vals=[420,980,1340,760,-210,240,-640,-380,520,-120]
    mx=1500; base=h*0.55; bw=(w-40)/len(vals)
    out=f'<line x1="14" x2="{w-8}" y1="{base}" y2="{base}" stroke="{grid}"/>'
    for i,(hh,v) in enumerate(zip(hrs,vals)):
        x=20+i*bw+bw*0.2; ww=bw*0.6; ht=abs(v)/mx*(h*0.5)
        y=base-ht if v>0 else base
        col=gain if v>0 else loss
        out+=f'<rect x="{x:.1f}" y="{y:.1f}" width="{ww:.1f}" height="{ht:.1f}" rx="5" fill="{col}"/>'
        out+=f'<text x="{x+ww/2:.1f}" y="{h-2}" text-anchor="middle" fill="{label}" font-size="12">{hh}</text>'
    return f'<svg width="100%" height="{h}" viewBox="0 0 {w} {h}">{out}</svg>'

def donut(size,stroke,segs,track,center_big,center_sub,txt,sub):
    R=(size-stroke)/2; C=2*math.pi*R; off=0; out=''
    tot=sum(s[1] for s in segs)
    for col,val in segs:
        L=C*val/tot; out+=f'<circle cx="{size/2}" cy="{size/2}" r="{R}" fill="none" stroke="{col}" stroke-width="{stroke}" stroke-dasharray="{max(L-4,1):.1f} {C:.1f}" stroke-dashoffset="{-off:.1f}" transform="rotate(-90 {size/2} {size/2})" stroke-linecap="butt"/>'; off+=L
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 {size} {size}">{out}'
      f'<text x="50%" y="{size/2+4}" text-anchor="middle" font-size="26" font-weight="600" fill="{txt}" style="font-variant-numeric:tabular-nums">{center_big}</text>'
      f'<text x="50%" y="{size/2+24}" text-anchor="middle" font-size="12" fill="{sub}">{center_sub}</text></svg>')

def calendar(cls='cal'):
    r=random.Random(11)
    days=['M','T','W','T','F','S','S']
    cells=''.join(f'<div class="dow">{d}</div>' for d in days)
    start=1  # Sep 2026 starts Tuesday -> offset 1
    cells+='<div class="cell empty"></div>'*start
    for d in range(1,31):
        wk=(d-1+start)%7
        if wk>=5: cells+=f'<div class="cell off"><span>{d}</span></div>'; continue
        v=r.choice([0,0,1,1,1,-1,-1,2,-2,3,-3]) if d<=26 else 0
        if v==0: cells+=f'<div class="cell"><span>{d}</span></div>'
        else:
            k='g' if v>0 else 'l'; a=abs(v)
            amt=abs(v)*r.randint(180,420)
            cells+=f'<div class="cell {k}{a}"><span>{d}</span><b>{"+" if v>0 else "−"}{amt}</b></div>'
    return f'<div class="{cls}">{cells}</div>'

FONT_FACE="""@font-face{font-family:'Inter';src:url('fonts/inter.woff2') format('woff2');font-weight:100 900}
@font-face{font-family:'Fraunces';src:url('fonts/fraunces.woff2') format('woff2');font-weight:100 900}
*{box-sizing:border-box;margin:0;padding:0}html,body{width:1920px;height:1080px;overflow:hidden}
body{font-family:'Inter',system-ui,sans-serif;font-feature-settings:'tnum','cv11';-webkit-font-smoothing:antialiased}
.num{font-variant-numeric:tabular-nums}"""

NAV=[('dashboard','Dashboard'),('trades','Trades'),('calendar','Calendar'),('analytics','Analytics'),('behavior','Behavior'),('journal','Journal'),('goals','Goals'),('settings','Settings')]

def dash(T,name):
    th=T
    root=':root{'+';'.join(f'--{k}:{v}' for k,v in th['vars'].items())+'}'
    nav=''.join(f'<div class="nav{" on" if i==0 else ""}">{icon(k,20)}<span>{l}</span></div>' for i,(k,l) in enumerate(NAV))
    kp=[('Win rate','58%','+3.2%',True,'gain'),('Profit factor','1.74','+0.12',True,'gain'),('Avg trade','+$69.30','+$4.10',True,'gain'),('Risk / Reward','1.9','−0.1',False,'loss'),('Max drawdown','−6.2%','+1.4%',True,'gain')]
    kpis=''
    for i,(l,v,dl,up,s) in enumerate(kp):
        col=f'var(--{s})'
        kpis+=(f'<div class="card kpi"><div class="kl">{l}<span class="info">i</span></div><div class="kv num">{v}</div>'
               f'<div class="kd num" style="color:{col}">{"▲" if up else "▼"} {dl} <em>vs last month</em></div><div class="sp">{spark(240,34,th["gainc"] if s=="gain" else th["lossc"],20+i,up,uid=f"{name}k{i}")}</div></div>')
    ins=[('bulb','Best setup: Breakout NY','58% win rate and +$4,120 over 41 trades.'),
         ('bulb','Discipline dips after 2 losses','Position size rose 23% on the 10 last trades following a loss.'),
         ('bulb','Friday is your weakest day','−$1,340 net, 3 of the 5 rule breaches happened after 3 pm.')]
    insh=''.join(f'<div class="ins"><div class="ii">{icon(i,18)}</div><div><b>{t}</b><p>{d}</p></div></div>' for i,t,d in ins)
    hero_eq=equity(1000,236,th['eq1'],th['eq2'],th['eqfill'],uid=name+'e',grid=th['grid'],labels=th['lab'])
    seg=[(th['cat1'],38),(th['cat2'],27),(th['cat3'],21),(th['cat4'],14)]
    leg=''.join(f'<div class="lg"><i style="background:{c}"></i>{n}<b class="num">{p}%</b></div>' for (c,_),n,p in zip(seg,['Breakout NY','Mean reversion','Trend pullback','Other'],[38,27,21,14]))
    html=f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Pulse — {name}</title><style>{FONT_FACE}
{root}
{th['css']}
</style></head><body><div class="app">
<aside class="side"><div class="brand">{logo(38,name+'lg',th['logo1'],th['logo2'],th['logoglow'])}<div><div class="bn">Pulse</div></div></div>
<nav>{nav}</nav>
<div class="sidefoot"><div class="avatar">T</div><div><b>Trader</b><span>Local · 3 accounts</span></div></div></aside>
<main><header class="top"><div class="chip">{icon('wallet',20)}<div><small>Account</small><b>Main account</b></div>{icon('chev',16)}</div>
<div class="chip"><div><small>Period</small><b>Apr 1 – Sep 28, 2026</b></div>{icon('chev',16)}</div>
<div class="periods"><span>1D</span><span>1W</span><span>1M</span><span class="on">3M</span><span>1Y</span><span>ALL</span></div>
<div class="grow"></div><div class="bellb">{icon('bell',20)}<i></i></div><button class="btn">{icon('plus',18)} New trade</button></header>
<div class="grid">
<section class="card hero"><div class="hh"><div><div class="lbl">NET P&amp;L</div><div class="big num">+$12,480.00</div><div class="hd num" style="color:var(--gain)">▲ +8.4% <em>vs previous 3 months</em></div></div><div class="badges"><span class="badge g"><i></i>Gain</span><span class="badge n">180 trades</span></div></div>{hero_eq}</section>
<section class="card insights"><h3>Performance insights</h3>{insh}</section>
<div class="kpirow">{kpis}</div>
<section class="card c3 disc"><h3>Discipline score</h3><div class="center">{ring(82,230,18,th['logo1'],th['logo2'],th['track'],name+'r',th['tx'],th['tx2'],52)}</div><div class="dl"><div><span>Plan followed</span><b class="num">86%</b></div><div><span>Rules respected</span><b class="num">91%</b></div><div><span>Checklist</span><b class="num">74%</b></div></div></section>
<section class="card c3"><h3>Hourly performance</h3><div class="hb">{hourly(360,330,th['gainc'],th['lossc'],th['lab'],th['grid'])}</div></section>
<section class="card c3"><h3>Trading activity · September</h3>{calendar()}</section>
<section class="card c3"><h3>Strategy performance</h3><div class="dn">{donut(200,26,seg,th['track'],'4','strategies',th['tx'],th['tx2'])}<div class="legend">{leg}</div></div></section>
</div></main></div></body></html>"""
    open(OUT+f'style-{name}.html','w',encoding='utf-8').write(html)

BASE_CSS="""
.app{display:flex;width:1920px;height:1080px;background:var(--bg);color:var(--tx)}
.side{width:248px;background:var(--side);border-right:1px solid var(--bd);display:flex;flex-direction:column;padding:26px 16px}
.brand{display:flex;gap:12px;align-items:center;padding:0 10px 30px}
.bn{font-size:26px;font-weight:300;letter-spacing:-.01em;line-height:1}.bt{font-size:8.5px;letter-spacing:.14em;color:var(--tx3);margin-top:6px;font-weight:500}
nav{display:flex;flex-direction:column;gap:4px;flex:1}
.nav{display:flex;gap:14px;align-items:center;padding:12px 16px;border-radius:var(--rmd);color:var(--tx2);font-size:15px;font-weight:500}
.nav.on{background:var(--navon);color:var(--navonc)}
.sidefoot{display:flex;gap:12px;align-items:center;padding:16px 10px 0;border-top:1px solid var(--bd)}
.avatar{width:38px;height:38px;border-radius:50%;background:var(--grad);display:grid;place-items:center;font-weight:600;color:#fff}
.sidefoot b{display:block;font-size:14px}.sidefoot span{font-size:12px;color:var(--tx3)}
main{flex:1;display:flex;flex-direction:column;min-width:0}
.top{height:72px;display:flex;align-items:center;gap:14px;padding:0 28px;border-bottom:1px solid var(--bd);background:var(--side)}
.chip{display:flex;align-items:center;gap:12px;background:var(--s3);padding:8px 16px;border-radius:var(--rchip);color:var(--tx2)}
.chip small{display:block;font-size:11px;color:var(--tx3)}.chip b{font-size:14px;color:var(--tx);font-weight:600}
.periods{display:flex;gap:2px;background:var(--s3);padding:4px;border-radius:var(--rchip);margin-left:6px}
.periods span{padding:7px 14px;border-radius:var(--rchip);font-size:13px;font-weight:600;color:var(--tx2)}
.periods .on{background:var(--grad);color:#fff}
.grow{flex:1}.bellb{position:relative;color:var(--tx2);width:44px;height:44px;border-radius:50%;background:var(--s3);display:grid;place-items:center}
.bellb i{position:absolute;top:10px;right:11px;width:8px;height:8px;border-radius:50%;background:var(--accent2);border:2px solid var(--s3)}
.btn{display:flex;gap:8px;align-items:center;border:0;background:var(--grad);color:#fff;font:600 15px Inter;padding:12px 22px;border-radius:var(--rbtn);box-shadow:var(--btnsh)}
.grid{flex:1;display:grid;grid-template-columns:repeat(12,1fr);grid-template-rows:330px 128px 1fr;gap:24px;padding:24px 28px}
.card{background:var(--s2);border:1px solid var(--bd);border-radius:var(--rlg);box-shadow:var(--sh);padding:22px 24px;min-width:0;min-height:0;overflow:hidden}
.card h3{font-size:16px;font-weight:600;margin-bottom:14px}
.hero{grid-column:span 8;display:flex;flex-direction:column}
.hh{display:flex;justify-content:space-between}
.lbl{font-size:12px;letter-spacing:.06em;color:var(--tx3);font-weight:600}
.big{font-size:46px;font-weight:var(--bigw);letter-spacing:-.02em;margin-top:4px;line-height:1.1}
.hd{font-size:14px;font-weight:600;margin-top:4px}.hd em,.kd em{font-style:normal;color:var(--tx3);font-weight:400}
.badges{display:flex;gap:8px;align-items:flex-start}
.badge{display:inline-flex;gap:7px;align-items:center;padding:6px 12px;border-radius:999px;font-size:12.5px;font-weight:600}
.badge i{width:6px;height:6px;border-radius:50%;background:currentColor}
.badge.g{background:var(--gains);color:var(--gain)}.badge.n{background:var(--neus);color:var(--neu)}
.hero svg{margin-top:auto}
.insights{grid-column:span 4}
.ins{display:flex;gap:14px;padding:14px 0;border-top:1px solid var(--bd)}
.ins:first-of-type{border-top:0;padding-top:0}
.ii{width:36px;height:36px;border-radius:10px;background:var(--navon);color:var(--navonc);display:grid;place-items:center;flex:none}
.ins b{font-size:14.5px;font-weight:600}.ins p{font-size:13px;color:var(--tx2);margin-top:3px;line-height:1.45}
.kpirow{grid-column:span 12;display:grid;grid-template-columns:repeat(5,1fr);gap:24px}
.kpi{position:relative;padding:18px 22px}
.kl{font-size:13px;color:var(--tx2);font-weight:500;display:flex;gap:6px;align-items:center}
.info{width:14px;height:14px;border-radius:50%;border:1px solid var(--tx3);font-size:9px;display:grid;place-items:center;color:var(--tx3)}
.kv{font-size:28px;font-weight:var(--kvw);margin-top:6px;letter-spacing:-.01em}
.kd{font-size:12px;font-weight:600;margin-top:2px}
.sp{position:absolute;left:0;right:0;bottom:0;opacity:.9}
.c3{grid-column:span 3}
.center{display:flex;justify-content:center;margin-top:18px}
.dl{display:flex;justify-content:space-between;margin-top:26px}.dl span{display:block;font-size:12px;color:var(--tx3)}.dl b{font-size:18px;font-weight:600}
.cal{display:grid;grid-template-columns:repeat(7,1fr);gap:5px}
.dow{font-size:11px;color:var(--tx3);text-align:center;font-weight:600;padding-bottom:2px}
.cell{height:62px;border-radius:8px;background:var(--s3);padding:4px 6px;font-size:11px;color:var(--tx3);position:relative}
.cell.empty{background:none}.cell.off{opacity:.45}
.cell b{position:absolute;right:6px;bottom:3px;font-size:10px;font-weight:600;color:var(--tx)}
.cell.g1{background:var(--g1)}.cell.g2{background:var(--g2)}.cell.g3{background:var(--g3)}
.cell.l1{background:var(--l1)}.cell.l2{background:var(--l2)}.cell.l3{background:var(--l3)}
.dn{display:flex;flex-direction:column;gap:26px;align-items:center;margin-top:16px}.legend{width:100%}.legend{flex:1;display:flex;flex-direction:column;gap:12px}
.lg{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--tx2)}.lg i{width:10px;height:10px;border-radius:3px}.lg b{margin-left:auto;color:var(--tx);font-weight:600}
"""

A=dict(name='a',vars={'bg':'#0B0E27','side':'#0D1120','s2':'#171B33','s3':'#1F2440','bd':'rgba(255,255,255,.08)','tx':'#F5F2EC','tx2':'#9AA0C0','tx3':'#6B7290',
 'accent2':'#8B7FE8','grad':'linear-gradient(135deg,#4A5FD9,#8B7FE8)','gain':'#5FCB9E','loss':'#F0776B','neu':'#B9BECF','gains':'#16302A','neus':'#20233A',
 'navon':'rgba(139,127,232,.14)','navonc':'#A79DF2','rmd':'14px','rlg':'20px','rchip':'999px','rbtn':'999px','bigw':'700','kvw':'600',
 'sh':'0 1px 2px rgba(0,0,0,.35),0 8px 24px -12px rgba(0,0,0,.5)','btnsh':'0 6px 16px -6px rgba(91,114,200,.6),inset 0 1px 0 rgba(255,255,255,.28)',
 'g1':'rgba(95,203,158,.18)','g2':'rgba(95,203,158,.38)','g3':'rgba(95,203,158,.62)','l1':'rgba(240,119,107,.18)','l2':'rgba(240,119,107,.38)','l3':'rgba(240,119,107,.62)'},
 css=BASE_CSS,gainc='#5FCB9E',lossc='#F0776B',eq1='#4A5FD9',eq2='#8B7FE8',eqfill=.32,grid='rgba(255,255,255,.05)',lab='#6B7290',
 logo1='#4A5FD9',logo2='#8B7FE8',logoglow=True,track='rgba(255,255,255,.08)',tx='#F5F2EC',tx2='#9AA0C0',cat1='#4A5FD9',cat2='#8B7FE8',cat3='#5FCB9E',cat4='#D9A85A')
dash(A,'a')

B=dict(name='b',vars={'bg':'#F7F4EE','side':'#FFFFFF','s2':'#FFFFFF','s3':'#F0EDE4','bd':'rgba(18,22,42,.08)','tx':'#12162A','tx2':'#565C74','tx3':'#8A8FA3',
 'accent2':'#3B49B8','grad':'#3B49B8','gain':'#2F8F68','loss':'#C64435','neu':'#5B6270','gains':'#E3F3EC','neus':'#EEEFF3',
 'navon':'rgba(59,73,184,.08)','navonc':'#3B49B8','rmd':'10px','rlg':'14px','rchip':'10px','rbtn':'10px','bigw':'300','kvw':'400',
 'sh':'0 1px 2px rgba(20,20,30,.04),0 6px 20px -12px rgba(20,20,30,.10)','btnsh':'none',
 'g1':'rgba(47,143,104,.14)','g2':'rgba(47,143,104,.3)','g3':'rgba(47,143,104,.5)','l1':'rgba(198,68,53,.12)','l2':'rgba(198,68,53,.28)','l3':'rgba(198,68,53,.48)'},
 css=BASE_CSS+".nav.on{font-weight:600}.kd{font-weight:500}.card h3{font-size:14px;letter-spacing:.02em}.lbl{font-weight:500}.cell b{color:#12162A}.periods .on{background:#3B49B8}.brand .bn{font-weight:300}",
 gainc='#2F8F68',lossc='#C64435',eq1='#3B49B8',eq2='#3B49B8',eqfill=.10,grid='rgba(18,22,42,.06)',lab='#8A8FA3',
 logo1='#3B49B8',logo2='#3B49B8',logoglow=False,track='#ECE8DF',tx='#12162A',tx2='#565C74',cat1='#3B49B8',cat2='#8E96D8',cat3='#2F8F68',cat4='#C9B98C')
dash(B,'b')
print('ok')


def styleE():
    css=FONT_FACE+"""
:root{--bg:#16140F;--side:#1B1812;--card:#211E17;--card2:#2A261D;--bd:rgba(239,233,220,.09);--tx:#EFE9DC;--tx2:#B3AA98;--tx3:#807867;--brz:#C9A35A;--teal:#3E8C86;--gain:#8DB48E;--loss:#D57A62}
body{background:var(--bg);color:var(--tx)}
body::before{content:'';position:fixed;inset:0;background:radial-gradient(1200px 500px at 70% -10%,rgba(201,163,90,.07),transparent 60%);pointer-events:none}
.app{display:flex;width:1920px;height:1080px}
.side{width:236px;background:var(--side);border-right:1px solid var(--bd);padding:30px 18px;display:flex;flex-direction:column}
.brand{display:flex;gap:12px;align-items:center;padding:0 10px 34px}
.bn{font-family:Fraunces,serif;font-size:27px;font-weight:400;letter-spacing:-.01em}
.sec{font-size:11px;letter-spacing:.14em;color:var(--tx3);padding:0 12px 10px;font-weight:600}
.nav{display:flex;gap:13px;align-items:center;padding:11px 14px;border-radius:10px;color:var(--tx2);font-size:15px;margin-bottom:2px}
.nav.on{background:rgba(201,163,90,.12);color:var(--brz)}
.foot{margin-top:auto;padding:16px 10px 0;border-top:1px solid var(--bd);font-size:12px;color:var(--tx3);line-height:1.5}
main{flex:1;padding:36px 44px;display:flex;flex-direction:column;gap:24px;min-width:0}
.head{display:flex;align-items:flex-end;justify-content:space-between}
.eyebrow{font-size:12px;letter-spacing:.14em;color:var(--brz);font-weight:600}
h1{font-family:Fraunces,serif;font-weight:400;font-size:44px;letter-spacing:-.02em;margin-top:6px}
.btn{background:var(--brz);color:#1B1710;border:0;border-radius:999px;font:600 15px Inter;padding:13px 24px;display:flex;gap:8px;align-items:center}
.btn.ghost{background:transparent;color:var(--tx);border:1px solid var(--bd)}
.strip{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--bd);border-radius:14px;background:var(--card)}
.strip>div{padding:18px 26px;border-left:1px solid var(--bd)}.strip>div:first-child{border-left:0}
.sl{font-size:12px;letter-spacing:.08em;color:var(--tx3);font-weight:600}
.sv{font-size:30px;font-weight:500;margin-top:4px;letter-spacing:-.01em}.sd{font-size:13px;margin-top:2px;color:var(--tx3)}
.cols{display:grid;grid-template-columns:1.25fr 1fr;gap:24px;flex:1;min-height:0}
.card{background:var(--card);border:1px solid var(--bd);border-radius:14px;padding:26px 28px;min-height:0;overflow:hidden}
h2{font-family:Fraunces,serif;font-weight:400;font-size:24px;letter-spacing:-.01em}
.sub{font-size:13px;color:var(--tx3);margin:4px 0 18px}
.mood{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:22px}
.tag{padding:7px 14px;border-radius:999px;border:1px solid var(--bd);font-size:13px;color:var(--tx2)}
.tag.on{background:rgba(62,140,134,.18);border-color:rgba(62,140,134,.5);color:#8ACBC4}
.tag.t{background:rgba(201,163,90,.14);border-color:rgba(201,163,90,.4);color:var(--brz)}
.q{margin-bottom:20px}.q label{display:block;font-size:13px;color:var(--tx3);letter-spacing:.04em;margin-bottom:8px}
.q p{font-family:Fraunces,serif;font-size:19px;line-height:1.5;color:var(--tx);border-left:2px solid var(--brz);padding-left:16px}
.q p.dim{color:var(--tx2)}
.rules{display:grid;grid-template-columns:1fr 1fr;gap:10px 24px;margin-top:8px}
.rule{display:flex;gap:12px;align-items:center;font-size:14.5px;color:var(--tx2)}
.box{width:20px;height:20px;border-radius:6px;border:1.5px solid var(--tx3);display:grid;place-items:center;flex:none}
.box.ok{background:var(--teal);border-color:var(--teal);color:#0F1B1A}.box.ko{border-color:var(--loss);color:var(--loss)}
.right{display:flex;flex-direction:column;gap:20px;min-height:0}
.tr{display:grid;grid-template-columns:auto 1fr auto;gap:6px 16px;align-items:center;padding:16px 0;border-top:1px solid var(--bd)}
.tr:first-of-type{border-top:0;padding-top:4px}
.asset{font-size:17px;font-weight:600}.asset small{font-size:12px;font-weight:600;letter-spacing:.06em;margin-left:8px}
.pnl{font-size:20px;font-weight:600;text-align:right}
.meta{grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:12.5px;color:var(--tx3)}
.stars{color:var(--brz);letter-spacing:2px;margin-left:auto;font-size:14px}
.badge{display:inline-flex;gap:7px;align-items:center;padding:4px 11px;border-radius:999px;font-size:12px;font-weight:600}
.badge i{width:6px;height:6px;border-radius:50%;background:currentColor}
.badge.g{background:rgba(141,180,142,.14);color:var(--gain)}.badge.l{background:rgba(213,122,98,.14);color:var(--loss)}
.two{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.mini{display:flex;align-items:center;gap:20px}
"""
    def star(n): return '★'*n+'<span style="opacity:.25">'+'★'*(5-n)+'</span>'
    nav=''.join(f'<div class="nav{" on" if i==0 else ""}">{icon(k,19)}<span>{l}</span></div>' for i,(k,l) in enumerate([('journal','Today'),('trades','Trades'),('calendar','Calendar'),('analytics','Review'),('behavior','Behavior'),('goals','Goals'),('settings','Rules & settings')]))
    trades=[('EURUSD','LONG','+$412.00','Breakout NY','Calm','Plan followed','g',4,'09:42 · 1h 12m · 2.1R'),
            ('NAS100','SHORT','−$186.50','Trend pullback','FOMO','Plan broken','l',2,'11:05 · 24m · −0.9R'),
            ('XAUUSD','LONG','+$96.20','Mean reversion','Discipline','Plan followed','g',5,'14:20 · 47m · 0.8R')]
    tr=''
    for a,sd,p,st,em,pl,k,stn,m in trades:
        col='var(--gain)' if k=='g' else 'var(--loss)'
        tr+=(f'<div class="tr"><div class="asset">{a}<small style="color:{col}">{sd}</small></div><div></div><div class="pnl num" style="color:{col}">{p}</div>'
             f'<div class="meta"><span class="badge {k}"><i></i>{"Gain" if k=="g" else "Loss"}</span><span class="tag t">{st}</span><span class="tag">{em}</span><span>{pl}</span><span>{m}</span><span class="stars">{star(stn)}</span></div></div>')
    rules=[('ok','Max 3 trades per day'),('ok','Stop loss set before entry'),('ko','No trading after 3 pm'),('ok','Risk ≤ 1% per trade'),('ok','Pre-trade checklist completed'),('ok','No revenge trade after a loss')]
    rl=''.join(f'<div class="rule"><span class="box {k}">{"✓" if k=="ok" else "✕"}</span>{t}</div>' for k,t in rules)
    eq=equity(520,150,'#C9A35A','#C9A35A',.18,uid='ee',grid='rgba(239,233,220,.06)',labels='#807867',sw=2.2)
    html=f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Pulse — Notebook style</title><style>{css}</style></head><body><div class="app">
<aside class="side"><div class="brand">{logo(40,'el','#C9A35A','#E6CB8E',True)}<div class="bn">Pulse</div></div><div class="sec">JOURNAL</div>{nav}
<div class="foot">Local data · last backup<br>today 06:12</div></aside>
<main><div class="head"><div><div class="eyebrow">MONDAY · SEPTEMBER 28</div><h1>Today's entry</h1></div><div style="display:flex;gap:12px"><button class="btn ghost">Quick add</button><button class="btn">{icon('plus',18)} New trade</button></div></div>
<div class="strip"><div><div class="sl">DAY P&amp;L</div><div class="sv num" style="color:var(--gain)">+$321.70</div><div class="sd">3 trades · 2 wins</div></div>
<div><div class="sl">WIN RATE · 3M</div><div class="sv num">58%</div><div class="sd">Profit factor 1.74</div></div>
<div><div class="sl">DISCIPLINE</div><div class="sv num">82 <span style="font-size:15px;color:var(--tx3)">/ 100</span></div><div class="sd">▲ 4 pts this week</div></div>
<div><div class="sl">MONTH P&amp;L</div><div class="sv num" style="color:var(--gain)">+$2,864.10</div><div class="sd">Goal $4,000 · 72%</div></div></div>
<div class="cols">
<section class="card"><h2>Reflection</h2><div class="sub">How was today, regardless of the result?</div>
<div class="mood"><span class="tag on">Focused</span><span class="tag">Calm</span><span class="tag">Tired</span><span class="tag">Stressed</span><span class="tag on">Slept 7h+</span><span class="tag">Late session</span></div>
<div class="q"><label>WHAT WENT WELL?</label><p>Waited for the NY breakout confirmation on EURUSD and took profit at the plan target instead of trailing too tight.</p></div>
<div class="q"><label>WHAT TO IMPROVE?</label><p>Took the NAS100 short out of FOMO after missing the first move — no valid setup. Stay flat when the checklist isn't complete.</p></div>
<div class="q"><label>ONE RULE FOR TOMORROW</label><p class="dim">No new position after two losses in a row.</p></div>
<div class="sl" style="margin-top:6px">RULES · TODAY</div><div class="rules">{rl}</div></section>
<div class="right"><section class="card" style="flex:1"><div style="display:flex;justify-content:space-between;align-items:baseline"><h2>Today's trades</h2><span class="sub" style="margin:0">3 of 3 reviewed</span></div><div class="sub"></div>{tr}</section>
<section class="card"><div class="two"><div><h2 style="font-size:20px">Equity · 3 months</h2><div class="sub" style="margin-bottom:6px">Deposits excluded</div>{eq}</div><div><h2 style="font-size:20px">Execution quality</h2><div class="sub">Result vs process</div><div class="mini"><div style="flex:1"><div class="rule" style="margin-bottom:10px"><span class="badge g"><i></i>Won, well executed</span><b class="num" style="margin-left:auto">61%</b></div><div class="rule" style="margin-bottom:10px"><span class="badge g" style="opacity:.6"><i></i>Won, badly executed</span><b class="num" style="margin-left:auto">14%</b></div><div class="rule" style="margin-bottom:10px"><span class="badge l"><i></i>Lost, well executed</span><b class="num" style="margin-left:auto">17%</b></div><div class="rule"><span class="badge l" style="opacity:.6"><i></i>Lost, badly executed</span><b class="num" style="margin-left:auto">8%</b></div></div></div></div></div></section></div>
</div></main></div></body></html>"""
    open(OUT+'style-e.html','w',encoding='utf-8').write(html)
styleE()
