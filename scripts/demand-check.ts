// Prints base daily one-way demand for well-known city pairs.
import { baseDemand, classSplit } from '../src/engine/demand';
import { distance } from '../src/engine/geo';
const pairs = [['LHR','JFK'],['MAD','BCN'],['MAD','PMI'],['BIO','SVQ'],['ATH','JTR'],['LHR','DXB'],['SYD','MEL'],['HND','CTS'],['JFK','LAX'],['CGK','DPS'],['DEL','BOM'],['MAD','LHR'],['FRA','JFK'],['SIN','LHR'],['LIS','OPO'],['OSL','BGO'],['ATL','MCO'],['JFK','BOS'],['MEX','CUN'],['GRU','GIG']];
for (const [a,b] of pairs) {
  const s = classSplit(a,b);
  console.log(`${a}-${b} ${String(distance(a,b)).padStart(6)}km ${Math.round(baseDemand(a,b)).toString().padStart(6)}/day  J ${(s.J*100).toFixed(1)}% F ${(s.F*100).toFixed(1)}%`);
}
