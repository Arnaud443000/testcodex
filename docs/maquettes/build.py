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
