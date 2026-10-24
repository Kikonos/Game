// v0.9 the lucide icons the data names (department heads, achievements): an explicit map, so the bundle only carries these.

import {
  BadgeCheck, BedDouble, BellRing, Briefcase, CalendarCheck, ClipboardCheck, Clock, Crown, Hammer, Handshake, Home, Landmark, LineChart, Moon,
  PhoneCall, PiggyBank, Plane, Radio, Receipt, Repeat, Route, ShieldCheck, Smile, Snowflake, Sparkles, TrendingUp, Trophy, Users, Wrench,
  type LucideIcon,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  BadgeCheck, BedDouble, BellRing, Briefcase, CalendarCheck, ClipboardCheck, Clock, Crown, Hammer, Handshake, Home, Landmark, LineChart, Moon,
  PhoneCall, PiggyBank, Plane, Radio, Receipt, Repeat, Route, ShieldCheck, Smile, Snowflake, Sparkles, TrendingUp, Trophy, Users, Wrench,
};

/** A data icon by its lucide name (a trophy when unknown). */
export function NamedIcon({ name, className }: { name: string; className?: string }) {
  const I = ICONS[name] ?? Trophy;
  return <I className={className} aria-hidden />;
}
