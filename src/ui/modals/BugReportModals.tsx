// v0.16.1 "Report a bug": the form (title, what happened, what you expected, the context captured now) and the list of
// reports (view, delete, Export all, Copy summary). Storage and the file format: ui/bugReports.ts.

import { Bug, ClipboardCopy, Download, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fmtDateTime } from '../../engine/core/time';
import type { GameState } from '../../engine/core/types';
import { addReport, captureContext, exportFile, exportFileName, hasDurableStore, makeReport, reportStore, storageBytes, storageNote, summaryText, type BugContext, type BugPrefill, type BugReport, type BugReportMeta } from '../bugReports';
import { deviceNow } from '../device';
import { Modal } from '../components/ui';
import { store, useStore } from '../store';

/** The context as the app sees it now (the dialog that was open is in the prefill; this dialog is not it). Impure. */
export function contextNow(g: GameState, prefill?: BugPrefill): BugContext {
  const d = deviceNow();
  const { autoPause: _ap, hintsSeen: _h, screenHintsSeen: _s, screenHintsFolded: _f, scenarioBest: _b, ...settings } = store.settings as unknown as Record<string, unknown>;
  return captureContext(g, {
    tab: store.nav.tab, view: store.nav.view, sel: store.nav.sel,
    settings, device: { kind: d.kind, form: d.form, input: d.input, standalone: d.standalone },
    viewport: typeof window !== 'undefined' ? { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 } : undefined,
    ua: typeof navigator !== 'undefined' ? navigator.userAgent : '', theme: safeTheme(), hold: g.autoHold ?? undefined,
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

export function BugReportModal({ prefill }: { prefill?: BugPrefill }) {
  const s = useStore();
  const g = s.game;
  const [title, setTitle] = useState(prefill?.title ?? '');
  const [what, setWhat] = useState('');
  const [expected, setExpected] = useState('');
  const [ctx] = useState<BugContext | null>(() => (g ? contextNow(g, prefill) : null));
  const [count, setCount] = useState<BugReportMeta[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    reportStore().list().then(setCount, () => setCount([]));
  }, []);
  const close = () => store.closeModal();
  const save = async () => {
    if (!g || !ctx || busy) return;
    setBusy(true);
    try {
      const r = makeReport(g, { title, what, expected }, ctx);
      const list = await addReport(r);
      const note = storageNote(list);
      store.closeModal();
      store.toast('good', 'Bug report saved', `${list.length} report${list.length === 1 ? '' : 's'} on this device. Menu › Bug reports to export them.${note ? ` ${note}` : ''}`);
    } catch (e) {
      store.toast('bad', 'Could not save the report', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const note = count ? storageNote(count) : null;
  return (
    <Modal title="Report a bug" icon={<Bug className="accent" />} onClose={close} footer={
      <>
        <span className="small dim grow">{count ? `${count.length} report${count.length === 1 ? '' : 's'} saved on this device` : ''}</span>
        <button className="btn" onClick={close}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={!g || busy}><Bug /> Save report</button>
      </>
    }>
      <div className="bug-form">
        <div className="small muted">Say what went wrong in your words. The game saves a snapshot of this moment with the report, so it can be replayed. Nothing leaves this device until you export the reports.</div>
        <label>Short title
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={ctx?.entity ? `e.g. ${ctx.entity.label}: …` : 'e.g. Crew alarm on a legal flight'} maxLength={120} autoFocus />
        </label>
        <label>What happened
          <textarea value={what} onChange={(e) => setWhat(e.target.value)} placeholder="What you saw" maxLength={4000} />
        </label>
        <label>What you expected
          <textarea value={expected} onChange={(e) => setExpected(e.target.value)} placeholder="What should have happened" maxLength={4000} />
        </label>
        {ctx && (
          <div className="bug-ctx">
            <span><b>Game time</b> {ctx.gameTime} · {ctx.gameTimeLocal}</span>
            <span><b>Version</b> {ctx.version} · <b>Screen</b> {ctx.screen.tab}{ctx.screen.view ? ` › ${ctx.screen.view}` : ''}{ctx.screen.modal ? ` · ${ctx.screen.modal}` : ''}</span>
            {ctx.entity && <span><b>About</b> {ctx.entity.label}{ctx.entity.lines[0] ? ` · ${ctx.entity.lines[0]}` : ''}</span>}
            <span><b>Device</b> {[ctx.device.kind, ctx.device.standalone ? 'home-screen app' : '', ctx.device.viewport].filter(Boolean).join(' · ')}</span>
          </div>
        )}
        {!hasDurableStore() && <div className="small warn">This browser has no IndexedDB: reports last only until the page closes. Export them soon.</div>}
        {note && <div className="small warn">{note}</div>}
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
          <div className="small muted">Written {when(open.createdAt)} · game {c.gameTime} · {c.gameTimeLocal} · {c.version}</div>
          {open.what && <div><b className="small">What happened</b><div>{open.what}</div></div>}
          {open.expected && <div><b className="small">Expected</b><div>{open.expected}</div></div>}
          <div className="small muted">Screen {c.screen.tab}{c.screen.view ? ` › ${c.screen.view}` : ''}{c.screen.modal ? ` · dialog ${c.screen.modal}` : ''}{c.screen.sel ? ` · ${c.screen.sel.kind} ${c.screen.sel.id}` : ''}</div>
          {c.entity && <pre>{[c.entity.label, ...c.entity.lines].join('\n')}</pre>}
          {c.inbox.length > 0 && <pre>{c.inbox.join('\n')}</pre>}
          <div className="tiny dim">Snapshot {Math.round((open.size * 2) / 1024)} KB · {[c.device.kind, c.device.form, c.device.standalone ? 'home-screen app' : '', c.device.viewport].filter(Boolean).join(' · ')}</div>
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
        <div className="small muted">Every report keeps a snapshot of the game at that moment. Export all writes one file with the reports, their snapshots and your current save, to send along with your notes.</div>
        {note && <div className="small warn">{note}</div>}
        {list && list.length === 0 && <div className="small dim">No reports yet. Menu › Report a bug, or the small Report link on a problem card, a flight sheet or Crew Control.</div>}
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
        {g && <button className="btn" onClick={() => store.openModal({ kind: 'bugReport', prefill: { modal: 'bugReports' } })}><Bug /> Report a bug</button>}
        <div className="tiny dim">Game time {g ? fmtDateTime(g.now) : '—'} UTC. Reports are kept on this device only.</div>
      </div>
    </Modal>
  );
}

/** The small "Report" link on a card, a flight sheet or Crew Control: opens the form with the entity pre-filled. */
export function ReportLink({ prefill, className }: { prefill: BugPrefill; className?: string }) {
  return (
    <button className={`bug-link${className ? ` ${className}` : ''}`} onClick={(e) => { e.stopPropagation(); store.openModal({ kind: 'bugReport', prefill: { ...prefill, modal: prefill.modal ?? store.modal?.kind } }); }} aria-label="Report a bug about this" data-tip="Report a bug about this">
      <Bug aria-hidden /> Report
    </button>
  );
}
