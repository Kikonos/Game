// v0.16.1 "Report a bug": the list of reports (view, delete, Export all, Copy summary). v0.17.1 the form opens from the
// one corner button on every screen (ui/BugCorner.tsx) with the screenshot it took; storage and the file format:
// ui/bugReports.ts.

import { Bug, Check, ChevronDown, ChevronRight, ClipboardCopy, Download, ImageOff, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fmtDateTime } from '../../engine/core/time';
import type { GameState, Ref } from '../../engine/core/types';
import { addReport, captureContext, exportFile, exportFileName, exportSelection, fixedHousekeeping, fixedLine, hasDurableStore, isCrewAlarm, makeReport, markSent, reportStatus, reportStore, storageBytes, storageNote, summaryText, type BugContext, type BugPrefill, type BugReport, type BugReportMeta, type BugShot, type ReportStatus } from '../bugReports';
import { deviceNow } from '../device';
import { Modal } from '../components/ui';
import { Help } from '../components/Help';
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
  // v0.17.2 Export all takes the new reports; this also takes those already sent.
  const [withSent, setWithSent] = useState(false);
  // v0.22.1 the crew alarms the game files itself: one folded line under the player's own reports.
  const [showAlarms, setShowAlarms] = useState(false);
  // v0.17.2 on opening: fixed reports get the day they were first seen fixed, and go 7 days after it.
  const refresh = async () => {
    try {
      const st = reportStore();
      const all = await st.list();
      const hk = fixedHousekeeping(all, Date.now());
      for (const id of hk.remove) await st.remove(id);
      for (const id of hk.mark) {
        const r = await st.get(id);
        if (r) await st.put({ ...r, fixedSeenAt: Date.now() });
      }
      setList(hk.remove.length || hk.mark.length ? await st.list() : all);
    } catch (e) {
      setList([]);
      store.toast('bad', 'Could not read the reports', (e as Error).message);
    }
  };
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
  const sel = list ? exportSelection(list, withSent) : { take: [], skipped: [] };
  const exportAll = async () => {
    if (busy || (!sel.take.length && !g)) return;
    setBusy(true);
    try {
      const full: BugReport[] = [];
      for (const m of sel.take) {
        const r = await reportStore().get(m.id);
        if (r) full.push(r);
      }
      download(exportFile(full, g, new Date(), sel.skipped), exportFileName(g?.company.name));
      // v0.17.2 what went out is Sent from now on (Export all leaves it out unless Include sent is on).
      const now = Date.now();
      for (const r of full) if (reportStatus(r) === 'new') await reportStore().put(markSent(r, now));
      await refresh();
      store.toast('good', 'Bug reports exported', `${full.length} report${full.length === 1 ? '' : 's'}${g ? ' and the current save' : ''} in one file.${sel.skipped.length ? ` ${sel.skipped.length} already sent or fixed left out.` : ''}`);
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
  const delFixed = () => {
    const fixed = (list ?? []).filter((r) => reportStatus(r) === 'fixed');
    if (!fixed.length) return;
    store.openModal({ kind: 'confirm', title: `Delete ${fixed.length} fixed report${fixed.length === 1 ? '' : 's'}?`, confirm: 'Delete fixed', danger: true, body: 'They are fixed in this version. Their snapshots and screenshots are deleted from this device.', onConfirm: async () => {
      for (const r of fixed) await reportStore().remove(r.id);
      store.openModal({ kind: 'bugReports' });
    } });
  };
  // v0.22.1 the player's own reports first, as before; the game's crew alarms apart (never among them).
  const own = (list ?? []).filter((r) => !isCrewAlarm(r));
  const alarms = (list ?? []).filter(isCrewAlarm);
  const alarmsNew = alarms.filter((r) => reportStatus(r) === 'new').length;
  const delAlarms = () => {
    if (!alarms.length) return;
    store.openModal({ kind: 'confirm', title: `Delete ${alarms.length} crew alarm${alarms.length === 1 ? '' : 's'}?`, confirm: 'Delete', danger: true, body: 'The records the game filed and their snapshots are deleted from this device. Your own reports stay.', onConfirm: async () => {
      for (const r of alarms) await reportStore().remove(r.id);
      store.openModal({ kind: 'bugReports' });
    } });
  };
  const groups: { st: ReportStatus; label: string; rows: BugReportMeta[] }[] = (['new', 'sent', 'fixed'] as ReportStatus[]).map((st) => ({ st, label: st === 'new' ? 'New' : st === 'sent' ? 'Sent' : 'Fixed', rows: own.filter((r) => reportStatus(r) === st) }));
  const nFixed = groups[2].rows.length;
  const nSent = groups[1].rows.length;
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
          {open.shot ? <img className="bug-shot" src={open.shot} alt="Screenshot" /> : isCrewAlarm(open) ? null : <div className="small dim">No screenshot</div>}
          {open.what && (isCrewAlarm(open) ? <pre>{open.what}</pre> : <div><b className="small">What happened</b><div>{open.what}</div></div>)}
          {open.expected && <div><b className="small">Expected</b><div>{open.expected}</div></div>}
          <div className="small muted">Screen {c.screen.tab}{c.screen.view ? ` › ${c.screen.view}` : ''}{c.screen.modal ? ` · dialog ${c.screen.modal}` : ''}{c.screen.sel ? ` · ${c.screen.sel.kind} ${c.screen.sel.id}` : ''}</div>
          {c.entity && <pre>{[c.entity.label, ...c.entity.lines].join('\n')}</pre>}
          {c.inbox.length > 0 && <pre>{c.inbox.join('\n')}</pre>}
          <div className="tiny dim">{open.size ? `Snapshot ${Math.round((open.size * 2) / 1024)} KB` : open.snapOf ? 'Shares a snapshot with another alarm of the same minute' : 'No game snapshot'}{open.shotBytes ? ` · screenshot ${Math.round(open.shotBytes / 1024)} KB` : ''} · {[c.device.kind, c.device.form, c.device.standalone ? 'home-screen app' : '', c.device.viewport].filter(Boolean).join(' · ')}</div>
        </div>
      </Modal>
    );
  }
  return (
    <Modal title={<>Bug reports <Help title="Bug reports">
      <p>Each report keeps a screenshot and the game at that moment.</p>
      <p>Export writes one file with your new reports and your current save; what you export is marked Sent.</p>
      <p>Fixed reports are deleted 7 days after the update that fixed them.</p>
      <p>Crew alarms: the game files every crew alarm here by itself, with the game at that minute, so it can be checked later whether the alarm was right. They go out with Export; only the newest keep a snapshot.</p>
    </Help></>} icon={<Bug className="accent" />} onClose={close} footer={
      <>
        <span className="small dim grow">{list ? `${own.length} report${own.length === 1 ? '' : 's'}${alarms.length ? ` · ${alarms.length} crew alarm${alarms.length === 1 ? '' : 's'}` : ''} · ${Math.round(storageBytes(list) / 1024 / 1024 * 10) / 10} MB` : ''}</span>
        <button className="btn" onClick={copy} disabled={!list?.length}><ClipboardCopy /> Copy summary</button>
        <button className="btn btn-primary" onClick={exportAll} disabled={busy || (!sel.take.length && !g)}><Download /> Export {sel.take.length ? `${sel.take.length} ` : ''}{withSent ? 'new and sent' : 'new'}</button>
      </>
    }>
      <div className="col gap-12">
        {note && <div className="small warn">{note}</div>}
        {list && own.length === 0 && <div className="small dim">No reports yet. To report a bug, tap the small bug button in the lower left corner.</div>}
        {(nSent > 0 || nFixed > 0) && (
          <div className="row between wrap gap-8">
            {nSent > 0 ? (
              <button className={`bug-toggle small ${withSent ? 'on' : ''}`} role="switch" aria-checked={withSent} onClick={() => setWithSent(!withSent)}>
                <span className="hm-box" aria-hidden>{withSent && <Check />}</span> Include sent ({nSent}) to send again
              </button>
            ) : <span />}
            {nFixed > 0 && <button className="btn btn-sm" onClick={delFixed}><Trash2 /> Delete fixed ({nFixed})</button>}
          </div>
        )}
        {groups.filter((x) => x.rows.length).map((grp) => (
          <div key={grp.st} className="col gap-6">
            <div className="upper dim">{grp.label} · {grp.rows.length}</div>
            <div className="bug-list">
              {grp.rows.map((r) => (
                <div key={r.id} className={`bug-row bug-${grp.st}`}>
                  <button className="bug-row-main" onClick={() => view(r.id)}>
                    <b className="ellipsis">{r.title}</b>
                    <div className="small muted ellipsis">{when(r.createdAt)} · game {r.context.gameTime}{r.context.entity ? ` · ${r.context.entity.label}` : ''} · {r.context.screen.tab}{grp.st === 'sent' && r.sentAt ? ` · sent ${when(r.sentAt)}` : ''}</div>
                    {grp.st === 'fixed' && <div className="small good bug-fixed">{fixedLine(r.id)}</div>}
                  </button>
                  <button className="btn btn-ghost btn-icon" onClick={() => del(r)} aria-label={`Delete report ${r.title}`}><Trash2 /></button>
                </div>
              ))}
            </div>
          </div>
        ))}
        {alarms.length > 0 && (
          <div className="col gap-6">
            <div className="row between gap-8">
              <button className="bug-fold upper dim" aria-expanded={showAlarms} onClick={() => setShowAlarms(!showAlarms)}>
                {showAlarms ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />} Crew alarms · {alarms.length}{alarmsNew && alarmsNew !== alarms.length ? ` · ${alarmsNew} new` : ''}
              </button>
              {showAlarms && <button className="btn btn-sm" onClick={delAlarms}><Trash2 /> Delete all</button>}
            </div>
            {showAlarms && (
              <div className="bug-list">
                {alarms.map((r) => (
                  <div key={r.id} className={`bug-row bug-alarm bug-${reportStatus(r)}`}>
                    <button className="bug-row-main" onClick={() => view(r.id)}>
                      <b className="ellipsis">{r.alarm?.title ?? r.title}</b>
                      <div className="small muted ellipsis">game {r.context.gameTime}{r.alarm ? ` · ${r.alarm.no} ${r.alarm.leg}` : ''}{reportStatus(r) === 'sent' ? ' · sent' : ''}</div>
                    </button>
                    <button className="btn btn-ghost btn-icon" onClick={() => del(r)} aria-label={`Delete crew alarm ${r.title}`}><Trash2 /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="tiny dim">Game time {g ? fmtDateTime(g.now) : '—'} UTC. Reports are kept on this device only.</div>
      </div>
    </Modal>
  );
}
