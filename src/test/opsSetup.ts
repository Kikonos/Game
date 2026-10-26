// v0.11 test setup: the scenario tests written before the Operations update run with it off (its offer rhythm and
// disruptions would move the outcomes their seeds pin). The Operations tests switch it on (src/engine/ops/ops.test.ts).
import { OPS_LIVE } from '../engine/ops/director';

OPS_LIVE.on = false;
