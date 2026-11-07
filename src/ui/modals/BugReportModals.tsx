// v0.16.1 "Report a bug": the list of reports (view, delete, Export all, Copy summary). v0.17.1 the form opens from the
// one corner button on every screen (ui/BugCorner.tsx) with the screenshot it took; storage and the file format:
// ui/bugReports.ts.

import { Bug, ClipboardCopy, Download, ImageOff, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fmtDateTime } from '../../engine/core/time';
import type { GameState, Ref } from '../../engine/core/types';
import { addReport, captureContext, exportFile, exportFileName, hasDurableStore, makeReport, reportStore, storageBytes, storageNote, summaryText, type BugContext, type BugPrefill, type BugReport, type BugReportMeta, type BugShot } from '../bugReports';
import { deviceNow } from '../device';
import { Modal } from '../components/ui';
import { store, useStore, type ModalSpec } from '../store';

/** The entity an open dialog is about (its offer, flight, aircraft, crew member, client...). Pure. */
export function modalRef(m: ModalSpec | null | undefined, g: GameState | null): Ref | undefined {
  if (!m) return undefined;
  const flight = (id: string | undefined): Ref | undefined => (id ? { kind: 'flight', id } : undefined);
  switch (m.kind) {
    case 'offer': case 'offerCall': return { kind: 'offer', id: m.offerId };
    case 'counterReply': return m.offerId ? { kind: 'offer', id: m.offerId } : m.contractId ? { kind: 'contract', id: m.contractId } : undefined;
    case 'decision': return { kind: 'decision', id: m.decisionId };
    case 'crewControl': case 'tripMove': return flight(m.flightId);
    case 'sheet': return m.refs[0] ?? (m.idle ? { kind: 'aircraft', id: m.idle.aircraftId } : undefined);
    case 'duty': {
      if (g?.flights[m.id]) return flight(m.id);
      const f = g ? Object.values(g.flights).find((x) => x.dutyId === m.id) : undefined;
      return f ? flight(f.id) : undefined;
    }
    case 'subcharter': return m.flightId ? flight(m.flightId) : m.flightIds?.length ? flight(m.flightIds[0]) : { kind: 'contract', id: m.contractId };
    case 'check': case 'refit': case 'lease': case 'sell': case 'delivered': case 'followDelivery': return { kind: 'aircraft', id: m.aircraftId };
    case 'livery': return m.target === 'company' ? undefined : { kind: 'aircraft', id: m.target.aircraftId };
    case 'train': case 'person': return { kind: 'crew', id: m.crewId };
    case 'acquire': case 'loi': return { kind: 'market', id: m.offerId };
    case 'client': return { kind: 'client', id: m.clientId };
    case 'rival': return { kind: 'rival', id: m.rivalId };
    case 'worldEvent': return { kind: 'event', id: m.eventId };
    case 'maintMove': return { kind: 'maint', id: m.maintId };
    case 'problem': return m.subject.ref;
    default: return undefined;
  }
}

/** What the corner button found: the open dialog and its subject, else the selection on the screen. Impure. */
export function prefillNow(): BugPrefill {
  const m = store.modal;
  const ref = modalRef(m, store.game) ?? store.nav.sel;
  return { ...(m ? { modal: m.kind } : {}), ...(ref ? { ref } : {}) };
}

/** The context as the app sees it now (the dialog and entity are in the prefill). Impure. */
export function contextNow(g: GameState | null, prefill?: BugPrefill): BugContext {
  const d = deviceNow();
  const { autoPause: _ap, hintsSeen: _h, screenHintsSeen: _s, screenHintsFolded: _f, scenarioBest: _b, ...settings } = store.settings as unknown as Record<string, unknown>;
  return captureContext(g, {
    tab: store.screen === 'game' ? store.nav.tab : store.screen, view: store.screen === 'game' ? store.nav.view : undefined, sel: store.screen === 'game' ? store.nav.sel : undefined,
    settings, device: { kind: d.kind, form: d.form, input: d.input, standalone: d.standalone },
    viewport: typeof window !== 'undefined' ? { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 } : undefined,
    ua: typeof navigator !== 'undefined' ? navigator.userAgent : '', theme: safeTheme(), hold: g?.autoHold ?? undefined,
  }, prefill);
}

function safeTheme(): string | undefined {
  try {
    return document.documentElement.dataset.theme || undefined;
  } catch {
    return undefined;
  }
}

/** Downloads a text file the way the save export does (works in the iPad home-screen app). */
function download(text: string, name: string, type = 'application/json') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const when = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** The report form: the screenshot the corner button took, a title, what happened and what was expected. */
export function BugForm({ shot, ctx, onClose }: { shot: BugShot | null; ctx: BugContext; onClose: () => void }) {
  const s = useStore();
  const g = s.game;
  const [title, setTitle] = useState('');
  const [what, setWhat] = useState('');
  const [expected, setExpected] = useState('');
  const [count, setCount] = useState<BugReportMeta[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    reportStore().list().then(setCount, () => setCount([]));
  }, []);
  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = makeReport(g, { title, what, expected }, ctx, Date.now(), shot);
      const list = await addReport(r);
      const note = storageNote(list);
      onClose();
      store.toast('good', 'Bug report saved', `${list.length} report${list.length === 1 ? '' : 's'} on this device. Menu › Bug reports to export.${note ? ` ${note}` : ''}`);
    } catch (e) {
      store.toast('bad', 'Could not save the report', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const note = count ? storageNote(count) : null;
  return (
    <Modal title="Report a bug" icon={<Bug className="accent" />} onClose={onClose} className="bug-modal" footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}><Bug /> Save report</button>
      </>
    }>
      <div className="bug-form">
        <div className="bug-top">
          {shot ? <img className="bug-thumb" src={shot.url} alt="Screenshot" /> : <div className="bug-thumb none"><ImageOff aria-hidden /><span>No screenshot</span></div>}
          <div className="bug-ctx">
            <span>{ctx.gameTime}{ctx.gameTimeLocal ? ` · ${ctx.gameTimeLocal}` : ''}</span>
            <span>{ctx.screen.tab}{ctx.screen.view ? ` › ${ctx.screen.view}` : ''}{ctx.screen.modal ? ` · ${ctx.screen.modal}` : ''}</span>
            {ctx.entity && <span><b>{ctx.entity.label}</b></span>}
            <span className="dim">{g ? 'Screenshot and game data are saved with it.' : 'Screenshot and device details are saved with it.'}</span>
          </div>
        </div>
        <label>Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={ctx.entity ? `e.g. ${ctx.entity.label}: …` : 'e.g. Crew alarm on a legal flight'} maxLength={120} />
        </label>
        <label>What happened
          <textarea value={what} onChange={(e) => setWhat(e.target.value)} placeholder="What you saw" maxLength={4000} />
        </label>
        <label>What you expected
          <textarea value={expected} onChange={(e) => setExpected(e.target.value)} placeholder="What should have happened" maxLength={4000} />
        </label>
        {!hasDurableStore() && <div className="small warn">This browser can't keep reports: they last until the page closes. Export them soon.</div>}
        {note && <div className="small warn">{note}</div>}
        {count && count.length > 0 && <div className="tiny dim">{count.length} report{count.length === 1 ? '' : 's'} saved on this device.</div>}
      </div>
    </Modal>
  );
}

export function BugReportsModal() {
  const s = useStore();
  const g = s.game;
  const [list, setList] = useState<BugReportMeta[] | null>(null);
  const [open, setOpen] = useState<BugReport | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => reportStore().list().then(setList, (e: Error) => { setList([]); store.toast('bad', 'Could not read the reports', e.message); });
  useEffect(() => void refresh(), []);
  const close = () => store.closeModal();
  const view = async (id: string) => {
    const r = await reportStore().get(id);
    if (r) setOpen(r);
  };
  const del = (r: BugReportMeta) => {
    store.openModal({ kind: 'confirm', title: 'Delete this report?', confirm: 'Delete', danger: true, body: `"${r.title}" and its snapshot will be deleted. This cannot be undone.`, onConfirm: async () => {
      await reportStore().remove(r.id);
      store.openModal({ kind: 'bugReports' });
    } });
  };
  const exportAll = async () => {
    if (!list?.length || busy) return;
    setBusy(true);
    try {
      const full: BugReport[] = [];
      for (const m of list) {
        const r = await reportStore().get(m.id);
        if (r) full.push(r);
      }
      download(exportFile(full, g), exportFileName(g?.company.name));
      store.toast('good', 'Bug reports exported', `${full.length} report${full.length === 1 ? '' : 's'}${g ? ' and the current save' : ''} in one file.`);
    } catch (e) {
      store.toast('bad', 'Export failed', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    if (!list?.length) return;
    try {
      await navigator.clipboard.writeText(summaryText(list));
      store.toast('good', 'Summary copied', 'A text of every report is on the clipboard.');
    } catch {
      store.toast('bad', 'Could not copy', 'The clipboard is not available here. Export the file instead.');
    }
  };
  const note = list ? storageNote(list) : null;
  if (open) {
    const c = open.context;
    return (
      <Modal title={open.title} icon={<Bug className="accent" />} onClose={close} footer={
        <>
          <button className="btn" onClick={() => setOpen(null)}>Back</button>
          <button className="btn danger" onClick={() => { setOpen(null); del(open); }}><Trash2 /> Delete</button>
        </>
      }>
        <div className="bug-view">
          <div className="small muted">Written {when(open.createdAt)} · game {c.gameTime}{c.gameTimeLocal ? ` · ${c.gameTimeLocal}` : ''} · {c.version}</div>
          {open.shot ? <img className="bug-shot" src={open.shot} alt="Screenshot" /> : <div className="small dim">No screenshot</div>}
          {open.what && <div><b className="small">What happened</b><div>{open.what}</div></div>}
          {open.expected && <div><b className="small">Expected</b><div>{open.expected}</div></div>}
          <div className="small muted">Screen {c.screen.tab}{c.screen.view ? ` › ${c.screen.view}` : ''}{c.screen.modal ? ` · dialog ${c.screen.modal}` : ''}{c.screen.sel ? ` · ${c.screen.sel.kind} ${c.screen.sel.id}` : ''}</div>
          {c.entity && <pre>{[c.entity.label, ...c.entity.lines].join('\n')}</pre>}
          {c.inbox.length > 0 && <pre>{c.inbox.join('\n')}</pre>}
          <div className="tiny dim">{open.size ? `Snapshot ${Math.round((open.size * 2) / 1024)} KB` : 'No game snapshot'}{open.shotBytes ? ` · screenshot ${Math.round(open.shotBytes / 1024)} KB` : ''} · {[c.device.kind, c.device.form, c.device.standalone ? 'home-screen app' : '', c.device.viewport].filter(Boolean).join(' · ')}</div>
        </div>
      </Modal>
    );
  }
  return (
    <Modal title="Bug reports" icon={<Bug className="accent" />} onClose={close} footer={
      <>
        <span className="small dim grow">{list ? `${list.length} report${list.length === 1 ? '' : 's'} · ${Math.round(storageBytes(list) / 1024 / 1024 * 10) / 10} MB` : ''}</span>
        <button className="btn" onClick={copy} disabled={!list?.length}><ClipboardCopy /> Copy summary</button>
        <button className="btn btn-primary" onClick={exportAll} disabled={!list?.length || busy}><Download /> Export all</button>
      </>
    }>
      <div className="col gap-12">
        <div className="small muted">Each report keeps a screenshot and the game at that moment. Export all writes one file with every report and your current save.</div>
        {note && <div className="small warn">{note}</div>}
        {list && list.length === 0 && <div className="small dim">No reports yet. To report a bug, tap the small bug button in the lower left corner.</div>}
        <div className="bug-list">
          {(list ?? []).map((r) => (
            <div key={r.id} className="bug-row">
              <button className="bug-row-main" onClick={() => view(r.id)}>
                <b className="ellipsis">{r.title}</b>
                <div className="small muted ellipsis">{when(r.createdAt)} · game {r.context.gameTime}{r.context.entity ? ` · ${r.context.entity.label}` : ''} · {r.context.screen.tab}</div>
              </button>
              <button className="btn btn-ghost btn-icon" onClick={() => del(r)} aria-label={`Delete report ${r.title}`}><Trash2 /></button>
            </div>
          ))}
        </div>
        <div className="tiny dim">Game time {g ? fmtDateTime(g.now) : '—'} UTC. Reports are kept on this device only.</div>
      </div>
    </Modal>
  );
}
