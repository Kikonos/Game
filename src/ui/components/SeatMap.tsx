// Top-down cabin seat map drawn from a cabin configuration.

import type { ReactElement } from 'react';
import { AIRCRAFT_BY_ID, isWidebody } from '../../data/aircraft';
import { CLASS_COLOR, CLASS_NAME, type CabinClass, seatGroups, seatProduct } from '../../data/seats';
import type { CabinConfig } from '../../engine/cabin';

const ORDER: CabinClass[] = ['F', 'J', 'W', 'Y'];

export function SeatMap({ typeId, cabin, compact }: { typeId: string; cabin: CabinConfig; compact?: boolean }) {
  const t = AIRCRAFT_BY_ID[typeId];
  const wide = isWidebody(t);
  const aisles = seatGroups(t.yAbreast, wide).length - 1;
  const aisleW = 20;
  const cabinW = t.yAbreast * 19 + aisles * aisleW + 10;
  const nose = Math.max(110, cabinW * 1.3);
  const tail = Math.max(130, cabinW * 1.6);
  const total = nose + t.cabinLength + tail;
  const pad = 14;
  const H = cabinW + 30;
  const y0 = 15;

  const seats: ReactElement[] = [];
  const labels: ReactElement[] = [];
  let x = nose;
  for (const cls of ORDER) {
    const sec = cabin[cls];
    if (!sec || sec.rows <= 0) continue;
    const p = seatProduct(sec.product);
    const pitch = p.pitch(t);
    const n = p.abreast(t);
    const groups = seatGroups(n, wide);
    const secAisles = groups.length - 1;
    const seatW = (cabinW - 10 - secAisles * aisleW) / n;
    const gap = (cabinW - 10 - n * seatW) / Math.max(1, secAisles);
    if (p.overhead > 0) {
      seats.push(<rect key={`g${cls}`} x={x + 2} y={y0 + 5} width={p.overhead - 4} height={cabinW - 10} rx={4} fill="rgba(148,170,220,0.10)" />);
      x += p.overhead;
    }
    labels.push(
      <text key={`l${cls}`} x={x} y={y0 - 3} fontSize={Math.min(13, H * 0.09)} fill={CLASS_COLOR[cls]} fontWeight="700" fontFamily="Inter Variable, sans-serif">
        {compact ? cls : CLASS_NAME[cls]}
      </text>,
    );
    for (let r = 0; r < sec.rows; r++) {
      let yy = y0 + 5;
      let seatIdx = 0;
      groups.forEach((g, gi) => {
        for (let k = 0; k < g; k++) {
          seats.push(
            <rect
              key={`${cls}-${r}-${seatIdx}`}
              x={x + pitch * 0.12}
              y={yy + 1}
              width={pitch * 0.74}
              height={seatW - 2}
              rx={Math.min(5, seatW * 0.25)}
              fill={CLASS_COLOR[cls]}
              opacity={cls === 'Y' ? 0.85 : 0.95}
            />,
          );
          yy += seatW;
          seatIdx++;
        }
        if (gi < groups.length - 1) yy += gap;
      });
      x += pitch;
    }
  }
  const usedEnd = x;

  const fuselage = `M ${nose * 0.05} ${y0 + cabinW / 2}
    C ${nose * 0.05} ${y0 + cabinW * 0.1}, ${nose * 0.5} ${y0 - 4}, ${nose} ${y0 - 4}
    L ${nose + t.cabinLength} ${y0 - 4}
    C ${nose + t.cabinLength + tail * 0.6} ${y0 - 4}, ${total - 6} ${y0 + cabinW * 0.35}, ${total - 6} ${y0 + cabinW / 2}
    C ${total - 6} ${y0 + cabinW * 0.65}, ${nose + t.cabinLength + tail * 0.6} ${y0 + cabinW + 4}, ${nose + t.cabinLength} ${y0 + cabinW + 4}
    L ${nose} ${y0 + cabinW + 4}
    C ${nose * 0.5} ${y0 + cabinW + 4}, ${nose * 0.05} ${y0 + cabinW * 0.9}, ${nose * 0.05} ${y0 + cabinW / 2} Z`;

  return (
    <svg className="seatmap" viewBox={`${-pad} ${-pad} ${total + pad * 2} ${H + pad}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Seat map">
      <path d={fuselage} fill="rgba(148,170,220,0.06)" stroke="rgba(148,170,220,0.35)" strokeWidth={2} />
      <path d={`M ${nose * 0.32} ${y0 + cabinW * 0.3} L ${nose * 0.6} ${y0 + cabinW * 0.2} L ${nose * 0.6} ${y0 + cabinW * 0.8} L ${nose * 0.32} ${y0 + cabinW * 0.7} Z`} fill="rgba(62,230,255,0.15)" />
      {nose + t.cabinLength - usedEnd > 12 && (
        <rect x={usedEnd + 4} y={y0 + 5} width={nose + t.cabinLength - usedEnd - 8} height={cabinW - 10} rx={6} fill="none" stroke="rgba(148,170,220,0.25)" strokeDasharray="6 6" />
      )}
      {seats}
      {labels}
    </svg>
  );
}
