// Flight-type key and chip for the screens (v0.5.2), same words and colours as the map lane's paths:
// Operating solid green · Positioning dotted amber · Ferry dotted amber + FERRY tag · Deadhead thin grey dotted.
// Styles: .ft-key / .ft-chip in styles/acmi/screens.css.

import { FLIGHT_TYPE_HINT, FLIGHT_TYPE_LABEL, type FlightType } from '../../engine/ops';

/** Line sample (solid or dotted) in the type's colour. */
export const FlightTypeKey = ({ type }: { type: FlightType }) => <span className={`ft-key ${type}`} aria-hidden />;

/** Chip with the line sample and the type's label; `short` drops the label to the sample + 'FERRY' tag. */
export function FlightTypeChip({ type, short = false }: { type: FlightType; short?: boolean }) {
  return (
    <span className={`ft-chip ${type}`} title={FLIGHT_TYPE_HINT[type]}>
      <FlightTypeKey type={type} />
      {short ? (type === 'ferry' ? 'FERRY' : null) : FLIGHT_TYPE_LABEL[type]}
    </span>
  );
}
