// v0.7.1 one reason per person (UPDATE-0.7.1.md §6): the icon for a root-cause code and the one-line reason row used
// by the candidate lists (duty modal, Crew Control) and the illegal-crew rows.

import { BedDouble, BookOpen, Gauge, GraduationCap, Hourglass, MapPin, Moon, Palmtree, Plane, Thermometer, UserPlus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { Reason, ReasonCode } from '../../engine/crew';
import { moreReasons } from './problemLogic';

const ICON: Record<ReasonCode, ReactNode> = {
  place: <MapPin />, rest: <BedDouble />, fdp: <Hourglass />, busy: <Plane />, sick: <Thermometer />, rating: <GraduationCap />,
  leave: <Palmtree />, joining: <UserPlus />, training: <BookOpen />, hours: <Gauge />, recovery: <Moon />,
};

export const REASON_WORD: Record<ReasonCode, string> = {
  place: 'wrong place', rest: 'needs rest', fdp: 'day too long', busy: 'busy on another flight', sick: 'sick', rating: 'not rated',
  leave: 'on leave', joining: 'not joined yet', training: 'in training', hours: 'out of hours', recovery: 'needs a weekly rest',
};

export function ReasonIcon({ code }: { code: ReasonCode }) {
  return <span className={`reason-ico r-${code}`} aria-label={REASON_WORD[code]} title={REASON_WORD[code]}>{ICON[code]}</span>;
}

/** '… is busy on AWQ815 to London until 10:30' with its icon; a tap shows the full list. */
export function ReasonLine({ reason, tone, name }: { reason: Reason; tone?: 'warn' | 'bad'; name?: string }) {
  const [all, setAll] = useState(false);
  const more = moreReasons(reason);
  return (
    <span className={`reason-line small ${tone ?? ''}`}>
      <span className="row gap-4">
        <ReasonIcon code={reason.code} />
        <span className="grow">{name ? `${name} is ` : ''}{reason.text}</span>
        {more.length > 0 && (
          <span className="reason-more" role="button" tabIndex={0} aria-expanded={all} aria-label="Every reason" onClick={(e) => { e.stopPropagation(); e.preventDefault(); setAll(!all); }} onKeyDown={(k) => { if (k.key === 'Enter' || k.key === ' ') { k.stopPropagation(); k.preventDefault(); setAll(!all); } }}>
            {all ? 'less' : `and ${more.length} more`}
          </span>
        )}
      </span>
      {all && <span className="reason-all tiny muted">{more.join(' · ')}</span>}
    </span>
  );
}
