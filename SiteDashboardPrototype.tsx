import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { Activity, ArrowRight, Bell, Check, ChevronDown, Clock3, Factory, Fan, Gauge, Maximize2, Minimize2, Radio, ShieldCheck, Thermometer, Wind, X, Zap } from 'lucide-react';

/** Standalone component. Host app must enable Tailwind CSS. All telemetry and tariffs are simulated. */
type Sample = { today: number | null; yesterday: number; time: string };
type Alarm = { id: string; index: number; severity: 'Critical' | 'Warning' | 'Info'; title: string; detail: string; device: string; advice: string };
type Site = { name: string; capacity: number; factor: number };
const SITES: Site[] = [{ name: '台南二廠 - 主廠區', capacity: 500, factor: 1 }, { name: '台南二廠 - 加工區', capacity: 400, factor: .78 }];
const number = (n: number, digits = 1) => n.toLocaleString('zh-TW', { maximumFractionDigits: digits, minimumFractionDigits: digits });
const clock = (date: Date) => new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date);
const minutesInTaipei = (date: Date) => { const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date); return Number(parts.find(p => p.type === 'hour')?.value) * 60 + Number(parts.find(p => p.type === 'minute')?.value); };
const timeAt = (i: number) => `${String(Math.floor(i / 4)).padStart(2, '0')}:${String(i % 4 * 15).padStart(2, '0')}`;
function waveform(i: number) {
  const h = i / 4;
  const anchors = [[0, 120], [6, 118], [7, 180], [8.5, 380], [11, 395], [12, 350], [14, 468], [15.5, 451], [17.5, 380], [19, 190], [21, 123], [24, 120]];
  const k = anchors.findIndex((a, j) => j < anchors.length - 1 && h >= a[0] && h < anchors[j + 1][0]);
  const a = anchors[Math.max(0, k)], b = anchors[Math.max(0, k) + 1];
  return a[1] + (b[1] - a[1]) * (h - a[0]) / (b[0] - a[0]) + 3 * Math.sin(i * 1.7) + 2 * Math.cos(i * .8);
}
export function generateSiteData(now: Date, site: Site, tick = 0): Sample[] {
  const last = Math.floor(minutesInTaipei(now) / 15);
  return Array.from({ length: 96 }, (_, i) => ({ time: timeAt(i), today: i <= last ? (waveform(i) + (i === last ? Math.sin(tick * .8) * 1.8 : 0)) * site.factor : null, yesterday: (waveform(i) * .942 + 4 * Math.sin(i * .4)) * site.factor }));
}
function useNativeChart(ref: React.RefObject<HTMLDivElement | null>, option: echarts.EChartsOption) {
  const instance = useRef<echarts.ECharts | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, 'dark'); instance.current = chart;
    const observer = new ResizeObserver(() => chart.resize()); observer.observe(ref.current);
    return () => { observer.disconnect(); chart.dispose(); instance.current = null; };
  }, [ref]);
  useEffect(() => { instance.current?.setOption(option, true); }, [option]);
  return instance;
}
function Sparkline({ values, color }: { values: number[]; color: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const option = useMemo<echarts.EChartsOption>(() => ({ backgroundColor: 'transparent', animationDurationUpdate: 450, grid: { left: 0, right: 0, top: 4, bottom: 0 }, xAxis: { type: 'category', show: false, data: values.map((_, i) => i) }, yAxis: { type: 'value', show: false, scale: true }, series: [{ type: 'line', data: values, smooth: true, symbol: 'none', lineStyle: { color, width: 2 }, areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: `${color}35` }, { offset: 1, color: `${color}00` }]) } }] }), [values, color]);
  useNativeChart(ref, option);
  return <div ref={ref} className="h-12 w-full" role="img" aria-label="最近兩小時設備功率趨勢"/>;
}
const panel = 'rounded-2xl border border-slate-800 bg-slate-900/80 backdrop-blur-sm';
const badge: Record<Alarm['severity'], string> = { Critical: 'border-red-500/30 bg-red-500/10 text-red-400', Warning: 'border-amber-500/30 bg-amber-500/10 text-amber-400', Info: 'border-blue-500/30 bg-blue-500/10 text-blue-400' };

export default function SiteDashboardPrototype() {
  const root = useRef<HTMLDivElement>(null), chartRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());
  const [tick, setTick] = useState(0), [siteIndex, setSiteIndex] = useState(0);
  const [warRoom, setWarRoom] = useState(false), [fullscreen, setFullscreen] = useState(false);
  const [active, setActive] = useState<Alarm | null>(null), [acknowledged, setAcknowledged] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const site = SITES[siteIndex];
  useEffect(() => { const timer = window.setInterval(() => { setNow(new Date()); setTick(t => t + 1); }, 10000); return () => clearInterval(timer); }, []);
  useEffect(() => { const handler = () => setFullscreen(!!document.fullscreenElement); document.addEventListener('fullscreenchange', handler); return () => document.removeEventListener('fullscreenchange', handler); }, []);
  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement as HTMLElement | null;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActive(null);
      if (e.key !== 'Tab') return;
      const buttons = root.current?.querySelectorAll<HTMLButtonElement>('[role="dialog"] button');
      if (!buttons?.length) return;
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handler);
    return () => { document.removeEventListener('keydown', handler); previous?.focus(); };
  }, [active]);
  const data = useMemo(() => generateSiteData(now, site, tick), [now, site, tick]);
  const currentIndex = Math.floor(minutesInTaipei(now) / 15), current = data[currentIndex].today ?? 0;
  const margin = site.capacity - current, warning = site.capacity * .9;
  const elapsed = (minutesInTaipei(now) % 15) / 60;
  const todayEnergy = data.reduce((sum, p, i) => sum + (p.today ?? 0) * (i < currentIndex ? .25 : i === currentIndex ? elapsed : 0), 0);
  const yesterdayEnergy = data.reduce((sum, p, i) => sum + p.yesterday * (i < currentIndex ? .25 : i === currentIndex ? elapsed : 0), 0);
  const energy = [0, 0, 0];
  data.forEach((p, i) => { const h = i / 4, type = h >= 13 && h < 17 ? 0 : h >= 8 && h < 22 ? 1 : 2; energy[type] += (p.today ?? 0) * (i < currentIndex ? .25 : i === currentIndex ? elapsed : 0); });
  const cost = energy[0] * 6.8 + energy[1] * 4.3 + energy[2] * 2.1;
  const alarms = useMemo<Alarm[]>(() => {
    const peakIndex = data.slice(0, currentIndex + 1).reduce((best, p, i) => (p.today ?? 0) > (data[best].today ?? 0) ? i : best, 0);
    const peak = data[peakIndex].today ?? 0;
    const first: Alarm = peak > warning ? { id: `${siteIndex}-demand`, index: peakIndex, severity: 'Warning', title: `需量達 ${number(peak / site.capacity * 100, 0)}% 警戒臨界`, detail: `15 分鐘需量 ${number(peak)} kW，已進入契約容量警戒帶。`, device: '總盤 MDP-01', advice: '確認冰機排程；延後空壓機或非必要製程的同步啟動。' } : { id: `${siteIndex}-demand`, index: currentIndex, severity: 'Info', title: '需量監控正常・安全裕度充足', detail: `目前契約使用率 ${number(current / site.capacity * 100)}%，未達警戒線。`, device: '總盤 MDP-01', advice: '持續追蹤負載爬升與排程，預留設備啟動裕度。' };
    return [first, { id: `${siteIndex}-chiller`, index: Math.max(0, currentIndex - 1), severity: 'Critical', title: '冰機 #2 瞬間湧浪', detail: '設備啟動電流達額定 2.8 倍，持續 1.2 秒；15 分鐘需量未超約。', device: '空調系統 CH-02', advice: '檢查軟啟動器、接觸器與啟動順序；比對設備高頻電流紀錄。' }, { id: `${siteIndex}-pf`, index: Math.max(0, currentIndex - 3), severity: 'Info', title: '功因補償完成・電能品質穩定', detail: '電容器組投入後功率因數回復至 99.2%，無持續異常。', device: '補償盤 CAP-01', advice: '確認電容器組投切紀錄，持續觀測諧波與功因。' }].sort((a, b) => b.index - a.index) as Alarm[];
  }, [data, currentIndex, siteIndex, current, site.capacity, warning]);
  const chartOption = useMemo<echarts.EChartsOption>(() => {
    const zones: { start: number; end: number }[] = [];
    data.forEach((p, i) => { if (p.today !== null && p.today > warning) { const last = zones[zones.length - 1]; if (last && last.end === i - 1) last.end = i; else zones.push({ start: i, end: i }); } });
    return { backgroundColor: 'transparent', animationDurationUpdate: 600, grid: { top: 32, bottom: 30, left: 47, right: 30 },
      tooltip: { trigger: 'axis', confine: true, backgroundColor: '#0f172a', borderColor: '#334155', textStyle: { color: '#e2e8f0' }, axisPointer: { type: 'line', lineStyle: { color: '#60a5fa', type: 'dashed' } }, formatter: (params: unknown) => {
        const list = (Array.isArray(params) ? params : [params]) as { dataIndex: number }[]; const p = data[list[0]?.dataIndex]; if (!p) return '';
        return `<div style="line-height:1.9;min-width:205px"><b>${p.time} · Asia/Taipei</b><br/>今日需量：${p.today === null ? '尚未發生' : `${number(p.today)} kW`}<br/>昨日需量：${number(p.yesterday)} kW<br/>差異量：${p.today === null ? '—' : `${p.today >= p.yesterday ? '+' : ''}${number(p.today - p.yesterday)} kW`}<br/>契約容量：${site.capacity} kW<br/>契約使用率：${p.today === null ? '—' : `${number(p.today / site.capacity * 100)}%`}</div>`;
      } },
      xAxis: { type: 'category', boundaryGap: false, data: [...data.map(p => p.time), '24:00'], axisLine: { lineStyle: { color: '#334155' } }, axisTick: { show: false }, axisLabel: { color: '#64748b', interval: 15, showMaxLabel: true, fontSize: 10 } },
      yAxis: { type: 'value', min: 0, max: site.capacity * 1.2, name: 'kW', nameTextStyle: { color: '#64748b', fontSize: 10 }, axisLabel: { color: '#64748b', fontSize: 10 }, splitLine: { lineStyle: { color: '#1e293b', type: 'dashed' } } },
      series: [
        { name: '昨日需量', type: 'line', data: [...data.map(p => p.yesterday), null], symbol: 'none', lineStyle: { color: '#64748b', width: 1.3, type: 'dashed' }, silent: false },
        { name: '今日需量', type: 'line', step: 'end', data: [...data.map(p => p.today), null], connectNulls: false, symbol: 'none', lineStyle: { color: '#3b82f6', width: 2.5 }, areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: '#3b82f630' }, { offset: 1, color: '#3b82f600' }]) },
          markLine: { symbol: 'none', silent: true, label: { fontSize: 10, position: 'insideEndTop' }, data: [{ yAxis: site.capacity, lineStyle: { color: '#ef4444', width: 2.5, type: 'dashed' }, label: { formatter: `契約 ${site.capacity} kW`, color: '#f87171' } }, { yAxis: warning, lineStyle: { color: '#f59e0b', width: 1, type: 'dashed' }, label: { formatter: `警戒 ${warning} kW`, color: '#fbbf24' } }, { xAxis: minutesInTaipei(now) / 15, lineStyle: { color: '#3b82f6', width: 1.5, type: 'dashed' }, label: { formatter: `現在 ${clock(now).slice(0, 5)}`, position: 'insideStartTop', color: '#60a5fa' } }] },
          markArea: { silent: true, label: { show: false }, itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: '#ef444425' }, { offset: 1, color: '#f59e0b08' }]) }, data: zones.map(z => [{ xAxis: Math.max(0, z.start - .5) }, { xAxis: Math.min(96, z.end + .5) }]) },
        },
      ],
    };
  }, [data, now, site.capacity, warning]);
  const chart = useNativeChart(chartRef, chartOption);
  const showAlarm = (alarm: Alarm) => { chart.current?.dispatchAction({ type: 'showTip', seriesIndex: 1, dataIndex: alarm.index }); chart.current?.dispatchAction({ type: 'updateAxisPointer', xAxisIndex: 0, value: alarm.index }); };
  const hideAlarm = () => { chart.current?.dispatchAction({ type: 'hideTip' }); chart.current?.dispatchAction({ type: 'updateAxisPointer', currTrigger: 'leave' }); };
  const toggleFullscreen = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await root.current?.requestFullscreen(); setMessage(''); } catch { setWarRoom(v => !v); setMessage('瀏覽器未允許全螢幕，已切換戰情檢視。'); } };
  const subsystems = [{ name: '空調系統', english: 'HVAC SYSTEM', share: .46, icon: Fan, color: '#3b82f6', metric: '冰水供水溫度', value: '7.2 °C' }, { name: '空壓動力系統', english: 'COMPRESSED AIR', share: .24, icon: Wind, color: '#10b981', metric: '主管壓力', value: '6.8 bar' }, { name: '生產設備與公用', english: 'PRODUCTION & UTILITY', share: .30, icon: Factory, color: '#a78bfa', metric: '設備稼動率', value: '86.5 %' }];
  return <div ref={root} className={`min-h-screen bg-slate-950 text-slate-200 ${warRoom ? 'p-5' : 'p-4 xl:p-6'} font-sans`}>
    <div className="mx-auto flex max-w-[1800px] flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div className="flex flex-wrap items-center gap-4"><div className="flex h-11 w-11 items-center justify-center rounded-xl border border-blue-500/30 bg-blue-500/10 text-blue-400"><Zap size={24}/></div><div><p className="mb-1 text-[10px] tracking-[.24em] text-slate-500">EMS / SITE OPERATIONS CENTER</p><label className="relative flex items-center"><select aria-label="案場切換" value={siteIndex} onChange={e => { setSiteIndex(+e.target.value); setActive(null); setAcknowledged([]); }} className="appearance-none bg-transparent pr-7 text-lg font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-blue-400">{SITES.map((s, i) => <option className="bg-slate-900" value={i} key={s.name}>{s.name}</option>)}</select><ChevronDown size={16} className="pointer-events-none absolute right-0 text-slate-500"/></label></div><span className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-400">契約容量 <b className="ml-1 text-slate-200">{site.capacity} kW</b></span></div>
        <div className="flex flex-wrap items-center gap-4 text-xs"><div><p className="flex items-center gap-2 text-emerald-400"><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60"/><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400"/></span>模擬連線中・10s 輪詢</p><p className="mt-1 text-right font-mono text-slate-500">最後更新 {clock(now)} UTC+8</p></div><button onClick={() => setWarRoom(v => !v)} aria-pressed={warRoom} className={`rounded-lg border px-3 py-2 ${warRoom ? 'border-blue-500 text-blue-400' : 'border-slate-700 text-slate-400'}`}>戰情模式</button><button onClick={toggleFullscreen} aria-label={fullscreen ? '離開全螢幕' : '進入全螢幕'} className="rounded-lg border border-slate-700 p-2 text-slate-400 hover:text-white">{fullscreen ? <Minimize2 size={17}/> : <Maximize2 size={17}/>}</button></div>
      </header>
      {message && <p role="status" className="text-xs text-amber-400">{message}</p>}
      <section aria-label="核心指標" className="grid grid-cols-12 gap-4">
        <article className={`${panel} col-span-12 p-5 md:col-span-4`}><h2 className="flex items-center gap-2 text-sm text-slate-300"><Gauge size={16} className="text-blue-400"/>需量安全儀表<span className="ml-auto text-[10px] text-slate-500">15 MIN AVG</span></h2><div className="mt-3 flex items-center gap-4"><div className="relative h-28 w-40 shrink-0"><svg viewBox="0 0 180 110" className="h-full w-full" role="img" aria-label={`契約容量使用率 ${number(current / site.capacity * 100)}%`}><path d="M 20 90 A 70 70 0 0 1 160 90" fill="none" stroke="#1e293b" strokeWidth="12" strokeLinecap="round"/><path d="M 20 90 A 70 70 0 0 1 160 90" fill="none" stroke={current > site.capacity ? '#ef4444' : current > warning ? '#f59e0b' : '#3b82f6'} strokeWidth="12" strokeLinecap="round" pathLength="100" strokeDasharray={`${Math.min(100, current / site.capacity * 100)} 100`}/><path d="M 155 68 L 167 65" stroke="#f59e0b" strokeWidth="3"/><text x="90" y="76" textAnchor="middle" fill="white" fontSize="27" fontWeight="600">{number(current)}</text><text x="90" y="96" textAnchor="middle" fill="#64748b" fontSize="10">kW · 當前區間估測</text></svg></div><div><p className="text-xs text-slate-400">{margin >= 0 ? '尚餘安全裕度' : '已超契約容量'}</p><p className={`mt-1 text-3xl font-semibold ${margin < 0 ? 'text-red-400' : margin < site.capacity * .1 ? 'text-amber-400' : 'text-emerald-400'}`}>{number(Math.abs(margin))}<span className="ml-1 text-sm font-normal">kW</span></p><p className="mt-2 text-[11px] text-slate-500">警戒 {warning} / 契約 {site.capacity}</p></div></div></article>
        <article className={`${panel} col-span-12 p-5 md:col-span-4`}><h2 className="flex items-center gap-2 text-sm text-slate-300"><Zap size={16} className="text-amber-400"/>今日累計電費與用電</h2><div className="mt-4 flex items-end justify-between gap-3"><div><p className="text-3xl font-semibold text-white">{number(todayEnergy, 0)}<span className="ml-1 text-xs font-normal text-slate-500">kWh</span></p><p className="mt-1 text-xs text-slate-400">預估 NT$ <b className="text-slate-200">{number(cost, 0)}</b></p></div><p className="text-xs text-amber-400">{yesterdayEnergy ? `+${number((todayEnergy / yesterdayEnergy - 1) * 100)}%` : '—'}<span className="mt-1 block text-[10px] text-slate-500">較昨日同期</span></p></div><div className="mt-4 flex h-2 overflow-hidden rounded-full bg-slate-800">{energy.map((e, i) => <div key={i} style={{ width: `${todayEnergy ? e / todayEnergy * 100 : 0}%`, background: ['#3b82f6', '#06b6d4', '#475569'][i] }}/>)}</div><div className="mt-2 flex justify-between text-[10px] text-slate-400">{['尖峰', '半尖峰', '離峰'].map((label, i) => <span key={label}>{label} {todayEnergy ? number(energy[i] / todayEnergy * 100, 0) : 0}%</span>)}</div></article>
        <article className={`${panel} col-span-12 p-5 md:col-span-4`}><h2 className="flex items-center gap-2 text-sm text-slate-300"><ShieldCheck size={16} className="text-emerald-400"/>電能品質即時健康度<span className="ml-auto rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-400">良好</span></h2><div className="mt-4 space-y-3">{[['功率因數', '99.2', '%'], ['三相電壓不平衡率', '0.8', '%'], ['系統頻率', '60.0', 'Hz']].map(([label, value, unit]) => <div key={label} className="flex items-center justify-between text-xs"><span className="text-slate-400">{label}</span><span className="flex items-center gap-2"><b className="font-mono text-lg font-medium text-slate-100">{value}<small className="ml-1 text-xs font-normal text-slate-500">{unit}</small></b><span className="h-1.5 w-1.5 rounded-full bg-emerald-400"/></span></div>)}</div></article>
      </section>
      <section className="grid grid-cols-12 gap-4">
        <article className={`${panel} col-span-12 min-w-0 p-5 lg:col-span-8`}><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="flex items-center gap-2 text-sm font-medium"><Activity size={16} className="text-blue-400"/>今日即時負載步進曲線</h2><div className="flex gap-4 text-[10px] text-slate-400"><span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-blue-500"/>今日需量</span><span className="flex items-center gap-1.5"><span className="w-4 border-t border-dashed border-slate-500"/>昨日需量</span></div></div><div ref={chartRef} role="img" aria-label="全天 00:00 至 24:00 即時負載曲線，未來今日資料留白" className={`mt-2 w-full ${warRoom ? 'h-[39vh] min-h-64' : 'h-[32vh] min-h-[250px] max-h-[365px]'}`}/><div className="flex items-center justify-between border-t border-slate-800 pt-3 text-[10px] text-slate-500"><span className="flex items-center gap-1.5"><Clock3 size={11}/>15 分鐘需量 · 游標比對昨日同期</span><span>懸浮告警可定位時間點</span></div></article>
        <article className={`${panel} col-span-12 flex min-h-0 flex-col p-5 lg:col-span-4`}><h2 className="mb-3 flex items-center gap-2 text-sm font-medium"><Bell size={16} className="text-amber-400"/>即時告警事件流<span className="ml-auto rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">{alarms.length} 事件</span></h2><div className={`space-y-2.5 overflow-y-auto pr-1 ${warRoom ? 'max-h-[42vh]' : 'max-h-[35vh] min-h-[265px]'}`}>{alarms.map(alarm => <div key={alarm.id} tabIndex={0} onMouseEnter={() => showAlarm(alarm)} onMouseLeave={hideAlarm} onFocus={() => showAlarm(alarm)} onBlur={hideAlarm} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 outline-none transition hover:border-slate-600 focus-visible:border-blue-500"><div className="flex items-center justify-between"><span className={`rounded border px-1.5 py-0.5 text-[9px] font-medium ${badge[alarm.severity]}`}>{alarm.severity}</span><span className="font-mono text-[10px] text-slate-500">{data[alarm.index].time}</span></div><p className="mt-2 text-xs font-medium text-slate-200">{alarm.title}</p><div className="mt-2 flex items-center justify-between"><span className="text-[10px] text-slate-500">{acknowledged.includes(alarm.id) ? '已確認・持續觀察' : alarm.device}</span><button onClick={() => setActive(alarm)} className="flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300" aria-label={`排查 ${alarm.title}`}>排查 <ArrowRight size={12}/></button></div></div>)}</div></article>
      </section>
      <section className={`${panel} p-4`}><div className="mb-3 flex items-center justify-between"><h2 className="flex items-center gap-2 text-xs font-medium"><Factory size={15} className="text-slate-400"/>設備分項能耗拓撲</h2><span className="text-[10px] text-slate-500">總盤 → 分項設備 · 最近 2 小時</span></div><div className="grid grid-cols-12 gap-4">{subsystems.map(system => <article key={system.name} className="col-span-12 min-w-0 rounded-xl border border-slate-800 bg-slate-950/40 p-3 md:col-span-4"><div className="flex items-center justify-between"><span className="flex items-center gap-2 text-xs"><system.icon size={15} style={{ color: system.color }}/>{system.name}</span><span className="text-[10px] text-slate-500">全廠 {system.share * 100}%</span></div><div className="mt-2 flex items-end justify-between"><p className="text-2xl font-semibold text-white">{number(current * system.share)}<span className="ml-1 text-xs font-normal text-slate-500">kW</span></p><div className="text-right text-[10px] text-slate-500">{system.metric}<p className="mt-1 text-xs text-slate-300">{system.value}</p></div></div><Sparkline color={system.color} values={Array.from({ length: 9 }, (_, i) => (currentIndex - 8 + i >= 0 ? (data[currentIndex - 8 + i].today ?? 0) : data[(currentIndex - 8 + i + 96) % 96].yesterday) * system.share)}/></article>)}</div></section>
      <footer className="flex flex-wrap justify-between gap-1 text-[10px] text-slate-600"><span className="flex items-center gap-1"><Radio size={10}/>展示資料・非實際設備連線・Asia/Taipei</span><span>費率示意：尖峰 6.8 / 半尖峰 4.3 / 離峰 2.1 元/kWh，未含基本費與稅</span></footer>
    </div>
    {active && <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/70 backdrop-blur-sm" onClick={() => setActive(null)}><section role="dialog" aria-modal="true" aria-label="告警排查" className="flex h-full w-full max-w-md flex-col border-l border-slate-700 bg-slate-900 p-6 shadow-2xl" onClick={e => e.stopPropagation()}><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">告警排查</h2><button autoFocus aria-label="關閉排查" onClick={() => setActive(null)} className="rounded p-2 hover:bg-slate-800"><X size={20}/></button></div><span className={`mt-8 w-fit rounded border px-2 py-1 text-xs ${badge[active.severity]}`}>{active.severity}</span><h3 className="mt-4 text-xl font-semibold text-white">{active.title}</h3><p className="mt-2 text-xs text-slate-500">{site.name} / {active.device} / {data[active.index].time}</p><p className="mt-6 text-sm leading-7 text-slate-300">{active.detail}</p><div className="mt-6 rounded-xl border border-blue-500/20 bg-blue-500/5 p-4"><p className="mb-2 flex items-center gap-2 text-sm text-blue-400"><Thermometer size={16}/>建議排查程序</p><p className="text-sm leading-7 text-slate-400">{active.advice}</p></div><p className="mt-4 text-xs leading-6 text-slate-500">模擬除錯抽屜；確認僅更新本次畫面，不會操作任何實體設備。</p><button onClick={() => { setAcknowledged(ids => [...new Set([...ids, active.id])]); setActive(null); }} className="mt-auto flex items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm text-white hover:bg-blue-500"><Check size={16}/>確認並持續觀察</button></section></div>}
  </div>;
}
