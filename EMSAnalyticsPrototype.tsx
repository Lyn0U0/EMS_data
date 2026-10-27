import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { Activity, AlertTriangle, Gauge, Zap, SlidersHorizontal, TrendingUp, Factory } from 'lucide-react';

/** Requires React, echarts, lucide-react and a host application with Tailwind CSS enabled. */
type Range = 'today' | 'week' | 'month';
type Mode = 'demand' | 'baseline' | 'contract';
type Sample = { time: number; actual: number; baseline: number; sigma: number };
type Event = { id: string; index: number; end: number; kind: '超約' | '警戒' | '湧浪' | '過耗'; advice: string };
const CONTRACT = 500;
const fmt = (n: number, digits = 0) => n.toLocaleString('zh-TW', { maximumFractionDigits: digits });
const timeLabel = (time: number) => new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(time);
const money = (n: number) => `NT$ ${fmt(n)}`;

export function generateMockData(range: Range): { samples: Sample[]; raw: Sample[]; step: number; days: number } {
  // Fixed UTC+8 calendar anchor makes mock data repeatable, including during SSR.
  const end = Date.UTC(2026, 6, 22, 16);
  const days = range === 'today' ? 1 : range === 'week' ? 7 : 30;
  const step = range === 'today' ? 15 : range === 'week' ? 60 : 1440;
  const raw: Sample[] = [];
  for (let i = 0; i < days * 96; i++) {
    const slot = i % 96, hour = slot / 4, day = Math.floor(i / 96);
    const baseline = hour < 6 ? 100 : hour < 8 ? 190 + (hour - 6) * 75 : hour < 12 ? 365 : hour < 16 ? 445 + 12 * Math.sin((hour - 12) / 4 * Math.PI) : hour < 18 ? 335 : hour < 20 ? 210 : 105;
    const noise = 5 * Math.sin(i * 2.13) + 4 * Math.cos(i * 0.71);
    let actual = baseline + noise + 5 * Math.sin(day * 1.7);
    if (slot === 15) actual = 380;
    if (hour >= 14 && hour < 15.5) actual = 521.5 + 6.5 * Math.sin(slot * 1.9);
    if (hour >= 10 && hour < 11) actual = baseline * 1.15 + noise * 0.2;
    raw.push({ time: end - days * 86400000 + i * 900000, actual, baseline, sigma: baseline * 0.055 });
  }
  const size = step / 15;
  const samples = Array.from({ length: raw.length / size }, (_, i) => {
    const bucket = raw.slice(i * size, (i + 1) * size);
    // Demand is a peak statistic: retain the coincident baseline at the maximum 15-minute demand.
    return bucket.reduce((a, b) => b.actual > a.actual ? b : a);
  });
  return { samples, raw, step, days };
}

function detectEvents(samples: Sample[], sensitivity: number, mode: Mode, capacity: number): Event[] {
  const events: Event[] = [];
  const threshold = mode === 'contract' ? capacity : CONTRACT;
  samples.forEach((p, index) => {
    const deviation = (p.actual - p.baseline) / p.sigma;
    let kind: Event['kind'] | undefined;
    if (mode === 'baseline') { if (deviation > sensitivity) kind = '過耗'; }
    else if (p.actual > threshold) kind = '超約';
    else if (deviation > sensitivity) kind = '湧浪';
    else if (p.actual > threshold * .9) kind = '警戒';
    if (!kind) return;
    const prev = events[events.length - 1];
    if (prev && prev.kind === kind && prev.end === index - 1) { prev.end = index; return; }
    events.push({ id: `${kind}-${p.time}`, index, end: index, kind, advice: kind === '超約' ? '錯開空調與製程啟動，檢查卸載策略。' : kind === '湧浪' ? '查核馬達啟動紀錄與非排程設備。' : kind === '過耗' ? '檢查空調設定、漏氣與設備空轉。' : '預先卸載非必要負載，保留需量裕度。' });
  });
  return events;
}

export default function EMSAnalyticsPrototype() {
  const [range, setRange] = useState<Range>('today');
  const [mode, setMode] = useState<Mode>('demand');
  const [sensitivity, setSensitivity] = useState(2);
  const [capacity, setCapacity] = useState(500);
  const [summer, setSummer] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const cards = useRef(new Map<string, HTMLButtonElement>());
  const zoom = useRef({ start: 0, end: 100 });
  const { samples, raw, step } = useMemo(() => generateMockData(range), [range]);
  const events = useMemo(() => detectEvents(samples, sensitivity, mode, capacity), [samples, sensitivity, mode, capacity]);
  const live = useRef({ samples, events });
  live.current = { samples, events };
  const peak = Math.max(...samples.map(p => p.actual));
  // Integrate native 15-minute data, never daily/hourly peak envelopes, for energy.
  const waste = raw.reduce((sum, p) => sum + (p.actual > p.baseline + sensitivity * p.sigma ? (p.actual - p.baseline) * .25 : 0), 0);
  const rate = summer ? 236.2 : 173.2; // Illustrative high-voltage two-period demand rates, NT$/kW-month.
  const excess = Math.max(0, peak - capacity);
  const basic = capacity * rate;
  const penalty = (Math.min(excess, capacity * .1) * 2 + Math.max(0, excess - capacity * .1) * 3) * rate;

  useEffect(() => {
    if (!chartRef.current) return;
    const instance = echarts.init(chartRef.current, 'dark');
    chart.current = instance;
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(chartRef.current);
    const click = (params: unknown) => {
      const p = params as { dataIndex?: number; data?: { eventId?: string }; componentType?: string };
      const state = live.current;
      const event = p.data?.eventId ? state.events.find(e => e.id === p.data?.eventId) : state.events.find(e => p.dataIndex !== undefined && p.dataIndex >= e.index && p.dataIndex <= e.end);
      if (event) {
        setSelected(event.id);
        cards.current.get(event.id)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        cards.current.get(event.id)?.focus({ preventScroll: true });
      }
    };
    const onZoom = (payload: unknown) => {
      const p = payload as { start?: number; end?: number; batch?: { start?: number; end?: number }[] };
      const z = p.batch?.[0] ?? p;
      if (z.start !== undefined && z.end !== undefined) zoom.current = { start: z.start, end: z.end };
    };
    instance.on('click', click);
    instance.on('datazoom', onZoom);
    return () => { observer.disconnect(); instance.off('click', click); instance.off('datazoom', onZoom); instance.dispose(); chart.current = null; };
  }, []);

  useEffect(() => { zoom.current = { start: 0, end: 100 }; setSelected(null); }, [range, mode]);
  useEffect(() => { if (selected && !events.some(e => e.id === selected)) setSelected(null); }, [events, selected]);

  useEffect(() => {
    const instance = chart.current;
    if (!instance) return;
    const cap = mode === 'contract' ? capacity : CONTRACT;
    const labels = samples.map(p => timeLabel(p.time));
    const areas = events.map(e => [
      { name: e.kind, xAxis: Math.max(0, e.index - .45), eventId: e.id, itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: e.kind === '超約' ? '#ef444435' : '#f59e0b28' }, { offset: 1, color: '#f59e0b04' }]) } },
      { xAxis: Math.min(samples.length - 1, e.end + .45) },
    ]);
    const series: echarts.SeriesOption[] = [];
    if (mode === 'baseline') series.push(
      { name: '下界', type: 'line', stack: 'band', data: samples.map(p => p.baseline - sensitivity * p.sigma), symbol: 'none', lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 }, silent: true },
      { name: '容許帶', type: 'line', stack: 'band', data: samples.map(p => 2 * sensitivity * p.sigma), symbol: 'none', lineStyle: { opacity: 0 }, areaStyle: { color: '#38bdf8', opacity: .12 }, silent: true },
      { name: '預期基線', type: 'line', data: samples.map(p => p.baseline), symbol: 'none', lineStyle: { color: '#94a3b8', type: 'dashed', width: 2 } },
    );
    series.push({ id: 'actual', name: '實際需量', type: 'line', smooth: .22, symbol: 'circle', symbolSize: 5, showSymbol: false, data: samples.map(p => +p.actual.toFixed(2)), lineStyle: { color: '#22d3ee', width: 2.5 }, itemStyle: { color: '#22d3ee' },
      markArea: { silent: false, label: { show: false }, data: areas as never },
      markLine: mode === 'baseline' ? undefined : { symbol: 'none', label: { position: 'insideEndTop', formatter: '{b}' }, data: [ { yAxis: cap, name: `契約容量 ${cap} kW`, lineStyle: { color: '#f87171', width: 3, type: 'dashed' } }, { yAxis: cap * .9, name: `90% 警戒 ${fmt(cap * .9)} kW`, lineStyle: { color: '#fbbf24', width: 1, type: 'dashed' } } ] },
    });
    series.push({ name: '異常事件', type: 'effectScatter', coordinateSystem: 'cartesian2d', symbol: 'diamond', symbolSize: 12, rippleEffect: { scale: 2.5 }, itemStyle: { color: '#fb923c' }, data: events.map(e => ({ value: [e.index, samples[e.index].actual], eventId: e.id })) });
    const option: echarts.EChartsOption = {
      backgroundColor: 'transparent', animationDurationUpdate: 350,
      grid: { left: 56, right: 28, top: 52, bottom: 84 },
      toolbox: { right: 20, iconStyle: { borderColor: '#94a3b8' }, feature: { dataZoom: { yAxisIndex: 'none', title: { zoom: '框選縮放', back: '還原縮放' } }, restore: { title: '重設視窗' } } },
      tooltip: { trigger: 'axis', confine: true, backgroundColor: '#0f172a', borderColor: '#334155', textStyle: { color: '#e2e8f0' }, formatter: (params: unknown) => {
        const items = (Array.isArray(params) ? params : [params]) as { dataIndex: number; seriesName: string }[];
        const item = items.find(p => p.seriesName === '實際需量') ?? items[0];
        const p = samples[item?.dataIndex]; if (!p) return '';
        const event = events.find(e => item.dataIndex >= e.index && item.dataIndex <= e.end);
        return `<div style="line-height:1.9;min-width:220px"><b>${timeLabel(p.time)}</b><br/>實際需量：<b>${fmt(p.actual, 1)} kW</b><br/>基線偏離：${fmt((p.actual / p.baseline - 1) * 100, 1)}%<br/>契約使用率：${fmt(p.actual / cap * 100, 1)}% (${cap} kW)<br/>診斷：${event ? `${event.kind} · ${event.advice}` : '運轉穩定，持續監測。'}</div>`;
      } },
      xAxis: { type: 'category', data: labels, boundaryGap: false, axisLabel: { color: '#94a3b8', hideOverlap: true }, axisLine: { lineStyle: { color: '#334155' } } },
      yAxis: { type: 'value', name: 'kW', min: 0, max: Math.max(650, peak + 40), splitLine: { lineStyle: { color: '#1e293b' } } },
      dataZoom: [{ type: 'inside', ...zoom.current, zoomOnMouseWheel: true }, { type: 'slider', ...zoom.current, bottom: 12, height: 26, borderColor: '#334155', fillerColor: '#22d3ee20' }], series,
    };
    instance.setOption(option, true);
  }, [samples, events, sensitivity, mode, capacity, peak]);

  const focusEvent = (event: Event) => {
    setSelected(event.id);
    const instance = chart.current; if (!instance) return;
    const count = samples.length;
    const left = zoom.current.start / 100 * (count - 1), right = zoom.current.end / 100 * (count - 1);
    if (event.index < left || event.index > right) {
      const radius = Math.max(1, Math.ceil(30 / step));
      const start = Math.max(0, event.index - radius), end = Math.min(count - 1, event.index + radius);
      zoom.current = { start: start / (count - 1) * 100, end: end / (count - 1) * 100 };
      instance.dispatchAction({ type: 'dataZoom', ...zoom.current });
    }
    const seriesIndex = mode === 'baseline' ? 3 : 0;
    instance.dispatchAction({ type: 'showTip', seriesIndex, dataIndex: event.index });
    instance.dispatchAction({ type: 'downplay', seriesIndex });
    instance.dispatchAction({ type: 'highlight', seriesIndex, dataIndex: event.index });
  };
  const modes: [Mode, string][] = [['demand', '需量超約監控'], ['baseline', '動態基線與能效偏差'], ['contract', '契約容量回測試算']];
  return <div className="min-h-screen bg-slate-950 p-4 text-slate-200 md:p-8">
    <div className="mx-auto max-w-[1600px] space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3"><div className="rounded-xl bg-cyan-400/10 p-3 text-cyan-400"><Factory size={25}/></div><div><p className="text-xs tracking-[.25em] text-cyan-400">ENERGY INTELLIGENCE / DEMO</p><h1 className="text-2xl font-semibold text-white">EMS 能源分析控制台</h1></div></div>
        <div className="flex rounded-xl border border-slate-800 bg-slate-900 p-1">{([['today', '今日 (15m)'], ['week', '近 7 日 (1h)'], ['month', '本月 (1d)']] as [Range, string][]).map(([key, label]) => <button key={key} onClick={() => setRange(key)} className={`rounded-lg px-3 py-2 text-sm ${range === key ? 'bg-cyan-400 text-slate-950' : 'text-slate-400 hover:text-white'}`}>{label}</button>)}</div>
      </header>
      <section className="flex flex-wrap items-center justify-between gap-5 rounded-xl border border-slate-800 bg-slate-900/70 p-4">
        <nav aria-label="分析模式" className="flex flex-wrap gap-2">{modes.map(([key, label]) => <button key={key} aria-pressed={mode === key} onClick={() => setMode(key)} className={`rounded-lg px-3 py-2 text-sm ${mode === key ? 'bg-slate-700 text-cyan-300' : 'text-slate-400 hover:bg-slate-800'}`}>{label}</button>)}</nav>
        <label className="flex items-center gap-3 text-sm"><SlidersHorizontal size={16} className="text-cyan-400"/>異常門檻 <input aria-label="異常標準差門檻" type="range" min="1.5" max="3" step="0.1" value={sensitivity} onChange={e => setSensitivity(+e.target.value)} className="w-28 accent-cyan-400"/><span className="w-10 font-mono text-cyan-300">{sensitivity.toFixed(1)}σ</span></label>
      </section>
      <div className="grid gap-4 sm:grid-cols-3">{[
        { label: '期間最大 15 分鐘需量', value: `${fmt(peak, 1)} kW`, icon: Gauge, note: `${samples.length} 個顯示點 · 原始 15m 峰值保留` },
        { label: '偵測事件', value: `${events.length} 件`, icon: AlertTriangle, note: `偏差門檻 ${sensitivity.toFixed(1)}σ · 連續同類事件合併` },
        { label: '估計超帶過耗電量', value: `${fmt(waste, 1)} kWh`, icon: TrendingUp, note: '以原始 15m 需量與動態基線積分' },
      ].map(c => <div key={c.label} className="rounded-xl border border-slate-800 bg-slate-900 p-5"><div className="flex justify-between text-sm text-slate-400">{c.label}<c.icon size={18} className="text-cyan-400"/></div><p className="my-2 text-3xl font-semibold tracking-tight text-white">{c.value}</p><p className="text-xs text-slate-500">{c.note}</p></div>)}</div>
      <main className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="min-w-0 rounded-xl border border-slate-800 bg-slate-900 p-4"><div className="flex items-center gap-2 text-sm font-medium"><Activity size={18} className="text-cyan-400"/>{modes.find(m => m[0] === mode)?.[1]}<span className="ml-auto text-xs text-slate-500">Asia/Taipei · 模擬資料</span></div><div ref={chartRef} role="img" aria-label="互動需量圖：可滾輪或工具列框選縮放，點選橘色異常事件與右側清單聯動" className="h-[440px] w-full md:h-[510px]"/><p className="text-xs text-slate-500">滾輪縮放 · 工具列框選 · 點擊橘色菱形或警示區域查看事件。小時／每日點保留區間最大 15m 需量；較粗粒度定位至少涵蓋前後一點。</p></section>
        <aside className="rounded-xl border border-slate-800 bg-slate-900 p-4"><h2 className="mb-4 flex items-center justify-between font-medium">異常事件 <span className="rounded bg-amber-500/10 px-2 py-1 text-xs text-amber-400">{events.length}</span></h2><div className="max-h-[515px] space-y-3 overflow-y-auto pr-1" aria-label="異常事件清單">{events.length === 0 && <p className="p-6 text-sm text-slate-400">目前門檻下沒有異常事件。</p>}{events.map(event => {
          const p = samples[event.index]; return <button key={event.id} ref={node => { if (node) cards.current.set(event.id, node); else cards.current.delete(event.id); }} onClick={() => focusEvent(event)} aria-pressed={selected === event.id} className={`w-full rounded-lg border p-3 text-left transition focus-visible:outline focus-visible:outline-cyan-400 ${selected === event.id ? 'border-cyan-400 bg-cyan-400/10' : 'border-slate-800 bg-slate-950/50 hover:border-slate-600'}`}><div className="flex justify-between gap-2 text-xs"><span className="text-slate-400">{timeLabel(p.time)}</span><span className={`rounded px-2 py-0.5 ${event.kind === '超約' ? 'bg-red-500/20 text-red-300' : 'bg-amber-500/15 text-amber-300'}`}>{event.kind}</span></div><div className="my-2 flex items-baseline justify-between"><strong className="text-lg text-white">{fmt(p.actual, 1)} <small className="font-normal text-slate-500">kW</small></strong><span className="text-xs text-orange-300">基線 +{fmt((p.actual / p.baseline - 1) * 100, 1)}%</span></div>{event.end > event.index && <p className="mb-1 text-xs text-slate-500">持續至 {timeLabel(samples[event.end].time)}</p>}<p className="text-xs leading-relaxed text-slate-400">{event.advice}</p></button>;
        })}</div></aside>
      </main>
      <section className="rounded-xl border border-slate-700 bg-gradient-to-br from-slate-900 to-slate-900/50 p-5">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 font-semibold"><Zap size={19} className="text-cyan-400"/>契約容量決策沙盒</h2><label className="flex items-center gap-2 text-sm text-slate-400"><input type="checkbox" checked={summer} onChange={e => setSummer(e.target.checked)} className="accent-cyan-400"/>夏月費率</label></div>
        <div className="grid items-center gap-6 md:grid-cols-4"><label className="space-y-3 text-sm text-slate-400">模擬契約容量 <strong className="float-right text-lg text-cyan-300">{capacity} kW</strong><input type="range" aria-label="模擬契約容量" min="400" max="600" step="1" value={capacity} onChange={e => setCapacity(+e.target.value)} className="w-full accent-cyan-400"/><span className="flex justify-between text-xs"><span>400 kW</span><span>600 kW</span></span></label>{[
          { label: '每月基本電費', value: basic, ratio: capacity / 600, color: 'bg-cyan-400' },
          { label: '超約加收估算', value: penalty, ratio: excess / (capacity * .2), color: 'bg-orange-400' },
          { label: '基本費＋超約加收', value: basic + penalty, ratio: (basic + penalty) / (600 * rate * 1.5), color: 'bg-violet-400' },
        ].map(item => <div key={item.label}><p className="text-xs text-slate-400">{item.label}</p><p className="my-2 text-2xl font-semibold text-white">{money(item.value)}</p><div className="h-1.5 overflow-hidden rounded bg-slate-800"><div className={`h-full transition-all ${item.color}`} style={{ width: `${Math.min(100, Math.max(0, item.ratio * 100))}%` }}/></div></div>)}</div>
        <p className="mt-5 text-xs leading-relaxed text-slate-500">試算假設：高壓二段式基本費率夏月 236.2／非夏月 173.2 元/kW·月；超約前 10% 按基本費率 2 倍、其餘 3 倍估算。使用所選期間峰值外推單月，未含流動電費、功率因數、稅與其他契約規則，非正式帳單或即時台電報價。正式需量固定以 500 kW 比較；回測模式依沙盒容量重算。</p>
      </section>
    </div>
  </div>;
}
