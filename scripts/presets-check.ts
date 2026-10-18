// Prints the seat counts produced by each cabin preset, for sanity-checking
// the cabin geometry against real-world configurations.
import { AIRCRAFT } from '../src/data/aircraft';
import { cabinPresets, cabinSummary, validateCabin } from '../src/engine/cabin';

for (const t of AIRCRAFT) {
  const parts = cabinPresets(t).map((p) => {
    const v = validateCabin(t, p.config);
    return `${p.id}:${v.total}(${cabinSummary(v.seats)})${v.ok ? '' : ' !!' + v.errors.join(';')}`;
  });
  console.log(t.name.padEnd(30), 'typ', t.typicalSeats, 'max', t.maxSeats, '|', parts.join('  '));
}
