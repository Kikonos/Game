# What's new — drafts (not yet in src/data/whatsNew.ts)

## Visual A: the map (Visual improvements, batch 1)

features:
- Day and night on the map: the night side follows the real sun for the date and time, with a soft twilight band. City lights come on after sunset.
- Every aircraft is drawn from above as its real type, in its tail colour: the right engines in the right places, and bigger aircraft bigger. The 747's hump and the A380's double deck show from above.
- Flight lines: solid for the part already flown, dashed for the part still to fly, and a short contrail behind aircraft at cruising height.
- Weather on the map: an airport closed by weather, a curfew or a world event gets a small storm, cloud or moon mark until it reopens. Tap it to see what is going on.
- Spotter mode: tap the binoculars on the Map to follow one aircraft in the air. A panel shows it in its livery with its flight, route, altitude, speed and landing time. It moves on to another aircraft every minute, or tap Next. Nothing changes in the game while you watch.

improvements:
- Contrails and the gliding night follow the Map animations setting and the system's Reduce Motion.

## ETOPS on ferries (engine, after Visual A)

features:
- Ferries and empty legs now follow ETOPS like a real airline: without an ETOPS approval a twin stays within 60 minutes of an airport, so a delivery from Canada or the US comes home the northern way (Kangerlussuaq, Iqaluit, Keflavík, Shannon), with fuel stops and night stops on the map and in the Schedule. With the approval and a capable aircraft it flies direct.
- A crossing we may not fly (a twin across the Pacific without ETOPS 180) is said before you sign, with what real operators do: get the approval first, take the aircraft on this side, or pay a ferry company to bring it home.

improvements:
- The Fleet card's ETOPS line says what is really used, e.g. "capable of 120 min · approved 60 min → ferries go the northern way".
- Pilots flying out to collect an aircraft across 4+ time zones now land with their full 14 h rest (deliveries from North America no longer wait for ever).
