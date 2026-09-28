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


# ====================== STYLE C — Terminal pro ======================
def drawdown_svg(w,h,seed=5,col='#FF5C5C'):
    r=random.Random(seed); v=[0]; peak=0; dd=[0]
    eq=0
    for i in range(90):
        eq+=r.gauss(.16,.9)+0.1; peak=max(peak,eq); dd.append(eq-peak)
    mn=min(dd); n=len(dd)
    pts=[(4+i*(w-8)/(n-1), (x/mn)*(h-6)+2) for i,x in enumerate(dd)]
    d='M4,2 L'+' L'.join(f'{x:.1f},{y:.1f}' for x,y in pts)+f' L{w-4},2 Z'
    return f'<svg width="100%" height="{h}" viewBox="0 0 {w} {h}" preserveAspectRatio="none"><path d="{d}" fill="{col}" fill-opacity=".35" stroke="{col}" stroke-width="1"/></svg>'

def styleC():
    css=FONT_FACE+"""
@font-face{font-family:'JB';src:url('fonts/jetbrains-mono.woff2') format('woff2');font-weight:100 900}
:root{--bg:#08090C;--pn:#0D0F14;--ln:#1E222B;--tx:#D7DBE3;--tx2:#8B93A3;--tx3:#565D6B;--am:#FFB000;--g:#3DDC97;--r:#FF5C5C}
body{background:var(--bg);color:var(--tx);font-family:'JB',monospace;font-size:12.5px}
.top{height:40px;display:flex;align-items:center;gap:22px;padding:0 16px;border-bottom:1px solid var(--ln);background:#0A0C10}
.lg{display:flex;align-items:center;gap:10px;color:var(--am);font-weight:700;letter-spacing:.2em;font-size:14px}
.tabs{display:flex;gap:4px}.tabs span{padding:5px 12px;color:var(--tx2);font-size:11.5px;letter-spacing:.06em}.tabs span b{color:var(--am);margin-right:6px}
.tabs .on{background:var(--am);color:#0A0A0A;font-weight:700}.tabs .on b{color:#0A0A0A}
.sp{flex:1}.top .k{color:var(--tx2)}.top .k b{color:var(--tx)}
.grid{display:grid;grid-template-columns:repeat(12,1fr);gap:1px;background:var(--ln);height:1010px}
.p{background:var(--pn);display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden}
.ph{display:flex;justify-content:space-between;padding:7px 12px;border-bottom:1px solid var(--ln);color:var(--am);font-size:11px;font-weight:700;letter-spacing:.14em}
.ph i{font-style:normal;color:var(--tx3);font-weight:400;letter-spacing:.04em}
.pb{padding:10px 12px;flex:1;min-height:0}
.bigp{font-size:38px;font-weight:700;color:var(--g);letter-spacing:-.02em;line-height:1}
.dim{color:var(--tx3)}.g{color:var(--g)}.r{color:var(--r)}.a{color:var(--am)}
table{width:100%;border-collapse:collapse}
td,th{padding:4.5px 8px;text-align:right;white-space:nowrap}th{color:var(--tx3);font-weight:500;font-size:10.5px;letter-spacing:.08em;border-bottom:1px solid var(--ln)}
td:first-child,th:first-child,.l{text-align:left}
tr+tr td{border-top:1px solid #15181F}
.st td:first-child{color:var(--tx2)}.st td:last-child{color:var(--tx);font-weight:700}
.hm{display:grid;grid-template-columns:34px repeat(10,1fr);gap:2px;font-size:10.5px}
.hm div{height:28px;display:grid;place-items:center;border-radius:1px}
.hm .h{height:16px;color:var(--tx3)}.hm .d{color:var(--tx3);justify-content:start;place-items:center start}
.al{display:flex;gap:10px;padding:8px 10px;border-left:3px solid;margin-bottom:6px;background:#11141A;line-height:1.4}
.al b{display:block;letter-spacing:.06em;font-size:11px}.al span{color:var(--tx2)}
.kb{border:1px solid var(--tx3);color:var(--tx2);padding:0 5px;margin-left:6px;font-size:10px}
.status{height:30px;display:flex;align-items:center;gap:22px;padding:0 16px;border-top:1px solid var(--ln);background:#0A0C10;color:var(--tx3);font-size:11px}
.status b{color:var(--am);font-weight:600}
.pill{padding:1px 7px;font-size:10.5px;font-weight:700;letter-spacing:.06em}
.pill.g{background:rgba(61,220,151,.14)}.pill.r{background:rgba(255,92,92,.14)}
"""
    eq=equity(1000,300,'#FFB000','#FFB000',.14,uid='ce',grid='rgba(255,255,255,.05)',labels='#565D6B',sw=1.6,dots=False)
    dd=drawdown_svg(1000,54)
    stats=[('Net P&L','+$12,480.00'),('Gross P&L','+$14,127.60'),('Fees','−$1,647.60'),('Trades','180'),('Win rate','58.0%'),('Avg win','+$286.40'),('Avg loss','−$204.10'),('R:R real','1.40'),('Expectancy','+0.34 R'),('Profit factor','1.74'),('Sharpe','1.62'),('Max DD','−6.2%'),('Current DD','−1.1%')]
    st=''.join(f'<tr><td>{a}</td><td>{b}</td></tr>' for a,b in stats)
    bins=[('≤-3',2),('-2',9),('-1',31),('0',12),('1',28),('2',41),('3',33),('4',14),('≥5',10)]
    mx=41; bars=''
    for i,(lab,c) in enumerate(bins):
        col='#FF5C5C' if i<3 else ('#565D6B' if i==3 else '#3DDC97')
        h=c/mx*190
        bars+=f'<div style="display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:5px;height:230px"><span class="dim" style="font-size:10.5px">{c}</span><div style="width:100%;height:{h:.0f}px;background:{col}"></div><span class="dim" style="font-size:10.5px">{lab}</span></div>'
    r=random.Random(4); days=['MON','TUE','WED','THU','FRI']; hm='<div></div>'+''.join(f'<div class="h">{h}</div>' for h in range(8,18))
    for d in days:
        hm+=f'<div class="d">{d}</div>'
        for h in range(10):
            v=r.randint(-90,110)
            if d=='FRI' and h>=6: v=-r.randint(40,120)
            a=min(abs(v)/120,1)*.75+.06
            col=f'rgba(61,220,151,{a:.2f})' if v>0 else f'rgba(255,92,92,{a:.2f})'
            hm+=f'<div style="background:{col};color:#fff">{abs(v)}</div>'
    rows=[('0928-07','09:42','EURUSD','LONG','1.20','1.0842','1.0871','+2.1','+412.00','BRK-NY','Y','5/5','A'),
          ('0928-06','11:05','NAS100','SHORT','0.80','19,412','19,431','−0.9','−186.50','TRD-PB','N','3/5','D'),
          ('0928-05','14:20','XAUUSD','LONG','0.50','2,331.4','2,338.8','+0.8','+96.20','MEAN-REV','Y','5/5','B'),
          ('0927-09','15:48','GBPUSD','SHORT','1.00','1.2614','1.2641','−1.0','−204.00','BRK-NY','N','2/5','F'),
          ('0927-08','10:12','EURUSD','LONG','1.20','1.0810','1.0862','+1.8','+352.10','BRK-NY','Y','5/5','A'),
          ('0927-07','09:31','US30','LONG','0.60','38,114','38,207','+1.2','+218.40','TRD-PB','Y','4/5','B'),
          ('0926-06','13:55','XAUUSD','SHORT','0.50','2,344.1','2,339.9','+0.6','+64.00','MEAN-REV','Y','5/5','B'),
          ('0926-05','16:10','NAS100','LONG','0.80','19,388','19,371','−0.8','−162.20','TRD-PB','N','3/5','D'),
          ('0926-04','09:47','EURUSD','LONG','1.20','1.0798','1.0840','+1.5','+298.00','BRK-NY','Y','5/5','A')]
    body=''
    for x in rows:
        pos=x[8].startswith('+'); c='g' if pos else 'r'
        body+=(f'<tr><td class="dim">{x[0]}</td><td>{x[1]}</td><td>{x[2]}</td><td class="{"g" if x[3]=="LONG" else "r"}">{x[3]}</td><td>{x[4]}</td><td>{x[5]}</td><td>{x[6]}</td>'
               f'<td class="{c}">{x[7]}</td><td class="{c}"><b>{x[8]}</b></td><td class="a">{x[9]}</td><td><span class="pill {"g" if x[10]=="Y" else "r"}">{x[10]}</span></td><td>{x[11]}</td><td class="{"g" if x[12] in "AB" else "r"}">{x[12]}</td></tr>')
    html=f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Pulse — Terminal style</title><style>{css}</style></head><body>
<div class="top"><div class="lg">{logo(24,'cl','#FFB000','#FFB000',False)}PULSE</div><div class="tabs"><span class="on"><b>F1</b>DASH</span><span><b>F2</b>TRADES</span><span><b>F3</b>CALENDAR</span><span><b>F4</b>STATS</span><span><b>F5</b>BEHAVIOR</span><span><b>F6</b>JOURNAL</span><span><b>F7</b>RULES</span></div><div class="sp"></div>
<div class="k">ACCT <b>MAIN</b></div><div class="k">PERIOD <b>3M</b></div><div class="k"><b>2026-09-28 16:42:07</b></div></div>
<div class="grid">
<div class="p" style="grid-column:span 6;grid-row:span 5"><div class="ph">EQUITY · NET OF FEES · EXCL. DEPOSITS<i>Apr 01 → Sep 28</i></div><div class="pb"><div style="display:flex;gap:30px;align-items:flex-end;margin-bottom:6px"><div><div class="dim" style="font-size:10.5px;letter-spacing:.1em">NET P&amp;L</div><div class="bigp num">+12,480.00</div></div><div><div class="dim" style="font-size:10.5px">VS PREV 3M</div><div class="g" style="font-size:16px">▲ +8.4%</div></div><div><div class="dim" style="font-size:10.5px">DRAWDOWN NOW</div><div class="r" style="font-size:16px">−1.1%</div></div></div>{eq}<div class="dim" style="font-size:10.5px;letter-spacing:.1em;margin:4px 0 2px">DRAWDOWN</div>{dd}</div></div>
<div class="p" style="grid-column:span 3;grid-row:span 5"><div class="ph">STATISTICS<i>closed trades</i></div><div class="pb" style="padding:4px 0"><table class="st">{st}</table></div></div>
<div class="p" style="grid-column:span 3;grid-row:span 5"><div class="ph">R-MULTIPLE DISTRIBUTION<i>n=180</i></div><div class="pb"><div style="display:grid;grid-template-columns:repeat(9,1fr);gap:6px;margin-top:10px">{bars}</div><div class="dim" style="margin-top:14px;line-height:1.7">MEAN <span class="g">+0.34R</span> · MEDIAN <span class="g">+0.52R</span><br>BEST <span class="g">+5.8R</span> · WORST <span class="r">−3.4R</span></div></div></div>
<div class="p" style="grid-column:span 4;grid-row:span 3"><div class="ph">P&amp;L HEATMAP · WEEKDAY × HOUR<i>$ abs</i></div><div class="pb"><div class="hm">{hm}</div></div></div>
<div class="p" style="grid-column:span 3;grid-row:span 3"><div class="ph">STREAKS · DISCIPLINE</div><div class="pb" style="padding:0 12px"><table class="st" style="margin-top:-2px"><tr><td>Current streak</td><td class="g">W3</td></tr><tr><td>Longest win</td><td class="g">W9</td></tr><tr><td>Longest loss</td><td class="r">L5</td></tr><tr><td>Discipline score</td><td class="a">82 / 100</td></tr><tr><td>Plan followed</td><td>86%</td></tr><tr><td>Rules respected</td><td>91%</td></tr><tr><td>In-plan avg R</td><td class="g">+0.61</td></tr><tr><td>Out-of-plan avg R</td><td class="r">−0.38</td></tr></table></div></div>
<div class="p" style="grid-column:span 5;grid-row:span 3"><div class="ph">ACTIVE ALERTS<i>3</i></div><div class="pb"><div class="al" style="border-color:var(--r)"><div><b class="r">OVERTRADING RISK</b><span>3 losing trades in a row today (limit 3). Consider stopping.</span></div></div><div class="al" style="border-color:var(--am)"><div><b class="a">SIZE ANOMALY</b><span>GBPUSD 1.00 lot after a loss — 41% above 10-trade average.</span></div></div><div class="al" style="border-color:var(--am)"><div><b class="a">RULE BREACH</b><span>Trade taken after 15:00 (rule: no trading after 3 pm).</span></div></div></div></div>
<div class="p" style="grid-column:span 12;grid-row:span 4"><div class="ph">TRADE BLOTTER<i>last 9 · <span class="kb">↑↓</span> navigate <span class="kb">ENTER</span> open <span class="kb">N</span> new</i></div><div class="pb" style="padding:0"><table><tr><th>ID</th><th>TIME</th><th>ASSET</th><th>SIDE</th><th>SIZE</th><th>ENTRY</th><th>EXIT</th><th>R</th><th>P&amp;L</th><th>SETUP</th><th>PLAN</th><th>RULES</th><th>EXEC</th></tr>{body}</table></div></div>
</div>
<div class="status"><span><b>●</b> LOCAL DB OK</span><span>180 trades · 3 accounts</span><span>Last backup 06:12</span><span class="sp"></span><span>F1–F7 navigate · CTRL+K command · N new trade</span></div>
</body></html>"""
    open(OUT+'style-c.html','w',encoding='utf-8').write(html)
styleC()

# ====================== STYLE D — Glass & aurora ======================
def styleD():
    css=FONT_FACE+"""
:root{--tx:#F1F3FF;--tx2:#A9B0D6;--tx3:#737AA3;--gain:#5CF2B0;--loss:#FF7A7A;--bd:rgba(255,255,255,.10)}
body{background:#060918;color:var(--tx)}
.bg{position:fixed;inset:0;background:
 radial-gradient(900px 600px at 12% 8%,rgba(96,72,255,.42),transparent 60%),
 radial-gradient(800px 600px at 92% 12%,rgba(0,186,255,.30),transparent 60%),
 radial-gradient(900px 700px at 70% 105%,rgba(255,64,200,.26),transparent 60%),
 radial-gradient(700px 500px at 5% 95%,rgba(0,230,190,.18),transparent 60%),#060918}
.app{position:relative;display:flex;gap:22px;padding:22px;width:1920px;height:1080px}
.glass{background:linear-gradient(160deg,rgba(255,255,255,.09),rgba(255,255,255,.035));border:1px solid var(--bd);border-radius:24px;backdrop-filter:blur(20px);box-shadow:0 20px 50px -24px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.10)}
.rail{width:78px;padding:18px 0;display:flex;flex-direction:column;align-items:center;gap:10px}
.rail .ic{width:46px;height:46px;border-radius:16px;display:grid;place-items:center;color:var(--tx2)}
.rail .ic.on{background:linear-gradient(135deg,#4F6BFF,#A55BFF 60%,#FF5BD1);color:#fff;box-shadow:0 8px 24px -6px rgba(140,90,255,.8)}
.rail .sp{flex:1}
main{flex:1;display:flex;flex-direction:column;gap:20px;min-width:0}
.top{display:flex;align-items:center;gap:14px}
.hi{font-size:13px;color:var(--tx2)}h1{font-size:32px;font-weight:600;letter-spacing:-.02em}
.pills{display:flex;padding:5px;gap:2px;border-radius:999px;margin-left:auto}
.pills span{padding:9px 17px;border-radius:999px;font-size:13px;font-weight:600;color:var(--tx2)}
.pills .on{background:linear-gradient(135deg,#4F6BFF,#A55BFF);color:#fff;box-shadow:0 6px 18px -6px rgba(140,90,255,.9)}
.btn{border:0;border-radius:999px;background:linear-gradient(135deg,#4F6BFF,#A55BFF 60%,#FF5BD1);color:#fff;font:600 15px Inter;padding:14px 26px;display:flex;gap:8px;align-items:center;box-shadow:0 10px 30px -8px rgba(160,90,255,.85),inset 0 1px 0 rgba(255,255,255,.35)}
.grid{flex:1;display:grid;grid-template-columns:repeat(12,1fr);grid-template-rows:310px 118px 1fr;gap:20px;min-height:0}
.c{padding:22px 24px;min-width:0;min-height:0;overflow:hidden;position:relative}
h3{font-size:15px;font-weight:600;margin-bottom:12px;color:var(--tx)}
.lbl{font-size:12px;letter-spacing:.08em;color:var(--tx3);font-weight:600}
.big{font-size:52px;font-weight:700;letter-spacing:-.03em;line-height:1.05;margin-top:4px;background:linear-gradient(90deg,#fff,#C9D2FF);-webkit-background-clip:text;color:transparent}
.gain{color:var(--gain)}.loss{color:var(--loss)}
.glow path:nth-of-type(2){filter:drop-shadow(0 0 7px rgba(120,140,255,.9))}
.kp{padding:18px 22px}.kl{font-size:13px;color:var(--tx2)}.kv{font-size:30px;font-weight:600;margin-top:4px;letter-spacing:-.02em}.kd{font-size:12.5px;font-weight:600;margin-top:2px}
.kp .ring{position:absolute;right:16px;top:16px}
.ins{display:flex;gap:12px;padding:11px 0}.ins+.ins{border-top:1px solid var(--bd)}
.ii{width:34px;height:34px;border-radius:12px;background:linear-gradient(135deg,rgba(79,107,255,.35),rgba(165,91,255,.35));display:grid;place-items:center;flex:none;color:#DCD3FF}
.ins b{font-size:13.5px}.ins p{font-size:12.5px;color:var(--tx2);margin-top:2px;line-height:1.4}
.cal{display:grid;grid-template-columns:repeat(7,1fr);gap:5px}.dow{font-size:11px;color:var(--tx3);text-align:center;font-weight:600}
.cell{height:64px;border-radius:12px;background:rgba(255,255,255,.05);padding:5px 7px;font-size:11px;color:var(--tx3);position:relative}
.cell.empty{background:none}.cell.off{opacity:.4}.cell b{position:absolute;right:7px;bottom:4px;font-size:10px;color:#fff}
.cell.g1{background:rgba(92,242,176,.16)}.cell.g2{background:rgba(92,242,176,.32)}.cell.g3{background:rgba(92,242,176,.52);box-shadow:0 0 14px -2px rgba(92,242,176,.5)}
.cell.l1{background:rgba(255,122,122,.16)}.cell.l2{background:rgba(255,122,122,.32)}.cell.l3{background:rgba(255,122,122,.52);box-shadow:0 0 14px -2px rgba(255,122,122,.5)}
.dn{display:flex;gap:18px;justify-content:space-around;margin-top:8px}.dn>div{text-align:center;font-size:12.5px;color:var(--tx2)}
table{width:100%;border-collapse:collapse;font-size:13.5px}th{color:var(--tx3);font-size:11px;letter-spacing:.08em;font-weight:600;text-align:left;padding:0 8px 10px}
td{padding:13px 8px;border-top:1px solid var(--bd)}td.r,th.r{text-align:right}
.bd{display:inline-flex;gap:6px;align-items:center;padding:4px 11px;border-radius:999px;font-size:12px;font-weight:600}
.bd i{width:6px;height:6px;border-radius:50%;background:currentColor}
.bd.g{background:rgba(92,242,176,.14);color:var(--gain)}.bd.l{background:rgba(255,122,122,.14);color:var(--loss)}
"""
    ni=['dashboard','trades','calendar','analytics','behavior','journal','goals']
    rail=''.join(f'<div class="ic{" on" if i==0 else ""}">{icon(k,22)}</div>' for i,k in enumerate(ni))
    eq=equity(760,190,'#5B8CFF','#C58CFF',.30,uid='de',grid='rgba(255,255,255,.06)',labels='#737AA3',sw=3)
    def kp(l,v,d,up,seed,col):
        c='var(--gain)' if up else 'var(--loss)'
        return f'<div class="glass c kp"><div class="kl">{l}</div><div class="kv num">{v}</div><div class="kd num" style="color:{c}">{"▲" if up else "▼"} {d}</div><div style="position:absolute;right:18px;bottom:14px;width:110px">{spark(110,40,col,seed,up,uid="ds"+str(seed))}</div></div>'
    kps=kp('Win rate','58%','+3.2%',True,31,'#5CF2B0')+kp('Profit factor','1.74','+0.12',True,32,'#5CF2B0')+kp('Avg risk / reward','1.9','−0.1',False,33,'#FF7A7A')+kp('Max drawdown','−6.2%','+1.4%',True,34,'#5CF2B0')
    insh=''.join(f'<div class="ins"><div class="ii">{icon("bulb",17)}</div><div><b>{t}</b><p>{d}</p></div></div>' for t,d in [('Best setup: Breakout NY','58% win rate · +$4,120 over 41 trades'),('Discipline dips after 2 losses','Position size +23% on your last 10 trades'),('Friday is your weakest day','−$1,340 net, 3 rule breaches after 3 pm')])
    wl=donut(150,20,[('#5CF2B0',58),('#FF7A7A',36),('#8791C9',6)],'rgba(255,255,255,.08)','58%','win rate','#fff','#A9B0D6')
    ss=donut(150,20,[('#5B8CFF',44),('#C58CFF',31),('#FF5BD1',25)],'rgba(255,255,255,.08)','NY','best session','#fff','#A9B0D6')
    trs=[('EURUSD','LONG','+$412.00','+2.1R','Breakout NY','g','Plan followed'),('NAS100','SHORT','−$186.50','−0.9R','Trend pullback','l','Plan broken'),('XAUUSD','LONG','+$96.20','+0.8R','Mean reversion','g','Plan followed'),('GBPUSD','SHORT','−$204.00','−1.0R','Breakout NY','l','Plan broken'),('US30','LONG','+$218.40','+1.2R','Trend pullback','g','Plan followed'),('EURUSD','LONG','+$352.10','+1.8R','Breakout NY','g','Plan followed'),('XAUUSD','SHORT','+$64.00','+0.6R','Mean reversion','g','Plan followed'),('NAS100','LONG','−$162.20','−0.8R','Trend pullback','l','Plan broken')]
    tb=''.join(f'<tr><td><b>{a}</b></td><td class="{"gain" if sd=="LONG" else "loss"}">{sd}</td><td>{st}</td><td class="r num {"gain" if k=="g" else "loss"}"><b>{p}</b></td><td class="r num">{r}</td><td><span class="bd {k}"><i></i>{pl}</span></td></tr>' for a,sd,p,r,st,k,pl in trs)
    html=f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Pulse — Glass style</title><style>{css}</style></head><body><div class="bg"></div><div class="app">
<aside class="glass rail">{logo(38,'dl','#5B8CFF','#FF5BD1',True)}<div style="height:14px"></div>{rail}<div class="sp"></div><div class="ic">{icon('settings',22)}</div></aside>
<main><div class="top"><div><div class="hi">Welcome back</div><h1>Trading performance</h1></div><div class="glass pills"><span>1D</span><span>1W</span><span>1M</span><span class="on">3M</span><span>1Y</span><span>ALL</span></div><button class="btn">{icon('plus',18)} New trade</button></div>
<div class="grid">
<section class="glass c" style="grid-column:span 6"><div class="lbl">NET P&amp;L · 3 MONTHS</div><div style="display:flex;align-items:baseline;gap:16px"><div class="big num">+$12,480</div><div class="gain num" style="font-weight:600">▲ 8.4%</div></div><div class="glow" style="margin-top:6px">{eq}</div></section>
<section class="glass c" style="grid-column:span 3"><h3>Discipline score</h3><div style="display:flex;justify-content:center;margin-top:4px">{ring(82,200,16,'#5B8CFF','#FF5BD1','rgba(255,255,255,.08)','dr','#fff','#A9B0D6',54)}</div><div style="display:flex;justify-content:space-between;margin-top:8px;font-size:12px;color:var(--tx3)"><span>Plan 86%</span><span>Rules 91%</span><span>Checklist 74%</span></div></section>
<section class="glass c" style="grid-column:span 3"><h3>Insights</h3>{insh}</section>
<div style="grid-column:span 12;display:grid;grid-template-columns:repeat(4,1fr);gap:20px">{kps}</div>
<section class="glass c" style="grid-column:span 3"><h3>Trading activity · Sep</h3>{calendar()}</section>
<section class="glass c" style="grid-column:span 3"><h3>Win / loss · Sessions</h3><div class="dn"><div>{wl}<div>Win / loss</div></div><div>{ss}<div>Sessions</div></div></div><div style="display:flex;justify-content:space-around;margin-top:26px;font-size:12.5px;color:var(--tx2)"><span><i style="display:inline-block;width:9px;height:9px;border-radius:3px;background:#5CF2B0;margin-right:7px"></i>Wins 104</span><span><i style="display:inline-block;width:9px;height:9px;border-radius:3px;background:#FF7A7A;margin-right:7px"></i>Losses 65</span></div></section>
<section class="glass c" style="grid-column:span 6"><h3>Recent trades</h3><table><tr><th>ASSET</th><th>SIDE</th><th>SETUP</th><th class="r">P&amp;L</th><th class="r">R</th><th>PROCESS</th></tr>{tb}</table></section>
</div></main></div></body></html>"""
    open(OUT+'style-d.html','w',encoding='utf-8').write(html)
styleD()


# ====================== STYLE A+E — hybride : palette Pulse + mise en page Carnet ======================
def styleAE():
    h=open(OUT+'style-e.html',encoding='utf-8').read()
    subs=[('--brz:#C9A35A','--brz:#A79DF2'),('#C9A35A','#4A5FD9'),('#E6CB8E','#8B7FE8'),
      ('--bg:#16140F','--bg:#0B0E27'),('--side:#1B1812','--side:#0D1120'),('--card:#211E17','--card:#171B33'),('--card2:#2A261D','--card2:#1F2440'),
      ('--tx:#EFE9DC','--tx:#F0EDE4'),('--tx2:#B3AA98','--tx2:#9AA0C0'),('--tx3:#807867','--tx3:#6B7290'),
      ('--teal:#3E8C86','--teal:#4A5FD9'),('--gain:#8DB48E','--gain:#5FCB9E'),('--loss:#D57A62','--loss:#F0776B'),
      ('rgba(239,233,220,','rgba(240,237,228,'),('rgba(201,163,90,','rgba(139,127,232,'),
      ('rgba(62,140,134,.18);border-color:rgba(62,140,134,.5);color:#8ACBC4','rgba(74,95,217,.2);border-color:rgba(74,95,217,.55);color:#B4BEFF'),
      ('rgba(141,180,142,','rgba(95,203,158,'),('rgba(213,122,98,','rgba(240,119,107,'),
      ('.btn{background:var(--brz);color:#1B1710;','.btn{background:linear-gradient(135deg,#4A5FD9,#8B7FE8);color:#fff;box-shadow:0 6px 16px -6px rgba(91,114,200,.6),inset 0 1px 0 rgba(255,255,255,.28);'),
      ('.box.ok{background:var(--teal);border-color:var(--teal);color:#0F1B1A}','.box.ok{background:#4A5FD9;border-color:#4A5FD9;color:#fff}'),
      ('<title>Pulse — Notebook style</title>','<title>Pulse — Hybrid A+E</title>'),
      ('.card{background:var(--card);border:1px solid var(--bd);border-radius:14px;','.card{background:var(--card);border:1px solid var(--bd);border-radius:20px;box-shadow:0 1px 2px rgba(0,0,0,.35),0 8px 24px -12px rgba(0,0,0,.5);'),
      ('.strip{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--bd);border-radius:14px;','.strip{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--bd);border-radius:20px;'),
      ]
    for a,b in subs:
        assert a in h,a
        h=h.replace(a,b)
    open(OUT+'style-ae.html','w',encoding='utf-8').write(h)
styleAE()


# ====================== STYLE A+D — hybride : structure Pulse + verre & aurora ======================
def styleAD():
    h=open(OUT+'style-a.html',encoding='utf-8').read()
    extra="""
body{background:#080B20}
.app{background:
 radial-gradient(900px 620px at 8% 6%,rgba(74,95,217,.42),transparent 60%),
 radial-gradient(800px 600px at 95% 10%,rgba(139,127,232,.30),transparent 60%),
 radial-gradient(900px 700px at 65% 108%,rgba(74,95,217,.30),transparent 60%),
 radial-gradient(600px 420px at 3% 96%,rgba(95,203,158,.10),transparent 60%),#080B20}
.side,.top{background:rgba(12,16,40,.55);backdrop-filter:blur(22px);border-color:rgba(255,255,255,.08)}
.card{background:linear-gradient(160deg,rgba(255,255,255,.085),rgba(255,255,255,.03));border:1px solid rgba(255,255,255,.10);border-radius:24px;backdrop-filter:blur(20px);
 box-shadow:0 20px 50px -24px rgba(0,0,0,.65),inset 0 1px 0 rgba(255,255,255,.10)}
.chip,.periods,.bellb{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08)}
.nav.on{background:linear-gradient(135deg,rgba(74,95,217,.30),rgba(139,127,232,.20));box-shadow:0 8px 24px -10px rgba(139,127,232,.7),inset 0 1px 0 rgba(255,255,255,.12);color:#fff}
.periods .on,.avatar{box-shadow:0 6px 18px -6px rgba(139,127,232,.9)}
.btn{box-shadow:0 10px 30px -8px rgba(139,127,232,.85),inset 0 1px 0 rgba(255,255,255,.35)}
.hero svg path:nth-of-type(2){filter:drop-shadow(0 0 8px rgba(139,127,232,.95))}
.big{background:linear-gradient(90deg,#fff,#C9D2FF);-webkit-background-clip:text;color:transparent}
.cell.g3{box-shadow:0 0 14px -2px rgba(95,203,158,.55)}.cell.l3{box-shadow:0 0 14px -2px rgba(240,119,107,.55)}
.cell{border-radius:12px}.ii{background:linear-gradient(135deg,rgba(74,95,217,.35),rgba(139,127,232,.30));color:#DCD3FF}
.badge.g,.badge.n{backdrop-filter:blur(6px)}
"""
    assert '</style>' in h
    h=h.replace('</style>',extra+'</style>',1).replace('<title>Pulse — a</title>','<title>Pulse — Hybrid A+D</title>')
    open(OUT+'style-ad.html','w',encoding='utf-8').write(h)
styleAD()


# ====================== STYLE F — « Maison » (ultra-luxe, ivoire / émeraude / or champagne) ======================
def styleF():
    css=FONT_FACE+"""
:root{--ivory:#F2EEE4;--paper:#FBF9F4;--ink:#101513;--ink2:rgba(16,21,19,.62);--ink3:rgba(16,21,19,.42);--hl:rgba(16,21,19,.12);
--em:#0C231D;--em2:#12362D;--gold:#B79A5B;--champ:#E3D2A6;--gain:#2B7A58;--loss:#9E3A31;--cream:#F0E8D4}
body{background:var(--ivory);color:var(--ink)}
.serif,.sf{font-family:Fraunces,serif;font-variant-numeric:lining-nums tabular-nums;font-feature-settings:'lnum','tnum'}
svg text{font-family:Inter}
.top{height:92px;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding:0 56px;border-bottom:1px solid var(--hl);background:var(--paper)}
.wm{display:flex;align-items:center;gap:14px}.wm b{font-family:Fraunces,serif;font-weight:400;font-size:26px;letter-spacing:.34em}
.nav{display:flex;gap:40px}.nav span{font-size:12.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink3);padding:34px 0 30px;position:relative;font-weight:500}
.nav .on{color:var(--ink)}.nav .on::after{content:'';position:absolute;left:0;right:0;bottom:-1px;height:2px;background:var(--gold)}
.rt{display:flex;justify-content:flex-end;align-items:center;gap:26px}
.acct{text-align:right;line-height:1.35}.acct small{display:block;font-size:10.5px;letter-spacing:.16em;color:var(--ink3);text-transform:uppercase}.acct b{font-size:14px;font-weight:500}
.btn{background:var(--ink);color:var(--champ);border:0;border-radius:3px;font:500 12.5px Inter;letter-spacing:.16em;text-transform:uppercase;padding:15px 26px;display:flex;gap:10px;align-items:center}
.av{width:40px;height:40px;border-radius:50%;border:1px solid var(--gold);display:grid;place-items:center;font-family:Fraunces,serif;color:var(--gold);font-size:16px}
.body{padding:40px 56px 40px;display:grid;grid-template-columns:repeat(12,1fr);grid-template-rows:456px 1fr;gap:32px;height:988px}
.cap{font-size:11px;letter-spacing:.2em;text-transform:uppercase;font-weight:500}
.hero{grid-column:span 8;background:linear-gradient(160deg,var(--em2),var(--em) 62%);border-radius:6px;position:relative;color:var(--cream);padding:40px 48px;display:flex;flex-direction:column;overflow:hidden}
.hero::before{content:'';position:absolute;inset:12px;border:1px solid rgba(227,210,166,.22);border-radius:3px;pointer-events:none}
.hero .gl{position:absolute;right:-120px;top:-120px;opacity:.5}
.hero .cap{color:var(--champ)}
.big{font-family:Fraunces,serif;font-weight:300;font-size:92px;letter-spacing:-.025em;line-height:1;margin-top:14px;font-variant-numeric:lining-nums tabular-nums;color:#FBF3DE}
.sub{display:flex;gap:18px;align-items:center;margin-top:12px;font-size:14px;color:rgba(240,232,212,.65)}.sub b{color:#8ED2AE;font-weight:500}
.hero svg.eq{margin-top:auto;display:block}
.kp{display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid rgba(227,210,166,.22);margin-top:12px;padding-top:16px}
.kp>div{padding-left:22px;border-left:1px solid rgba(227,210,166,.16)}.kp>div:first-child{padding-left:0;border-left:0}
.kp .cap{font-size:10px;color:rgba(227,210,166,.75)}.kp .v{font-family:Fraunces,serif;font-weight:300;font-size:32px;margin-top:4px;font-variant-numeric:lining-nums tabular-nums}
.paper{background:var(--paper);border:1px solid var(--hl);border-radius:6px;padding:28px 30px;min-height:0;overflow:hidden}
.paper h3{font-family:Fraunces,serif;font-weight:400;font-size:22px;letter-spacing:-.005em}
.paper .cap{color:var(--ink3);margin-bottom:4px}
.led{grid-column:span 4;display:flex;flex-direction:column}
table{width:100%;border-collapse:collapse;margin-top:14px}
td{padding:14px 0;border-top:1px solid var(--hl);font-size:14px}td.r{text-align:right;font-family:Fraunces,serif;font-size:19px;font-variant-numeric:lining-nums tabular-nums}
td small{display:block;font-size:11px;letter-spacing:.12em;color:var(--ink3);text-transform:uppercase;margin-top:2px}
.g{color:var(--gain)}.l{color:var(--loss)}
.row2{grid-column:span 12;display:grid;grid-template-columns:repeat(4,1fr);gap:32px;min-height:0}
.rc{display:flex;justify-content:center;margin-top:14px}
.tri{display:flex;justify-content:space-between;margin-top:14px;font-size:12px;color:var(--ink3);letter-spacing:.06em}.tri b{display:block;font-family:Fraunces,serif;font-weight:400;font-size:20px;color:var(--ink);letter-spacing:0}
.cal{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-top:14px}.dow{font-size:10.5px;letter-spacing:.14em;color:var(--ink3);text-align:center}
.cell{height:50px;border-radius:2px;background:transparent;border-top:1px solid var(--hl);padding:5px 4px;font-size:11px;color:var(--ink3);position:relative}
.cell.empty{border:0}.cell.off{opacity:.4}
.cell b{position:absolute;left:4px;bottom:4px;font-size:11px;font-weight:600;font-family:Fraunces,serif}
.cell.g1,.cell.g2,.cell.g3{background:rgba(43,122,88,.08)}.cell.g2{background:rgba(43,122,88,.15)}.cell.g3{background:rgba(43,122,88,.26)}
.cell.l1,.cell.l2,.cell.l3{background:rgba(158,58,49,.08)}.cell.l2{background:rgba(158,58,49,.15)}.cell.l3{background:rgba(158,58,49,.26)}
.cell.g1 b,.cell.g2 b,.cell.g3 b{color:var(--gain)}.cell.l1 b,.cell.l2 b,.cell.l3 b{color:var(--loss)}
.note{display:grid;grid-template-columns:34px 1fr;gap:6px;padding:16px 0;border-top:1px solid var(--hl)}
.note:first-of-type{margin-top:12px}
.note i{font-family:Fraunces,serif;font-style:italic;color:var(--gold);font-size:20px}
.note b{font-weight:500;font-size:14.5px}.note p{font-size:13px;color:var(--ink2);line-height:1.55;margin-top:3px}
"""
    eq=equity(1000,222,'#B79A5B','#E3D2A6',.22,uid='fe',grid='rgba(227,210,166,.10)',labels='rgba(240,232,212,.5)',sw=2).replace('<svg ','<svg class="eq" ',1)
    ring_=ring(82,196,7,'#8F7439','#E3D2A6','rgba(16,21,19,.08)','fr','#101513','#7B7F7C',60,sub='OF 100').replace('font-weight="600"','font-weight="300"').replace('<text x="50%" y="','<text style="font-family:Fraunces,serif" x="50%" y="',1)
    hb=hourly(360,250,'#2B7A58','#9E3A31','rgba(16,21,19,.42)','rgba(16,21,19,.14)').replace('rx="5"','rx="1"')
    # guilloché
    gl=''.join(f'<circle cx="300" cy="300" r="{r}" fill="none" stroke="#E3D2A6" stroke-width=".6" stroke-opacity=".28"/>' for r in range(20,300,9))
    gl=f'<svg class="gl" width="600" height="600" viewBox="0 0 600 600">{gl}</svg>'
    led=[('EURUSD','Long · Breakout NY','+$412.00','g','09:42'),('NAS100','Short · Trend pullback','−$186.50','l','11:05'),('XAUUSD','Long · Mean reversion','+$96.20','g','14:20'),('GBPUSD','Short · Breakout NY','−$204.00','l','15:48'),('US30','Long · Trend pullback','+$218.40','g','Fri 10:12')]
    lr=''.join(f'<tr><td><b style="font-weight:500">{a}</b><small>{b}</small></td><td class="r {k}">{p}<small style="text-align:right">{t}</small></td></tr>' for a,b,p,k,t in led)
    notes=''.join(f'<div class="note"><i>{n}</i><div><b>{t}</b><p>{d}</p></div></div>' for n,t,d in [('i.','Best setup — Breakout NY','58% win rate and +$4,120 across 41 trades.'),('ii.','Discipline slips after two losses','Position size rose 23% over your last ten trades.'),('iii.','Friday is the weakest day','−$1,340 net; three rule breaches after 3 pm.')])
    nav=''.join(f'<span class="{"on" if i==0 else ""}">{n}</span>' for i,n in enumerate(['Overview','Trades','Calendar','Analytics','Behavior','Journal','Goals']))
    html=f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Pulse — Maison style</title><style>{css}</style></head><body>
<header class="top"><div class="wm">{logo(34,'fl','#8F7439','#D8C08A',False)}<b>PULSE</b></div><nav class="nav">{nav}</nav>
<div class="rt"><div class="acct"><small>Account</small><b>Main account · USD</b></div><div class="acct"><small>Period</small><b>Apr 1 – Sep 28</b></div><button class="btn">New entry</button><div class="av">T</div></div></header>
<div class="body">
<section class="hero">{gl}<div class="cap">Net performance · Three months</div><div class="big">+$12,480.00</div>
<div class="sub"><b>▲ 8.4%</b><span>versus previous quarter</span><span style="opacity:.4">|</span><span>180 closed trades</span></div>
{eq}
<div class="kp"><div><div class="cap">Win rate</div><div class="v">58%</div></div><div><div class="cap">Profit factor</div><div class="v">1.74</div></div><div><div class="cap">Expectancy</div><div class="v">+0.34 R</div></div><div><div class="cap">Max drawdown</div><div class="v">−6.2%</div></div></div></section>
<section class="paper led"><div class="cap">Ledger</div><h3>Recent trades</h3><table>{lr}</table></section>
<div class="row2">
<section class="paper"><div class="cap">Process</div><h3>Discipline score</h3><div class="rc">{ring_}</div><div class="tri"><span><b>86%</b>Plan</span><span><b>91%</b>Rules</span><span><b>74%</b>Checklist</span></div></section>
<section class="paper"><div class="cap">By hour</div><h3>Hourly performance</h3><div style="margin-top:22px">{hb}</div></section>
<section class="paper"><div class="cap">September</div><h3>Trading calendar</h3>{calendar()}</section>
<section class="paper"><div class="cap">Observations</div><h3>Insights</h3>{notes}</section>
</div></div></body></html>"""
    open(OUT+'style-f.html','w',encoding='utf-8').write(html)
styleF()


# ====================== ÉCRANS A+D : formulaire, détail, comportement ======================
import re
SCR_CSS="""
.pg{flex:1;padding:24px 28px;display:flex;flex-direction:column;gap:18px;min-height:0}
.pt{display:flex;align-items:center;justify-content:space-between}.pt h1{font-size:28px;font-weight:600;letter-spacing:-.02em}.pt p{color:var(--tx2);font-size:14px;margin-top:2px}
.pt .acts{display:flex;gap:12px}
.btn.ghost{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);box-shadow:none;color:var(--tx)}
.cols{flex:1;display:grid;gap:20px;min-height:0}
.col{display:flex;flex-direction:column;gap:20px;min-height:0}
.card.pad{padding:22px 24px}
.sec{display:flex;align-items:center;gap:10px;font-size:15px;font-weight:600;margin-bottom:16px}
.sec i{width:24px;height:24px;border-radius:50%;background:var(--grad);display:grid;place-items:center;font-style:normal;font-size:12px;color:#fff}
.f{display:flex;flex-direction:column;gap:6px;min-width:0}.f label{font-size:11.5px;color:var(--tx3);font-weight:600;letter-spacing:.05em;text-transform:uppercase}
.in{height:42px;border-radius:14px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.10);padding:0 14px;display:flex;align-items:center;justify-content:space-between;font-size:14px;color:var(--tx)}
.in.ta{height:auto;min-height:90px;align-items:flex-start;padding:12px 14px;line-height:1.55;color:var(--tx2)}.in .u{color:var(--tx3);font-size:12px}
.in.auto{border-color:rgba(139,127,232,.45)}.in .tagx{font-size:10.5px;color:#B4BEFF;background:rgba(139,127,232,.18);padding:2px 8px;border-radius:999px;font-weight:600}
.seg{display:flex;padding:4px;border-radius:14px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.10);height:42px}
.seg span{flex:1;display:grid;place-items:center;border-radius:10px;font-size:13.5px;font-weight:600;color:var(--tx2)}
.seg .on{background:linear-gradient(135deg,rgba(95,203,158,.32),rgba(95,203,158,.14));color:#5FCB9E}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:14px}.g3{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.gap{height:14px}
.chips{display:flex;gap:8px;flex-wrap:wrap}.chp{padding:7px 14px;border-radius:999px;font-size:13px;font-weight:500;color:var(--tx2);background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.10)}
.chp.on{background:linear-gradient(135deg,rgba(74,95,217,.38),rgba(139,127,232,.26));border-color:rgba(139,127,232,.6);color:#fff}
.chp.bad{background:rgba(240,119,107,.14);border-color:rgba(240,119,107,.45);color:#F5A198}
.sl{position:relative;height:6px;border-radius:99px;background:rgba(255,255,255,.10);margin:14px 0 6px}
.sl b{position:absolute;left:0;top:0;bottom:0;width:66%;border-radius:99px;background:var(--grad)}
.sl u{position:absolute;left:66%;top:-7px;width:20px;height:20px;margin-left:-10px;border-radius:50%;background:#fff;box-shadow:0 0 0 4px rgba(139,127,232,.35),0 4px 12px rgba(0,0,0,.5)}
.dots{display:flex;gap:8px}.dots i{width:30px;height:8px;border-radius:99px;background:rgba(255,255,255,.12)}.dots i.on{background:var(--grad)}
.stars{color:#D9A85A;letter-spacing:3px;font-size:18px}.stars s{text-decoration:none;opacity:.25}
.tog{width:46px;height:26px;border-radius:99px;background:var(--grad);position:relative;flex:none}.tog::after{content:'';position:absolute;right:3px;top:3px;width:20px;height:20px;border-radius:50%;background:#fff}
.row{display:flex;align-items:center;justify-content:space-between;gap:12px}
.ck{display:flex;gap:11px;align-items:center;font-size:13.5px;color:var(--tx2);padding:6px 0}
.ck .bx{width:19px;height:19px;border-radius:6px;border:1.5px solid var(--tx3);display:grid;place-items:center;font-size:11px;flex:none}
.ck .bx.ok{background:var(--grad);border-color:transparent;color:#fff}.ck .bx.ko{border-color:#F0776B;color:#F0776B}
.nt{display:flex;gap:12px;padding:13px 15px;border-radius:16px;font-size:13px;line-height:1.45}
.nt.ok{background:rgba(95,203,158,.10);border:1px solid rgba(95,203,158,.30);color:#9BE3C4}
.nt.warn{background:rgba(217,168,90,.12);border:1px solid rgba(217,168,90,.38);color:#F0CE8E}
.nt.bad{background:rgba(240,119,107,.12);border:1px solid rgba(240,119,107,.40);color:#F5A198}
.drop{border:1.5px dashed rgba(255,255,255,.22);border-radius:16px;height:96px;display:grid;place-items:center;color:var(--tx3);font-size:13px;text-align:center}
.kv2{display:flex;justify-content:space-between;padding:9px 0;border-top:1px solid rgba(255,255,255,.07);font-size:13.5px;color:var(--tx2)}.kv2 b{color:var(--tx);font-weight:600}.kv2:first-of-type{border-top:0}
.bigg{font-size:44px;font-weight:700;letter-spacing:-.02em;color:#5FCB9E;line-height:1.05}
.tl{display:flex;gap:10px;align-items:center}.tl span.ar{color:var(--tx3)}
.ai{background:linear-gradient(160deg,rgba(74,95,217,.22),rgba(139,127,232,.10))!important;border-color:rgba(139,127,232,.35)!important}
.aitag{font-size:10.5px;font-weight:700;letter-spacing:.1em;padding:3px 9px;border-radius:99px;background:var(--grad);color:#fff}
.hb{display:flex;align-items:center;gap:12px;margin:10px 0;font-size:13.5px}.hb .n{width:92px;color:var(--tx2)}.hb .tr{flex:1;height:10px;border-radius:99px;background:rgba(255,255,255,.07);position:relative}
.hb .tr i{position:absolute;top:0;bottom:0;border-radius:99px}.hb .v{width:150px;text-align:right;font-variant-numeric:tabular-nums}
.pn{display:flex;justify-content:space-between;align-items:baseline}
.cmp{display:grid;grid-template-columns:1fr 1fr;gap:14px}.cmp>div{padding:16px;border-radius:16px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08)}
.cmp small{display:block;font-size:11px;letter-spacing:.08em;color:var(--tx3);font-weight:600;text-transform:uppercase;margin-bottom:8px}
.cmp b{font-size:26px;font-weight:600}.cmp span{display:block;font-size:12.5px;color:var(--tx2);margin-top:2px}
.mist{display:flex;align-items:center;gap:12px;padding:11px 0;border-top:1px solid rgba(255,255,255,.07);font-size:14px}.mist:first-of-type{border-top:0}
.mist .c{width:30px;height:30px;border-radius:10px;background:rgba(240,119,107,.16);color:#F5A198;display:grid;place-items:center;font-weight:700;font-size:13px}
.mist .m{flex:1}.mist .p{color:#F0776B;font-weight:600;font-variant-numeric:tabular-nums}
"""

def _shell(active,label,content,title):
    h=open(OUT+'style-ad.html',encoding='utf-8').read()
    head,_=h.split('<div class="grid">',1)
    head=head.replace('class="nav on"','class="nav"',1)
    head,n=re.subn(r'<div class="nav">(<svg(?:(?!</svg>).)*</svg>)<span>'+re.escape(active)+'</span>',r'<div class="nav on">\1<span>'+active+'</span>',head,count=1,flags=re.S)
    assert n==1,active
    head=head.replace('</style>',SCR_CSS+'</style>',1).replace('Pulse — Hybrid A+D','Pulse — '+title)
    return head+content+'</main></div></body></html>'

def candles(w,h,seed=9):
    r=random.Random(seed); n=58; p=100; cs=[]
    for i in range(n):
        o=p; c=o+r.gauss(.15 if i>26 else -.05,1.4); hi=max(o,c)+abs(r.gauss(0,.7)); lo=min(o,c)-abs(r.gauss(0,.7)); cs.append((o,c,hi,lo)); p=c
    mn=min(c[3] for c in cs)-1; mx=max(c[2] for c in cs)+1
    Y=lambda v:h-30-(v-mn)/(mx-mn)*(h-50)
    bw=(w-150)/n; out=''
    for k in range(6): out+=f'<line x1="0" x2="{w-90}" y1="{20+k*(h-70)/5:.0f}" y2="{20+k*(h-70)/5:.0f}" stroke="rgba(255,255,255,.05)"/>'
    for i,(o,c,hi,lo) in enumerate(cs):
        x=14+i*bw; col='#5FCB9E' if c>=o else '#F0776B'
        out+=f'<line x1="{x+bw*.35:.1f}" x2="{x+bw*.35:.1f}" y1="{Y(hi):.1f}" y2="{Y(lo):.1f}" stroke="{col}" stroke-width="1.2"/><rect x="{x:.1f}" y="{Y(max(o,c)):.1f}" width="{bw*.7:.1f}" height="{max(abs(Y(o)-Y(c)),1.5):.1f}" rx="1.5" fill="{col}"/>'
    ent=cs[30][0]+0.2; sl=ent-3.6; tp=ent+8.2
    def line(v,col,lab,dash=''):
        return f'<line x1="{14+29*bw:.0f}" x2="{w-90}" y1="{Y(v):.1f}" y2="{Y(v):.1f}" stroke="{col}" stroke-width="1.4" stroke-dasharray="{dash}"/><rect x="{w-86}" y="{Y(v)-12:.1f}" width="80" height="24" rx="12" fill="{col}" fill-opacity=".18" stroke="{col}" stroke-opacity=".7"/><text x="{w-46}" y="{Y(v)+4:.1f}" text-anchor="middle" font-size="12" font-weight="600" fill="{col}">{lab}</text>'
    out+=line(ent,'#8B7FE8','ENTRY 1.0842')+line(sl,'#F0776B','SL 1.0824','6 5')+line(tp,'#5FCB9E','TP 1.0888','6 5')
    out+=f'<circle cx="{14+30*bw+bw*.35:.1f}" cy="{Y(cs[30][0]):.1f}" r="6" fill="#8B7FE8" stroke="#fff" stroke-width="2"/><circle cx="{14+51*bw+bw*.35:.1f}" cy="{Y(cs[51][1]):.1f}" r="6" fill="#5FCB9E" stroke="#fff" stroke-width="2"/>'
    return f'<svg width="100%" height="{h}" viewBox="0 0 {w} {h}" preserveAspectRatio="xMidYMid meet">{out}</svg>'

def field(l,v,u='',cls=''):
    return f'<div class="f"><label>{l}</label><div class="in {cls}"><span>{v}</span>{f"<span class=u>{u}</span>" if u else ""}</div></div>'

def screen_form():
    basics=f'''<div class="card pad"><div class="sec"><i>1</i>Basics</div><div class="g3">{field('Asset','EURUSD','Forex')}<div class="f"><label>Side</label><div class="seg"><span class="on">Long</span><span>Short</span></div></div>{field('Account','Main account')}</div><div class="gap"></div><div class="g3">{field('Date & time','28 Sep 2026 · 09:42')}<div class="f"><label>Session</label><div class="in auto"><span>New York</span><span class="tagx">AUTO</span></div></div>{field('Timeframe','M15')}</div></div>'''
    price=f'''<div class="card pad"><div class="sec"><i>2</i>Price &amp; size</div><div class="g3">{field('Entry','1.0842')}{field('Exit','1.0871')}{field('Size','1.20','lots')}</div><div class="gap"></div><div class="g3">{field('Stop loss','1.0824','planned')}{field('Take profit','1.0888','planned')}{field('Fees','6.40','USD')}</div></div>'''
    ctx=f'''<div class="card pad" style="flex:1"><div class="sec"><i>3</i>Context</div><div class="f"><label>Setup</label><div class="chips"><span class="chp on">Breakout NY</span><span class="chp">Mean reversion</span><span class="chp">Trend pullback</span><span class="chp">＋ New setup</span></div></div><div class="gap"></div><div class="f"><label>Market condition</label><div class="chips"><span class="chp">Range</span><span class="chp on">Trend</span><span class="chp">High volatility</span><span class="chp">Economic news</span></div></div><div class="gap"></div><div class="f"><label>Trade type</label><div class="seg" style="max-width:280px"><span class="on" style="background:linear-gradient(135deg,rgba(74,95,217,.4),rgba(139,127,232,.28));color:#fff">Discretionary</span><span>System</span></div></div></div>'''
    why=f'''<div class="card pad"><div class="sec"><i>4</i>The “why”</div><div class="f"><label>Entry thesis</label><div class="in ta">NY open breakout above the Asian range high, confirmed by a retest on M5. Stop under the retest low, target = previous day high.</div></div><div class="gap"></div>
<div class="f"><label>Conviction before the result</label><div class="sl"><b></b><u></u></div><div class="row"><span style="font-size:12px;color:var(--tx3)">1</span><b style="font-size:18px">7 / 10</b><span style="font-size:12px;color:var(--tx3)">10</span></div></div><div class="gap"></div>
<div class="f"><label>Emotion before</label><div class="chips"><span class="chp on">Calm</span><span class="chp">FOMO</span><span class="chp">Doubt</span><span class="chp">Stress</span></div></div><div class="gap"></div>
<div class="f"><label>Emotion during</label><div class="chips"><span class="chp">Calm</span><span class="chp on">Discipline</span><span class="chp">Impatience</span></div></div><div class="gap"></div>
<div class="row"><div class="f"><label>Plan followed</label></div><div class="tog"></div></div></div>'''
    after=f'''<div class="card pad" style="flex:1"><div class="sec"><i>5</i>After the trade</div><div class="row"><div class="f"><label>Execution quality</label><div class="dots"><i class="on"></i><i class="on"></i><i class="on"></i><i class="on"></i><i></i></div></div><div class="f"><label>Star rating</label><div class="stars">★★★★<s>★</s></div></div></div><div class="gap"></div><div class="f"><label>Post-mortem</label><div class="in ta" style="min-height:76px">Took profit at the plan target. Could have trailed the stop after 1.5R.</div></div><div class="gap"></div><div class="f"><label>Mistakes</label><div class="chips"><span class="chp">Early exit</span><span class="chp">Overtrading</span><span class="chp">Revenge</span><span class="chp">No plan</span></div></div></div>'''
    rules=''.join(f'<div class="ck"><span class="bx {k}">{"✓" if k=="ok" else "✕" if k=="ko" else ""}</span>{t}</div>' for k,t in [('ok','Stop loss set before entry'),('ok','Risk ≤ 1% of capital'),('ok','Max 3 trades per day'),('ko','No trading after 3 pm'),('ok','Pre-trade checklist completed')])
    right=f'''<div class="card pad"><div class="lbl">LIVE PREVIEW</div><div class="bigg num" style="margin-top:6px">+$412.00</div><div style="color:var(--tx2);font-size:13px;margin-top:2px">Net of fees · +2.1 R</div><div style="height:12px"></div><div class="kv2"><span>Gross P&amp;L</span><b class="num">+$418.40</b></div><div class="kv2"><span>Risk taken</span><b class="num">0.9% · $216</b></div><div class="kv2"><span>Planned R:R</span><b class="num">2.5</b></div><div class="kv2"><span>Duration</span><b class="num">1h 12m</b></div></div>
<div class="nt ok"><b>✓</b><span>Risk is within your 1% per-trade limit.</span></div>
<div class="card pad"><div class="sec" style="font-size:14px;margin-bottom:8px">Rules &amp; checklist</div>{rules}</div>
<div class="nt bad"><b>!</b><span>Rule “No trading after 3 pm” not respected — it will count against your discipline score.</span></div>
<div class="drop">Drop the chart screenshot here<br><small style="opacity:.7">or paste from clipboard</small></div>'''
    content=f'''<div class="pg"><div class="pt"><div><h1>New trade</h1><p>Log the result <i>and</i> the process behind it.</p></div><div class="acts"><button class="btn ghost">Quick add</button><button class="btn ghost">Cancel</button><button class="btn">Save trade</button></div></div>
<div class="cols" style="grid-template-columns:5fr 4.2fr 3.2fr"><div class="col">{basics}{price}{ctx}</div><div class="col">{why}{after}</div><div class="col">{right}</div></div></div>'''
    open(OUT+'screen-form.html','w',encoding='utf-8').write(_shell('Trades','Trades',content,'New trade'))

def screen_detail():
    ch=candles(1100,540)
    left=f'''<div class="card pad" style="padding-bottom:10px"><div class="row" style="margin-bottom:8px"><div class="sec" style="margin:0">Chart at decision time</div><div class="chips"><span class="chp on">M15</span><span class="chp">M5</span><span class="chp">H1</span></div></div>{ch}</div>
<div class="cmp" style="grid-template-columns:1fr 1fr"><div class="card pad" style="border-radius:24px"><small>Entry thesis</small><p style="font-size:14px;line-height:1.6;color:var(--tx2)">NY open breakout above the Asian range high, confirmed by a retest on M5. Stop under the retest low, target = previous day high.</p></div><div class="card pad" style="border-radius:24px"><small>Post-mortem</small><p style="font-size:14px;line-height:1.6;color:var(--tx2)">Took profit at the plan target. Could have trailed the stop after 1.5R — price ran another 18 pips after exit (≈ +$216 left on the table).</p></div></div>
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:20px"><div class="card pad" style="padding:16px 20px"><div class="lbl">STOP · PLAN vs REAL</div><div class="num" style="font-size:20px;font-weight:600;margin-top:4px">1.0824 <span style="color:var(--tx3);font-weight:400">/</span> —</div><div style="font-size:12px;color:var(--tx3)">not hit</div></div><div class="card pad" style="padding:16px 20px"><div class="lbl">TARGET · PLAN vs REAL</div><div class="num" style="font-size:20px;font-weight:600;margin-top:4px">1.0888 <span style="color:var(--tx3);font-weight:400">/</span> 1.0871</div><div style="font-size:12px;color:#D9A85A">exited 17 pips early</div></div><div class="card pad" style="padding:16px 20px"><div class="lbl">R · PLANNED vs REALIZED</div><div class="num" style="font-size:20px;font-weight:600;margin-top:4px">2.5 <span style="color:var(--tx3);font-weight:400">/</span> 2.1</div><div style="font-size:12px;color:var(--tx3)">84% of plan</div></div><div class="card pad" style="padding:16px 20px"><div class="lbl">OPPORTUNITY COST</div><div class="num" style="font-size:20px;font-weight:600;margin-top:4px;color:#D9A85A">≈ +$216</div><div style="font-size:12px;color:var(--tx3)">price after exit: 1.0889</div></div></div>'''
    right=f'''<div class="card pad"><div class="row"><div><div style="font-size:24px;font-weight:600">EURUSD <span style="font-size:13px;color:#5FCB9E;font-weight:600;margin-left:6px">LONG</span></div><div style="font-size:13px;color:var(--tx3);margin-top:2px">28 Sep 2026 · 09:42 → 10:54 · New York · M15</div></div><div style="display:flex;gap:8px"><span class="badge g"><i></i>Gain</span></div></div><div style="height:14px"></div><div class="bigg num">+$412.00</div><div style="color:var(--tx2);font-size:13.5px;margin-top:2px">+2.1 R · net of $6.40 fees</div><div style="height:12px"></div>
<div class="kv2"><span>Entry → Exit</span><b class="num">1.0842 → 1.0871</b></div><div class="kv2"><span>Stop / Target (planned)</span><b class="num">1.0824 / 1.0888</b></div><div class="kv2"><span>Size · risk</span><b class="num">1.20 lots · 0.9%</b></div><div class="kv2"><span>Setup</span><b>Breakout NY · Trend</b></div></div>
<div class="card pad"><div class="sec" style="font-size:14px;margin-bottom:12px">Process</div><div class="row"><div class="f"><label>Execution quality</label><div class="dots"><i class="on"></i><i class="on"></i><i class="on"></i><i class="on"></i><i></i></div></div><div class="f"><label>Rating</label><div class="stars">★★★★<s>★</s></div></div><span class="badge g"><i></i>Plan followed</span></div><div style="height:14px"></div><div class="f"><label>Emotions</label><div class="tl"><span class="chp on">Calm</span><span class="ar">→</span><span class="chp on">Discipline</span><span class="ar">→</span><span class="chp on">Relief</span></div></div><div style="height:10px"></div><div class="ck"><span class="bx ok">✓</span>Checklist 5 / 5</div><div class="ck"><span class="bx ok">✓</span>Rules 4 / 5 respected</div></div>
<div class="card pad ai"><div class="row" style="margin-bottom:10px"><div class="sec" style="margin:0;font-size:14px">Screenshot review</div><span class="aitag">AI · OPTIONAL</span></div><p style="font-size:13.5px;line-height:1.6;color:var(--tx2)">Entry follows the retest of the Asian high, consistent with your thesis. The stop sits below the retest low as planned. Note: momentum was still strong at your target — consider partial exits.</p></div>
<div class="card pad"><div class="sec" style="font-size:14px;margin-bottom:8px">Compared with your Breakout NY trades</div><div class="kv2"><span>Average result</span><b class="num">+1.2 R</b></div><div class="kv2"><span>This trade</span><b class="num" style="color:#5FCB9E">+2.1 R</b></div><div class="kv2"><span>Percentile among 41 trades</span><b class="num">top 12%</b></div></div>'''
    content=f'''<div class="pg"><div class="pt"><div><h1>Trade #0928-07</h1><p>Review · previous / next by rating</p></div><div class="acts"><button class="btn ghost">‹ Previous</button><button class="btn ghost">Next ›</button><button class="btn ghost">Edit</button></div></div>
<div class="cols" style="grid-template-columns:8fr 4fr"><div class="col">{left}</div><div class="col">{right}</div></div></div>'''
    open(OUT+'screen-detail.html','w',encoding='utf-8').write(_shell('Trades','Trades',content,'Trade detail'))

def screen_behavior():
    rg=ring(78,210,17,'#4A5FD9','#8B7FE8','rgba(255,255,255,.08)','br','#F5F2EC','#9AA0C0',56)
    comp=''.join(f'<div class="row" style="padding:7px 0;font-size:13.5px"><span style="color:var(--tx2)">{a}</span><b class="num">{b}</b></div>' for a,b in [('Plan followed','86%'),('Rules respected','91%'),('Checklist completion','74%'),('Risk limit respected','69%')])
    emo=[('Calm',1420,74,'g'),('Discipline',980,68,'g'),('Doubt',210,52,'g'),('Stress',-340,41,'l'),('FOMO',-1180,33,'l'),('Revenge',-1620,22,'l')]
    mx=1700; eb=''
    for n,v,wr,k in emo:
        col='#5FCB9E' if v>0 else '#F0776B'; wpc=abs(v)/mx*50
        pos=f'left:50%;width:{wpc}%' if v>0 else f'right:50%;width:{wpc}%'
        eb+=f'<div class="hb"><span class="n">{n}</span><div class="tr"><i style="{pos};background:{col}"></i><i style="left:50%;width:1px;background:rgba(255,255,255,.25)"></i></div><span class="v num"><b style="color:{col}">{"+" if v>0 else "−"}${abs(v):,}</b> <span style="color:var(--tx3)">· {wr}% win</span></span></div>'
    mist=''.join(f'<div class="mist"><div class="c">{c}</div><div class="m">{n}<div style="font-size:12px;color:var(--tx3)">{c} trades · click to review</div></div><div class="p">−${p:,}</div></div>' for n,c,p in [('Revenge trade',9,1620),('Overtrading',14,1180),('Early exit',22,940),('Poor risk management',7,860),('No plan',5,410)])
    content=f'''<div class="pg"><div class="pt"><div><h1>Behavior</h1><p>What your process says about your results · last 3 months</p></div><div class="acts"><button class="btn ghost">Export report</button></div></div>
<div class="nt bad" style="padding:15px 18px;font-size:14px"><b>!</b><span><b>Overtrading risk today</b> — 3 losing trades in a row (limit 3). Your discipline score drops on average 11 points after this pattern.</span></div>
<div class="cols" style="grid-template-columns:repeat(12,1fr);grid-template-rows:1fr 1fr">
<section class="card pad" style="grid-column:span 4"><h3>Discipline score</h3><div class="center">{rg}</div><div style="margin-top:14px">{comp}</div></section>
<section class="card pad" style="grid-column:span 5"><h3>Emotion vs result</h3><div style="font-size:12.5px;color:var(--tx3);margin-bottom:8px">Net P&amp;L and win rate by emotion declared before the trade</div>{eb}</section>
<section class="card pad" style="grid-column:span 3"><h3>Streaks</h3><div class="kv2"><span>Current</span><b style="color:#F0776B">L3</b></div><div class="kv2"><span>Longest win streak</span><b style="color:#5FCB9E">W9</b></div><div class="kv2"><span>Longest loss streak</span><b style="color:#F0776B">L5</b></div><div class="kv2"><span>Avg after 2 losses</span><b>−0.4 R</b></div><div class="kv2"><span>Size change after a loss</span><b style="color:#D9A85A">+23%</b></div></section>
<section class="card pad" style="grid-column:span 4"><h3>In plan vs out of plan</h3><div class="cmp"><div><small>In plan · 155 trades</small><b style="color:#5FCB9E">+0.61 R</b><span>Win rate 64% · +$14,210</span></div><div><small>Out of plan · 25 trades</small><b style="color:#F0776B">−0.38 R</b><span>Win rate 28% · −$1,730</span></div></div><div class="nt warn" style="margin-top:14px"><b>i</b><span>Following your plan every time would have added about <b>$1,730</b>.</span></div></section>
<section class="card pad" style="grid-column:span 4"><h3>First trade vs the next ones</h3><div class="cmp"><div><small>First trade of the day</small><b>+0.52 R</b><span>Win rate 63% · discipline 88</span></div><div><small>Following trades</small><b>+0.21 R</b><span>Win rate 51% · discipline 74</span></div></div><div style="font-size:13px;color:var(--tx2);margin-top:14px;line-height:1.5">Your edge fades after the first trade of the day.</div></section>
<section class="card pad" style="grid-column:span 4"><h3>Recurring mistakes</h3>{mist}</section></div></div>'''
    open(OUT+'screen-behavior.html','w',encoding='utf-8').write(_shell('Behavior','Behavior',content,'Behavior'))

screen_form(); screen_detail(); screen_behavior()
