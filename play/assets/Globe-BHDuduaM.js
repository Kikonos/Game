import{au as qn,k as Kn,r as lt,j as U,b5 as Xn,P as Yn,M as Qn,N as Zn}from"./vendor-BkOooHx2.js";import{S as Zt,V as Qt,a as Pt,b as K,M as zt,c as Rn,N as En,B as Jn,P as to,d as ve,e as Vt,D as Nn,f as eo,R as no,U as oo,g as ao,C as so,L as io,h as In,A as ro,F as ct,i as lo,j as co,k as uo,W as fo,l as mo,m as ho,n as po,G as Te,o as vo}from"./globe3d-D_SlkrEJ.js";import{b0 as T,cA as go,cB as pe,bG as xo,cD as yo,bA as wo,cC as bo,bD as Mo}from"./engine-ZDA9cecS.js";import{o as So,l as Ao,a as Lo,s as Co,m as Fo,b as Po,N as zo,c as Ro,d as Eo,e as No,i as Io,f as k,g as gn,h as To,w as ko,j as Do,r as _o,T as Yt,k as Wo,n as Oo,p as Bo,q as Go,t as jo,u as Ho,H as xn}from"./index-C8C7rPFI.js";import"./aircraft-CH5p5IdF.js";import"./flags-hjMu7sUS.js";const V=Math.PI/180;function I(e,t,n=1){const s=Math.cos(t*V);return[n*s*Math.cos(e*V),n*Math.sin(t*V),-n*s*Math.sin(e*V)]}const ut=(e,t)=>e[0]*t[0]+e[1]*t[1]+e[2]*t[2],xt=(e,t)=>[e[0]-t[0],e[1]-t[1],e[2]-t[2]],Ge=(e,t)=>[e[1]*t[2]-e[2]*t[1],e[2]*t[0]-e[0]*t[2],e[0]*t[1]-e[1]*t[0]];function st(e){const t=Math.hypot(e[0],e[1],e[2])||1;return[e[0]/t,e[1]/t,e[2]/t]}const $o=e=>I(...Po(e)),yn=[Math.sin(zo*V),Math.sin(Ro*V)],vt=(e,t,n=0)=>ut(st(e),st(xt(t,e)))>n,Uo=1.22,Vo=5.6,wn=4.1,ge=32,bn=82,ke=e=>I(e.lon,e.lat,e.dist),Q=e=>((e+180)%360+360)%360-180,gt=e=>Math.max(-bn,Math.min(bn,e)),de=e=>Math.max(Uo,Math.min(Vo,e)),$e=(e,t,n=ge)=>2*(e-1)*Math.tan(n/2*V)/Math.max(1,t),Tn=(e,t,n=ge)=>$e(e,t,n)/V,qo=(e,t)=>2*Math.PI/(Math.max(1e-9,e)*Math.max(1,t)),Ko=(e,t,n)=>Fo(qo($e(e,n),t)),Xo=325;function Yo(e,t){const n=Math.exp(-t/Xo),s=[e[0]*n,e[1]*n];return Math.hypot(s[0],s[1])<4e-4?[0,0]:s}const Qo=2.4,Mn=8e3;function Zo(e,t,n){const s=n<=0?0:n>=1?1:n*n*(3-2*n);return{lon:Q(e.lon+Q(t.lon-e.lon)*s),lat:e.lat+(t.lat-e.lat)*s,dist:e.dist+(t.dist-e.dist)*s}}function Ue(e,t){return Math.acos(Math.max(-1,Math.min(1,ut(I(...e),I(...t)))))/V}function De(e,t,n,s=0){const u=s*Tn(t,n)/Math.max(.2,Math.cos(e[1]*V));return{lon:Q(e[0]+u),lat:gt(e[1])}}function je(e,t=[1,1,1,1]){const n=(e??"").trim();let s=/^#([0-9a-f]{3})$/i.exec(n);if(s)return[...s[1].split("").map(c=>parseInt(c+c,16)/255),1];if(s=/^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(n),s){const c=parseInt(s[1],16);return[(c>>16)/255,(c>>8&255)/255,(c&255)/255,s[2]?parseInt(s[2],16)/255:1]}const l=(/^rgba?\(([^)]*)\)$/i.exec(n)?.[1]??n).split(/[\s,/]+/).filter(Boolean).map(Number);if(l.length>=3&&l.slice(0,3).every(Number.isFinite)){const c=l.length>=4&&Number.isFinite(l[3])?l[3]:1;return[l[0]/255,l[1]/255,l[2]/255,Math.max(0,Math.min(1,c))]}return t}function Sn(e){const t=e.split(/[\s,]+/).filter(Boolean).map(Number);return t.length>=2&&t.every(n=>Number.isFinite(n)&&n>=0)&&t[0]+t[1]>0?[t[0],t[1]]:null}function Jo(e){const t=T[e.from],n=T[e.to];if(!t||!n)return[];const{off:s,on:u}=xo(e),l=kn(Ue([t.lon,t.lat],[n.lon,n.lat])),c=[];for(let g=0;g<=l;g++)c.push(e.div?yo(e,s+(u-s)*g/l):pe(t.lon,t.lat,n.lon,n.lat,g/l));return c}function fe(e,t){const n=T[e],s=T[t];if(!n||!s)return[];const u=kn(Ue([n.lon,n.lat],[s.lon,s.lat])),l=[];for(let c=0;c<=u;c++)l.push(pe(n.lon,n.lat,s.lon,s.lat,c/u));return l}const kn=e=>Math.max(8,Math.min(128,Math.ceil(e/1.2)));function An(e,t){const n=[];for(const s of Object.values(e.fleet)){if(!T[s.at]||!So(s))continue;const u=go(e,s,t);if(u.phase==="airborne"&&u.flight){n.push({id:s.id,typeId:s.typeId,pos:u.pos,airborne:!0,flight:u.flight,progress:u.progress,ahead:u.ahead});continue}const l=Ao(s)?Lo(e,s):null;if(l){const c=Co(s.id,s.typeId,l.site,l.prefix,t);if("leg"in c){const g=T[c.leg.from],d=T[c.leg.to];if(g&&d){n.push({id:s.id,typeId:s.typeId,airborne:!0,show:c.leg,progress:c.progress,pos:pe(g.lon,g.lat,d.lon,d.lat,c.progress),ahead:pe(g.lon,g.lat,d.lon,d.lat,Math.min(1,c.progress+.01))});continue}}else if(T[c.at]){const g=T[c.at];n.push({id:s.id,typeId:s.typeId,pos:[g.lon,g.lat],airborne:!1,progress:0,at:c.at});continue}}n.push({id:s.id,typeId:s.typeId,pos:u.pos,airborne:!1,progress:0,at:u.at})}return n}function Ln(e,t){const n=I(...e),s=st(xt([0,1,0],[n[0]*n[1],n[1]*n[1],n[2]*n[1]]));if(!t)return s;const u=xt(I(...t),n),l=xt(u,[n[0]*ut(u,n),n[1]*ut(u,n),n[2]*ut(u,n)]);return Math.hypot(...l)<1e-9?s:st(l)}function ta(e){const t=e[0]*V,n=e[1]*V;return{east:[-Math.sin(t),0,-Math.cos(t)],north:[-Math.sin(n)*Math.cos(t),Math.cos(n),Math.sin(n)*Math.sin(t)]}}function me(e,t,n,s,u=ge){const l=st([-t[0],-t[1],-t[2]]);let c=Ge(l,[0,1,0]);Math.hypot(...c)<1e-9&&(c=[1,0,0]),c=st(c);const g=Ge(c,l),d=xt(e,t),P=ut(d,l);if(P<=1e-6)return null;const w=s/2/Math.tan(u/2*V);return{x:n/2+ut(d,c)/P*w,y:s/2-ut(d,g)/P*w}}const at=e=>new K(e[0],e[1],e[2],e[3]);function ea(e,t,n){const s=new eo(e,t,t/2,no,oo);return s.wrapS=ao,s.wrapT=so,s.magFilter=io,s.minFilter=In,s.generateMipmaps=!0,s.anisotropy=Math.min(8,n),s.unpackAlignment=1,s.needsUpdate=!0,s}const na=`
vec4 bsW(float v) {
  vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v;
  vec4 s = n * n * n;
  float x = s.x;
  float y = s.y - 4.0 * s.x;
  float z = s.z - 4.0 * s.y + 6.0 * s.x;
  return vec4(x, y, z, 6.0 - x - y - z) * (1.0 / 6.0);
}
float landAt(sampler2D t, vec2 uv, vec2 size) {
  vec2 gx = dFdx(uv);
  vec2 gy = dFdy(uv);
  vec2 st = uv * size - 0.5;
  vec2 f = fract(st);
  st -= f;
  vec4 xc = bsW(f.x);
  vec4 yc = bsW(f.y);
  vec4 c = st.xxyy + vec2(-0.5, 1.5).xyxy;
  vec4 s = vec4(xc.xz + xc.yw, yc.xz + yc.yw);
  vec4 o = (c + vec4(xc.yw, yc.yw) / s) / size.xxyy;
  float s0 = textureGrad(t, o.xz, gx, gy).r;
  float s1 = textureGrad(t, o.yz, gx, gy).r;
  float s2 = textureGrad(t, o.xw, gx, gy).r;
  float s3 = textureGrad(t, o.yw, gx, gy).r;
  float sx = s.x / (s.x + s.y);
  float sy = s.z / (s.z + s.w);
  return mix(mix(s3, s2, sx), mix(s1, s0, sx), sy);
}`,oa=`
varying vec2 vUv;
varying vec3 vN;
varying vec3 vW;
void main() {
  vUv = uv;
  vN = normalize(position);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`,aa=`
uniform sampler2D uLand; uniform vec2 uLandSize; uniform float uLandOn;
uniform vec4 uOcean0; uniform vec4 uOcean1; uniform vec4 uLand0; uniform vec4 uLand1; uniform vec4 uGrid; uniform vec4 uNight; uniform vec4 uAtmo;
uniform vec4 uCoast; uniform float uCoastW;
uniform vec3 uSun; uniform vec2 uNightS; uniform float uGlint; uniform float uDayLift;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vW;
${na}
float gridLine(float v, float step) {
  float f = abs(fract(v / step + 0.5) - 0.5) * step;
  float w = fwidth(v);
  return 1.0 - smoothstep(0.0, w * 1.2, f);
}
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  float facing = clamp(dot(N, V), 0.0, 1.0);
  // The land edge from the smooth field. Magnified (a texel over a pixel or two): its signed distance in screen px
  // (the field over its screen gradient), so the edge is a pixel of anti-aliasing and the coast line is drawn on it a
  // constant width. Minified (the whole globe): the mipmapped field is itself the pixel's coverage, and the coast is
  // the band where it crosses one half (no screen derivatives there: they come per 2 × 2 pixels and would step).
  float m = landAt(uLand, vUv, uLandSize) * uLandOn;
  float gm = length(vec2(dFdx(m), dFdy(m)));
  float d = (m - 0.5) / max(gm, 1e-5);
  float rho = max(length(dFdx(vUv) * uLandSize), length(dFdy(vUv) * uLandSize));
  float mag = 1.0 - smoothstep(0.45, 0.9, rho);
  float land = mix(smoothstep(0.3, 0.7, m), clamp(d + 0.5, 0.0, 1.0), mag);
  float lit = pow(facing, 0.55);
  vec3 ocean = mix(uOcean1.rgb, uOcean0.rgb, lit);
  vec3 ground = mix(uLand1.rgb, uLand0.rgb, lit);
  vec3 col = mix(ocean, ground, land);
  // A 15° graticule, faint (fades out towards the poles where the meridians bunch up).
  float lon = vUv.x * 360.0;
  float lat = vUv.y * 180.0;
  float g = max(gridLine(lon, 15.0) * smoothstep(80.0, 70.0, abs(lat - 90.0)), gridLine(lat, 15.0));
  col = mix(col, uGrid.rgb, g * uGrid.a);
  // Day and night from the sun's real position (the flat map's twilight band).
  float s = dot(N, uSun);
  float t = clamp((uNightS.x - s) / (uNightS.x - uNightS.y), 0.0, 1.0);
  float night = t * t * (3.0 - 2.0 * t);
  // A soft sun glint on the water by day.
  vec3 H = normalize(uSun + V);
  float glint = pow(max(dot(N, H), 0.0), 90.0) * (1.0 - land) * (1.0 - night) * uGlint;
  col += glint * vec3(1.0, 0.97, 0.9);
  // The sunlit side a little brighter (on the dark theme the night alone would barely show).
  col *= 1.0 + uDayLift * (1.0 - night) * smoothstep(-0.05, 0.5, s);
  col = mix(col, uNight.rgb, night * uNight.a);
  // The atmosphere seen edge-on: a thin bright limb.
  float rim = pow(1.0 - facing, 3.0);
  col = mix(col, uAtmo.rgb, rim * uAtmo.a * 0.85);
  // The coast, on the land's edge (thinner than a pixel: fainter instead), easing out towards the limb.
  float hw = max(uCoastW, 0.5);
  float near = clamp(hw + 0.5 - abs(d), 0.0, 1.0) * min(1.0, uCoastW * 2.0) * step(1e-5, gm);
  float far = (1.0 - smoothstep(0.1, 0.34, abs(m - 0.5))) * min(1.0, uCoastW * 1.6) * uLandOn;
  float coast = mix(far, near, mag);
  col = mix(col, uCoast.rgb, coast * uCoast.a * smoothstep(0.0, 0.25, facing));
  gl_FragColor = vec4(col, 1.0);
}`;function sa(e,t){const n=e.uniforms;n.uLand.value=t,n.uLandOn.value=t?1:0,t&&n.uLandSize.value.set(t.image.width,t.image.height)}function ia(e){const t=new Zt({vertexShader:oa,fragmentShader:aa,uniforms:{uLand:{value:e},uLandSize:{value:new Qt(1,1)},uLandOn:{value:0},uCoast:{value:new K},uCoastW:{value:.5},uOcean0:{value:new K},uOcean1:{value:new K},uLand0:{value:new K},uLand1:{value:new K},uGrid:{value:new K},uNight:{value:new K},uAtmo:{value:new K},uSun:{value:new Pt(1,0,0)},uNightS:{value:new Qt(yn[0],yn[1])},uGlint:{value:0},uDayLift:{value:0}}});return new zt(new Rn(1,160,96),t)}function ra(e,t){const n=e.uniforms;n.uOcean0.value=at(t.ocean0),n.uOcean1.value=at(t.ocean1),n.uLand0.value=at(t.land0),n.uLand1.value=at(t.land1),n.uGrid.value=at(t.grid),n.uNight.value=at(t.night),n.uAtmo.value=at(t.atmo),n.uCoast.value=at(t.coast),n.uGlint.value=t.glint,n.uDayLift.value=t.dayLift}const la=`
varying vec3 vN;
varying vec3 vW;
void main() {
  vN = normalize(position);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`,ca=`
uniform vec4 uAtmo;
uniform float uR;
varying vec3 vN;
varying vec3 vW;
void main() {
  // How far outside the Earth's disc this ray passes: 0 at the limb, 1 at the halo's outer edge.
  vec3 V = normalize(vW - cameraPosition);
  vec3 C = -cameraPosition;
  float along = dot(C, V);
  float miss = sqrt(max(0.0, dot(C, C) - along * along));
  float x = clamp((miss - 1.0) / (uR - 1.0), 0.0, 1.0);
  float a = pow(1.0 - x, 3.2) * uAtmo.a;
  gl_FragColor = vec4(uAtmo.rgb, a);
}`;function ua(){const t=new Zt({vertexShader:la,fragmentShader:ca,uniforms:{uAtmo:{value:new K},uR:{value:1.11}},side:Jn,transparent:!0,depthWrite:!1,blending:En});return new zt(new Rn(1.11,96,48),t)}function da(e,t,n){e.uniforms.uAtmo.value=at(t.atmo),e.blending=n?ro:En,e.needsUpdate=!0}const fa=`
attribute vec3 aPrev;
attribute vec3 aNext;
attribute float aSide;
uniform vec2 uRes;
uniform float uHalfW;
varying float vD;
varying float vFace;
varying vec3 vP;
vec2 scr(vec4 c) { return c.xy / c.w * uRes * 0.5; }
void main() {
  mat4 pv = projectionMatrix * viewMatrix * modelMatrix;
  vec4 c = pv * vec4(position, 1.0);
  vec2 s = scr(c);
  vec2 d1 = s - scr(pv * vec4(aPrev, 1.0));
  vec2 d2 = scr(pv * vec4(aNext, 1.0)) - s;
  float l1 = length(d1);
  float l2 = length(d2);
  vec2 t1 = l1 > 1e-4 ? d1 / l1 : (l2 > 1e-4 ? d2 / l2 : vec2(1.0, 0.0));
  vec2 t2 = l2 > 1e-4 ? d2 / l2 : t1;
  vec2 t = t1 + t2;
  t = length(t) > 1e-3 ? normalize(t) : t1;
  vec2 nrm = vec2(-t.y, t.x);
  float mitre = 1.0 / max(dot(nrm, vec2(-t1.y, t1.x)), 0.5);
  float e = max(uHalfW, 0.5) + 1.0;
  c.xy += nrm * (aSide * e * mitre) / (uRes * 0.5) * c.w;
  vD = aSide * e;
  vec3 w = (modelMatrix * vec4(position, 1.0)).xyz;
  vFace = dot(normalize(w), normalize(cameraPosition - w));
  vP = position;
  gl_Position = c;
}`,ma=`
uniform vec4 uColor;
uniform float uHalfW;
uniform sampler2D uLand;
uniform float uLandOn;
varying float vD;
varying float vFace;
varying vec3 vP;
void main() {
  if (vFace < 0.0) discard;
  float hw = max(uHalfW, 0.5);
  float a = clamp(hw + 0.5 - abs(vD), 0.0, 1.0) * min(1.0, uHalfW * 2.0);
  vec3 n = normalize(vP);
  vec2 uv = vec2(atan(-n.z, n.x) / 6.2831853 + 0.5, asin(clamp(n.y, -1.0, 1.0)) / 3.1415927 + 0.5);
  float land = mix(1.0, smoothstep(0.3, 0.7, texture2D(uLand, uv).r), uLandOn);
  a *= uColor.a * smoothstep(0.0, 0.25, vFace) * land;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor.rgb, a);
}`;function ha(e){const t=new ve;t.setAttribute("position",new Vt(e.pos,3)),t.setAttribute("aPrev",new Vt(e.prev,3)),t.setAttribute("aNext",new Vt(e.next,3)),t.setAttribute("aSide",new Vt(e.side,1)),t.setIndex(new Vt(e.idx,1));const n=new Zt({vertexShader:fa,fragmentShader:ma,uniforms:{uColor:{value:new K},uHalfW:{value:.5},uRes:{value:new Qt(1,1)},uLand:{value:null},uLandOn:{value:0}},transparent:!0,depthWrite:!1,side:Nn}),s=new zt(t,n);return s.frustumCulled=!1,s}function pa(e,t,n,s,u,l,c){const g=e.uniforms;g.uColor.value.set(t[0],t[1],t[2],t[3]),g.uHalfW.value=n*l/2,g.uRes.value.set(s,u),g.uLand.value=c,g.uLandOn.value=c?1:0}const va=`
attribute vec3 aSide;
attribute float aSign;
attribute float aT;
attribute float aLen;
uniform float uHalfW;
varying float vSign;
varying float vT;
varying float vLen;
varying float vFace;
void main() {
  vSign = aSign;
  vT = aT;
  vLen = aLen;
  vec4 w = modelMatrix * vec4(position + aSide * aSign * uHalfW, 1.0);
  vFace = dot(normalize(position), normalize(cameraPosition - w.xyz));
  gl_Position = projectionMatrix * viewMatrix * w;
}`,ga=`
uniform vec3 uColor;
uniform float uOpacity;
uniform float uSplit;
uniform vec2 uDashA;
uniform vec2 uDashB;
varying float vSign;
varying float vT;
varying float vLen;
varying float vFace;
float dashed(vec2 d, float len) {
  if (d.x <= 0.0) return 1.0;
  float m = mod(len, d.x + d.y);
  float w = fwidth(len) * 0.6;
  return 1.0 - smoothstep(d.x - w, d.x + w, m);
}
void main() {
  if (vFace < 0.0) discard;
  float on = vT <= uSplit ? dashed(uDashA, vLen) : dashed(uDashB, vLen);
  float edge = 1.0 - smoothstep(0.55, 1.0, abs(vSign));
  float a = uOpacity * on * edge * smoothstep(0.0, 0.2, vFace);
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
}`;function xa(e,t){const n=e.length,s=e.map(([v,S])=>I(v,S,t)),u=new Float32Array(n*6),l=new Float32Array(n*6),c=new Float32Array(n*2),g=new Float32Array(n*2),d=new Float32Array(n*2);let P=0;for(let v=0;v<n;v++){v>0&&(P+=Math.hypot(...xt(s[v],s[v-1])));const S=st(xt(s[Math.min(n-1,v+1)],s[Math.max(0,v-1)])),D=st(Ge(st(s[v]),S));for(let A=0;A<2;A++){const F=v*2+A;u.set(s[v],F*3),l.set(D,F*3),c[F]=A?1:-1,g[F]=n>1?v/(n-1):0,d[F]=P}}const w=[];for(let v=0;v<n-1;v++){const S=v*2;w.push(S,S+1,S+2,S+1,S+3,S+2)}const p=new ve;return p.setAttribute("position",new ct(u,3)),p.setAttribute("aSide",new ct(l,3)),p.setAttribute("aSign",new ct(c,1)),p.setAttribute("aT",new ct(g,1)),p.setAttribute("aLen",new ct(d,1)),p.setIndex(w),p}function ya(){return new Zt({vertexShader:va,fragmentShader:ga,uniforms:{uHalfW:{value:.001},uColor:{value:new Pt(1,1,1)},uOpacity:{value:1},uSplit:{value:-1},uDashA:{value:new Qt(0,0)},uDashB:{value:new Qt(0,0)}},transparent:!0,depthWrite:!1,side:Nn})}function _e(e,t,n){const s=e.uniforms;s.uHalfW.value=t.width/2*n*1.35,s.uColor.value.set(t.color[0],t.color[1],t.color[2]),s.uOpacity.value=t.opacity,s.uSplit.value=t.split,s.uDashA.value.set(t.before?t.before[0]*n:0,t.before?t.before[1]*n:0),s.uDashB.value.set(t.after?t.after[0]*n:0,t.after?t.after[1]*n:0)}const wa=`
attribute vec4 aColor;
attribute float aSize;
uniform float uDpr;
varying vec4 vColor;
varying float vSize;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  float face = dot(normalize(w.xyz), normalize(cameraPosition - w.xyz));
  vColor = aColor;
  vSize = aSize * uDpr;
  gl_PointSize = face > 0.02 ? vSize : 0.0;
  gl_Position = projectionMatrix * viewMatrix * w;
}`,ba=`
uniform vec4 uRing;
varying vec4 vColor;
varying float vSize;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float px = 2.0 / max(vSize, 1.0);
  float disc = 1.0 - smoothstep(1.0 - px, 1.0, d);
  float inner = 1.0 - smoothstep(0.62 - px, 0.62, d);
  vec3 c = mix(uRing.rgb, vColor.rgb, inner);
  float a = disc * mix(uRing.a, vColor.a, inner);
  if (a < 0.01) discard;
  gl_FragColor = vec4(c, a);
}`;function Ma(){const e=new Zt({vertexShader:wa,fragmentShader:ba,uniforms:{uDpr:{value:1},uRing:{value:new K}},transparent:!0,depthWrite:!1});return new to(new ve,e)}function Sa(e,t){const n=new Float32Array(t.length*3),s=new Float32Array(t.length*4),u=new Float32Array(t.length);t.forEach((c,g)=>{n.set(c.pos,g*3),s.set(c.color,g*4),u[g]=c.size}),e.geometry.dispose();const l=new ve;l.setAttribute("position",new ct(n,3)),l.setAttribute("aColor",new ct(s,4)),l.setAttribute("aSize",new ct(u,1)),e.geometry=l}const Kt=128,He=112,Cn=Kt/He,Xt=e=>{const t=Eo(e);return Math.max(t.L,t.S)};function Aa(e,t,n,s=2){const u=document.createElement("canvas");u.width=Kt,u.height=Kt;const l=u.getContext("2d"),c=No(e,He),g=He/Xt(e),d=s*(g/.6)*.62;l.translate(Kt/2,Kt/2),l.lineJoin="round";const P=new Path2D(c.engines),w=new Path2D(c.body);l.strokeStyle=t.edge,l.lineWidth=d*.6*2,l.stroke(P),l.fillStyle=t.eng,l.fill(P),l.lineWidth=d*2,l.stroke(w),l.fillStyle=t.fill,l.fill(w),c.deck&&(l.fillStyle=t.deck,l.fill(new Path2D(c.deck)));const p=new lo(u);return p.colorSpace=co,p.minFilter=In,p.anisotropy=Math.min(4,n),p}function La(e){return new uo({map:e,transparent:!0,depthWrite:!1,alphaTest:.02})}const he=Math.PI/180,Ca=4096,Fa=2048;function Pa(e,t,n){const s=t/2,u=new Uint8Array(t*s),l=Math.min(Ca,t),c=Math.min(Fa,s),d=n(l,c).getContext("2d",{willReadFrequently:!0});if(!d)throw new Error("no 2D canvas for the globe");const P=qn().scale(t/(2*Math.PI)).translate([t/2,s/2]).precision(.05),w=new Path2D;Kn(P,w)(e);for(let p=0;p<s;p+=c)for(let v=0;v<t;v+=l){d.setTransform(1,0,0,1,0,0),d.fillStyle="#000",d.fillRect(0,0,l,c),d.setTransform(1,0,0,1,-v,-p),d.fillStyle="#fff",d.fill(w);const S=d.getImageData(0,0,l,c).data;for(let D=0;D<c;D++){const A=(s-1-(p+D))*t+v,F=D*l*4;for(let Z=0;Z<l;Z++)u[A+Z]=S[F+Z*4]}}return u}function za(e,t,n){let s=e;for(let u=0;u<n;u++){const l=s.length;if(l<3)return s;const c=[];c.push(s[0]);const g=l-1;for(let d=0;d<g;d++){const P=s[d],w=s[(d+1)%l];c.push([P[0]*.75+w[0]*.25,P[1]*.75+w[1]*.25],[P[0]*.25+w[0]*.75,P[1]*.25+w[1]*.75])}c.push(s[l-1]),s=c}return s}function Ra(e,t){let n=0,s=0;for(const v of e)v.length<2||(n+=v.length,s+=v.length-1);const u=new Float32Array(n*6),l=new Float32Array(n*6),c=new Float32Array(n*6),g=new Float32Array(n*2),d=new Uint32Array(s*6),P=(v,S,D)=>{const A=Math.cos(D[1]*he),F=t*A*Math.cos(D[0]*he),Z=t*Math.sin(D[1]*he),Et=-t*A*Math.sin(D[0]*he);v[S]=F,v[S+1]=Z,v[S+2]=Et,v[S+3]=F,v[S+4]=Z,v[S+5]=Et};let w=0,p=0;for(const v of e){const S=v.length;if(S<2)continue;const D=w;for(let A=0;A<S;A++)P(u,w*3,v[A]),P(l,w*3,v[Math.max(0,A-1)]),P(c,w*3,v[Math.min(S-1,A+1)]),g[w]=-1,g[w+1]=1,w+=2;for(let A=0;A<S-1;A++){const F=D+A*2;d[p++]=F,d[p++]=F+1,d[p++]=F+2,d[p++]=F+1,d[p++]=F+3,d[p++]=F+2}}return{pos:u,prev:l,next:c,side:g,idx:d}}const Ea=(e,t)=>Math.abs(e[0])>179.99&&Math.abs(t[0])>179.99||Math.abs(e[0]-t[0])>180;function Na(e){const t=[];for(const n of e){let s=[];const u=()=>{s.length>1&&t.push(za(s,!1,2)),s=[]};for(let l=0;l<n.length;l++){const c=n[l];l>0&&Ea(n[l-1],c)&&u(),s.push(c)}u()}return t}function Dn(e,t){return Pa(e,t,(n,s)=>{const u=document.createElement("canvas");return u.width=n,u.height=s,u})}function Ia(e,t){const n=()=>Dn(e,t);return new Promise((s,u)=>{const l=()=>{try{s(n())}catch(d){u(d)}};let c=null;try{c=typeof Worker>"u"||typeof OffscreenCanvas>"u"?null:new Worker(new URL(""+new URL("landWorker-DHGK1Q2m.js",import.meta.url).href,import.meta.url),{type:"module"})}catch{c=null}if(!c)return l();const g=()=>c?.terminate();c.onmessage=d=>{g(),d.data.data?s(d.data.data):l()},c.onerror=d=>{d.preventDefault(),g(),l()},c.postMessage({land:e,w:t})})}function Ta(e,t){return e>=8192&&!t?8192:4096}function ka(){try{const t=document.createElement("canvas").getContext("webgl2");return t?.getExtension("WEBGL_lose_context")?.loseContext(),!!t}catch{return!1}}const We=360,Da=.8,_a=.7,Fn=1024,Wa=1.0003,Oa=1.0011,Oe=1.0016,Ft=1.0024,qt=.28,Be=10,Ba={operating:"6 5",positioning:Yt.positioning.dash,ferry:Yt.ferry.dash,deadhead:Yt.deadhead.dash},Pn=new WeakMap,nt={frames:0,avgMs:0,maxMs:0,landMs:0,reset(){this.frames=0,this.avgMs=0,this.maxMs=0},aim:null};globalThis.__bhGlobe=nt;const Rt=e=>typeof document<"u"?getComputedStyle(document.documentElement).getPropertyValue(e):"",H=(e,t=[1,1,1,1])=>{const n=/^var\((--[\w-]+)\)$/.exec(e.trim());return je(n?Rt(n[1]):e,t)};function zn(e){const t=e!=="light",n=je(Rt("--map-night-rgb"),[.01,.02,.06,1]),s=Number.parseFloat(Rt("--map-night-a")),u=H("var(--map-coast)",[.47,.63,.9,.28]),l=c=>t?c:[c[0]*.93,c[1]*.95,c[2]*.98,c[3]];return{ocean0:l(H("var(--map-ocean-0)",[.05,.08,.16,1])),ocean1:l(H("var(--map-ocean-1)",[.02,.035,.07,1])),land0:H("var(--map-land-0)",[.1,.15,.25,1]),land1:H("var(--map-land-1)",[.07,.11,.2,1]),coast:[u[0],u[1],u[2],Math.min(1,u[3]*(t?1.9:1.5))],border:H("var(--map-border)",[.6,.7,.9,.13]),grid:H("var(--map-grid)",[.47,.59,.82,.07]),night:[n[0],n[1],n[2],Number.isFinite(s)?t?s*1.15:s*1.6:.5],atmo:t?[.36,.62,1,.62]:[.42,.6,.92,.5],glint:t?.16:.08,dayLift:t?.45:0,pin:H("var(--map-pin)",[1,1,1,1]),ring:H("var(--map-ring)",[1,1,1,1]),halo:[...je(Rt("--halo-rgb"),[.02,.035,.07,1]).slice(0,3),.85]}}function qa(e){const t=lt.useRef(null),n=lt.useRef(null),s=lt.useRef(null),u=lt.useRef(e);u.current=e;const l=lt.useRef(null),[c,g]=lt.useState(null);if(c)throw c;return lt.useEffect(()=>{const d=t.current,P=n.current,w=s.current;if(!ka()){console.info("[Block Hours] no WebGL 2 here: the Map stays flat"),u.current.onUnavailable?.();return}let p;try{p=new fo({antialias:!0,alpha:!0,powerPreference:"high-performance"})}catch(o){g(o instanceof Error?o:new Error(String(o)));return}const v=Io(),S=Math.min(2,window.devicePixelRatio||1);p.setPixelRatio(S),p.setClearColor(0,0),p.domElement.className="globe-canvas",d.appendChild(p.domElement);const D=p.capabilities.getMaxAnisotropy(),A=new mo,F=new ho(ge,1,.01,40),Z=u.current.g,Et=T[Z.company.homeBase];let f=Pn.get(Z)??{lon:Et?.lon??0,lat:gt(Et?.lat??30),dist:wn},Nt=null;const dt=ia(null),Jt=ua();A.add(Jt,dt);let ft=null,It=!1;const _n=async()=>{try{await To();const o=ko();if(!o||It)return;ft=ha(Ra(Na(o.borders.coordinates),Wa)),A.add(ft);const r=(C,z)=>{const N=Nt;Nt=ea(C,z,D),sa(dt.material,Nt),N?.dispose(),_=!0,$()};r(Dn(o.land,Fn),Fn);const i=performance.now(),m=Ta(p.capabilities.maxTextureSize,v&&Math.min(screen.width,screen.height)<500),h=await Ia(o.land,m);if(nt.landMs=performance.now()-i,It)return;r(h,m)}catch(o){console.error("[Block Hours] the globe could not load the world map",o)}},xe=new po(1,1),ye=new Te,we=new Te,be=new Te;A.add(be,we,ye);const yt=Ma();A.add(yt);const te=new Map,Tt=new Map,Ve=(o,r,i)=>{let m=Tt.get(o);if(!m){const h=Aa(r,i(),D);te.set(o,h),m=La(h),Tt.set(o,m)}return m},kt=new Map,Dt=new Map,mt=new Map;let wt=[];const ht=o=>{o.mesh.removeFromParent(),o.mesh.geometry.dispose(),o.mat.dispose()},ee=(o,r,i)=>{const m=ya(),h=new zt(xa(o,Oa),m);return h.frustumCulled=!1,i.add(h),{mesh:h,key:r,mat:m}};let J=1,O=1,_t=0,bt=!1,_=!0,Me="",Mt=zn(u.current.theme),St=NaN,ne=0,qe=0,it=performance.now(),ot=[0,0],tt=null,Ke=-1;const Se=new Map;let Xe="",Ye=[],oe=[],Wt=[],Ae="",Le=new Set;const Ot=new Map;let ae=[];const Bt=new Map,se=new Map,ie=typeof matchMedia=="function"&&matchMedia("(prefers-reduced-motion: reduce)").matches;let Ce=0;const Wn=o=>k.settings.globeSpin&&!ie&&!b&&!u.current.sel&&!k.modal&&o-it>Mn,Qe=()=>{const o=d.getBoundingClientRect();J=Math.max(1,d.offsetWidth||Math.round(o.width)),O=Math.max(1,d.offsetHeight||Math.round(o.height)),p.setPixelRatio(Math.min(2.5,S*(o.width/J||1))),p.setSize(J,O,!1),F.aspect=J/O,F.updateProjectionMatrix(),_=!0,$()},$=()=>{bt||It||(bt=!0,_t=requestAnimationFrame(Je))},re=(o,r=900)=>{ot=[0,0],ie?(f=o,tt=null):tt={from:{...f},to:o,t0:performance.now(),dur:r},_=!0,$()},Ze=()=>{const o=T[k.game?.company.homeBase??""];if(!o)return;const r=Math.min(f.dist,wn),i=u.current.panelOpen?We/2:0;re({...De([o.lon,o.lat],r,O,i),dist:r})},Je=o=>{if(_t=0,It)return;if(document.visibilityState==="hidden"){bt=!1;return}const r=ne?Math.min(100,o-ne):16;ne=o;const i=k.game;if(!i){bt=!1;return}let m=!1,h=!1;if(tt){const G=(o-tt.t0)/tt.dur;f=Zo(tt.from,tt.to,G),G>=1&&(tt=null),m=!0}else ot[0]||ot[1]?(f={...f,lon:Q(f.lon+ot[0]*r),lat:gt(f.lat+ot[1]*r)},ot=Yo(ot,r),m=!0):Wn(o)&&(f={...f,lon:Q(f.lon+Qo*r/1e3)},m=!0,h=!0);m&&(_=!0);const C=gn(),z=C!==St&&!k.modal;if(!_&&!z){bt=!1,k.settings.globeSpin&&!ie&&(window.clearTimeout(Ce),Ce=window.setTimeout($,Math.max(0,Mn-(o-it))+60));return}if(_t=requestAnimationFrame(Je),(!_||h)&&v&&o-qe<1e3/30-3)return;qe=o;const N=performance.now();On(i,z||Number.isNaN(St)?C:St),St=z||Number.isNaN(St)?C:St,_=!1;const X=performance.now()-N;nt.frames++,nt.avgMs+=(X-nt.avgMs)/Math.min(nt.frames,120),nt.maxMs=Math.max(nt.maxMs,X)},On=(o,r)=>{const i=u.current;Pn.set(i.g,f);const m=ke(f);F.position.set(m[0],m[1],m[2]),F.up.set(0,1,0),F.lookAt(0,0,0);const h=$e(f.dist,O),C=Ko(f.dist,J,O);if(Me!==i.theme){Me=i.theme,Mt=zn(i.theme),ra(dt.material,Mt),da(Jt.material,Mt,i.theme!=="light"),yt.material.uniforms.uRing.value.set(...Mt.halo);for(const[a,x]of Tt)a.startsWith("cm:")&&(x.dispose(),te.get(a)?.dispose(),Tt.delete(a),te.delete(a));for(const a of mt.values())a.mesh.material=tn(a.typeId);Wt=[],oe=[]}dt.material.uniforms.uSun.value.set(...$o(r));const z=p.getPixelRatio();if(yt.material.uniforms.uDpr.value=z,dt.material.uniforms.uCoastW.value=Da*z/2,ft&&pa(ft.material,Mt.border,_a,J*z,O*z,z,Nt),Wt[0]!==i.airports||Wt[1]!==i.accent||Wt[2]!==i.sel?.id){Wt=[i.airports,i.accent,i.sel?.id];const a=H(i.accent,[.24,.9,1,1]);Sa(yt,i.airports.flatMap(x=>{const y=T[x.code];if(!y)return[];const L=x.state==="hub",E=i.sel?.kind==="airport"&&i.sel.id===x.code;return[{pos:I(y.lon,y.lat,Oe),color:L?a:Mt.pin,size:(L?11:8)+(E?4:0)}]}));for(const[x,y]of Ot)i.airports.some(L=>L.code===x)||(y.remove(),Ot.delete(x))}if(oe[0]!==i.nextArcs||oe[1]!==i.tours){oe=[i.nextArcs,i.tours];for(const a of wt)ht(a.obj);wt=[],i.tours.forEach(a=>{const x=fe(a.from,a.to);if(x.length<2)return;const y=H(a.color??"var(--map-route)");wt.push({obj:ee(x,a.id,be),st:{color:[y[0],y[1],y[2]],opacity:.75,width:1.6,before:null,after:a.dashed?[5,5]:null,split:-1}})}),i.nextArcs.forEach((a,x)=>{const y=fe(a.from,a.to);if(y.length<2)return;const L=H(a.color??"var(--map-route)");wt.push({obj:ee(y,a.id,be),st:{color:[L[0],L[1],L[2]],opacity:Math.max(.3,.6-x*.08),width:1.5,before:null,after:a.dashed?[5,5]:null,split:-1}})})}for(const a of wt)_e(a.obj.mat,a.st,h);Ke!==k.version&&(Ke=k.version,Se.clear());const N=i.sel?.kind==="aircraft"?i.sel.id:void 0,X=i.sel?.kind==="flight"?i.sel.id:void 0;ae=An(o,r);const G=new Set,q=new Set,Lt=new Map;for(const a of ae)!a.airborne&&a.at&&Lt.set(a.at,[...Lt.get(a.at)??[],a]);const Ct=new Map;for(const a of Lt.values()){const x=Do(a.map(y=>({w:Math.max(Xt(y.typeId)*C*1,26),h:Xt(y.typeId)*C})),14);a.forEach((y,L)=>Ct.set(y.id,x[L]))}Bt.clear();const Ht=[];for(const a of ae){const x=o.fleet[a.id];if(!x)continue;G.add(a.id);let y=kt.get(a.id);if(!y||y.typeId!==a.typeId){y&&(y.mesh.removeFromParent(),y.label.remove());const M=Ve(`own:${a.typeId}`,a.typeId,()=>jo(Ho(a.typeId))),j=new zt(xe,M);j.matrixAutoUpdate=!1,j.frustumCulled=!1,ye.add(j);const R=document.createElement("span");R.className="gl-reg",P.appendChild(R),y={mesh:j,typeId:a.typeId,label:R,dim:Xt(a.typeId)},kt.set(a.id,y)}const L=_o(x.reg,o.company.regPrefix);y.label.textContent!==L&&(y.label.textContent=L);const E=I(a.pos[0],a.pos[1]);let W=E,$t;if(a.airborne)$t=Ln(a.pos,a.ahead);else{const M=Ct.get(a.id)??[20,0],{east:j,north:R}=ta(a.pos);W=[E[0]+(j[0]*M[0]-R[0]*M[1])*h,E[1]+(j[1]*M[0]-R[1]*M[1])*h,E[2]+(j[2]*M[0]-R[2]*M[1])*h],$t=R}const Y=new Pt(...W).normalize(),Re=y.dim*C*Cn*h;nn(y.mesh,Y,$t,Ft,Re);const Ee=vt(W,m,0);y.mesh.visible=Ee;const et=vt(W,m,qt)?me([Y.x*Ft,Y.y*Ft,Y.z*Ft],m,J,O):null,pt=y.dim*C/2;if(et){Bt.set(a.id,{x:et.x,y:et.y,r:pt});const M=v?11:10;Ht.push({id:a.id,x:et.x,y:et.y+pt+8,w:L.length*M*.62+4,h:M+2,el:y.label,x0:et.x,y0:et.y+pt+3})}else y.label.style.display="none";if(a.airborne){const M=a.flight,j=M?`${M.id}|${M.atd??M.std+M.delay}|${M.ata??M.eta??""}|${M.to}|${M.div?.at??""}`:`show:${a.id}|${a.show.dep}`;q.add(a.id);let R=Dt.get(a.id);if(!R||R.key!==j){R&&ht(R);const vn=M?Jo(M):fe(a.show.from,a.show.to);R=ee(vn.length>1?vn:[a.pos,a.pos],j,we),Dt.set(a.id,R)}const rt=M?Bn(o,M):"operating",Ut=Yt[rt],Ne=H(Ut.color),Ie=N===a.id;_e(R.mat,{color:[Ne[0],Ne[1],Ne[2]],opacity:Ie?1:rt==="operating"?.6:.75,width:Ie?2.8:Ut.width,before:null,after:Sn(Ba[rt]),split:a.progress},h),R.mesh.renderOrder=Ie?2:1}}for(const[a,x]of kt)G.has(a)||(x.mesh.removeFromParent(),x.label.remove(),kt.delete(a));for(const[a,x]of Dt)q.has(a)||(ht(x),Dt.delete(a));const Pe=Math.floor(r/Be)*Be,mn=`${k.version}:${Pe}`;mn!==Xe&&(Xe=mn,Ye=Wo(wo(o,Pe,Pe+Be)));const hn=new Set;se.clear();for(const a of Ye){if(a.leg.dep>r||a.leg.arr<=r)continue;const x=T[a.leg.from],y=T[a.leg.to];if(!x||!y)continue;hn.add(a.id);let L=mt.get(a.id);if(!L){const R=a.leg.jet?"a320ceo":Oo(a.leg.iata,a.leg.from,a.leg.to),rt=new zt(xe,tn(R));rt.matrixAutoUpdate=!1,rt.frustumCulled=!1,ye.add(rt);const Ut=fe(a.leg.from,a.leg.to);L={mesh:rt,typeId:R,cf:a,pts:Ut,dim:a.leg.jet?22:Xt(R)*.85,arc:ee(Ut,a.id,we)},mt.set(a.id,L)}const E=bo(a,r),W=L.pts,$t=Math.min(W.length-2,Math.floor(E*(W.length-1))),Y=Gn(W,E),Re=new Pt(...I(...Y)).normalize();nn(L.mesh,Re,Ln(Y,W[$t+1]),Ft-2e-4,L.dim*C*Cn*h);const Ee=vt(I(...Y),m,0);L.mesh.visible=Ee;const et=vt(I(...Y),m,qt)?me(I(Y[0],Y[1],Ft),m,J,O):null;et&&se.set(a.id,{...et,r:L.dim*C/2});const pt=Yt.deadhead,M=H(pt.color),j=X===a.id;_e(L.arc.mat,{color:[M[0],M[1],M[2]],opacity:j?1:.8,width:j?1.8:pt.width,before:null,after:Sn(pt.dash),split:-1},h)}for(const[a,x]of mt)hn.has(a)||(x.mesh.removeFromParent(),ht(x.arc),mt.delete(a));const ze=v?12:10.5,ce=[];for(const a of i.airports){const x=T[a.code];if(!x)continue;const y=I(x.lon,x.lat,Oe),L=a.label||a.state==="hub"||i.sel?.kind==="airport"&&i.sel.id===a.code;let E=Ot.get(a.code);if(!L||!vt(y,m,qt)){E&&(E.style.display="none");continue}const W=me(y,m,J,O);W&&(E||(E=document.createElement("span"),E.className="gl-ap",E.textContent=a.code,P.appendChild(E),Ot.set(a.code,E)),E.classList.toggle("hub",a.state==="hub"),ce.push({id:`ap:${a.code}`,x:W.x,y:W.y-12,w:a.code.length*ze*.62+2,h:ze,el:E,x0:W.x,y0:W.y-12-ze/2}))}const Un=[...Ht.filter(a=>a.id===N),...ce.filter(a=>i.sel?.kind==="airport"&&a.id===`ap:${i.sel.id}`),...Ht.filter(a=>a.id!==N&&Le.has(a.id)),...ce,...Ht.filter(a=>a.id!==N&&!Le.has(a.id))],Vn=[...Bt.entries()].map(([a,x])=>({id:`d:${a}`,x:x.x,y:x.y,w:x.r*1.6,h:x.r*1.6})),pn=Bo([...Vn,...Un.filter((a,x,y)=>y.indexOf(a)===x)],1);Le=pn;for(const a of[...Ht,...ce]){const x=pn.has(a.id);a.el.style.display=x?"":"none",x&&(a.el.style.transform=`translate(${a.x0.toFixed(1)}px, ${a.y0.toFixed(1)}px) translateX(-50%)`)}const ue=N?Bt.get(N):X?se.get(X):void 0;if(ue){const a=Math.max(15,ue.r+5);w.style.display="",w.style.width=w.style.height=`${(a*2).toFixed(0)}px`,w.style.transform=`translate(${(ue.x-a).toFixed(1)}px, ${(ue.y-a).toFixed(1)}px)`}else w.style.display="none";p.render(A,F)},Bn=(o,r)=>{let i=Se.get(r.id);if(!i){try{i=Mo(o,r)}catch{i="operating"}Se.set(r.id,i)}return i},tn=o=>Ve(`cm:${o}`,o,()=>{const r=Rt("--c-mark-848ea2").trim()||"#848ea2",i=Rt("--c-line-d3d9e4").trim()||"#d3d9e4";return{fill:r,edge:i,eng:r,deck:r}}),Fe=new vo,en=new Pt,Gt=new Pt,nn=(o,r,i,m,h)=>{Gt.set(i[0],i[1],i[2]),Gt.addScaledVector(r,-Gt.dot(r)).normalize(),en.crossVectors(Gt,r),Fe.makeBasis(en.multiplyScalar(h),Gt.multiplyScalar(h),r.clone().multiplyScalar(h)),Fe.setPosition(r.x*m,r.y*m,r.z*m),o.matrix.copy(Fe),o.matrixWorldNeedsUpdate=!0},Gn=(o,r)=>{const i=Math.max(0,Math.min(1,r))*(o.length-1),m=Math.min(o.length-2,Math.floor(i)),h=I(...o[m]),C=I(...o[m+1]),z=i-m,N=[h[0]+(C[0]-h[0])*z,h[1]+(C[1]-h[1])*z,h[2]+(C[2]-h[2])*z],[X,G]=[Math.atan2(-N[2],N[0])*(180/Math.PI),Math.asin(Math.max(-1,Math.min(1,N[1]/Math.hypot(...N))))*(180/Math.PI)];return[X,G]},B=new Map;let b=null,At={t:0,x:0,y:0};const jt=o=>{const r=d.getBoundingClientRect(),i=r.width/Math.max(1,d.offsetWidth||r.width);return{x:(o.clientX-r.left)/i,y:(o.clientY-r.top)/i}},on=()=>{const o=[...B.values()];return{x:(o[0].x+o[1].x)/2,y:(o[0].y+o[1].y)/2,d:Math.hypot(o[0].x-o[1].x,o[0].y-o[1].y)}},an=o=>{if(!(o.button>0)){if(d.setPointerCapture?.(o.pointerId),B.set(o.pointerId,jt(o)),ot=[0,0],tt=null,it=performance.now(),B.size===1){const r=jt(o);b={kind:"drag",x:r.x,y:r.y,d0:0,dist0:f.dist,moved:0,t0:performance.now(),hist:[{t:performance.now(),lon:f.lon,lat:f.lat}]}}else if(B.size===2){const r=on();b={kind:"pinch",x:r.x,y:r.y,d0:r.d,dist0:f.dist,moved:99,t0:performance.now(),hist:[]}}}},sn=o=>{if(!B.has(o.pointerId)||!b)return;B.set(o.pointerId,jt(o)),it=performance.now();const r=Tn(f.dist,O);if(b.kind==="drag"&&B.size===1){const i=jt(o),m=i.x-b.x,h=i.y-b.y;b.moved+=Math.hypot(m,h),b.x=i.x,b.y=i.y,f={...f,lon:Q(f.lon-m*r/Math.max(.25,Math.cos(f.lat*Math.PI/180))),lat:gt(f.lat+h*r)};const C=performance.now();for(b.hist.push({t:C,lon:f.lon,lat:f.lat});b.hist.length>2&&C-b.hist[0].t>90;)b.hist.shift()}else if(b.kind==="pinch"&&B.size===2){const i=on();f={...f,dist:de(1+(b.dist0-1)*(b.d0/Math.max(10,i.d)))};const m=i.x-b.x,h=i.y-b.y;b.x=i.x,b.y=i.y,f={...f,lon:Q(f.lon-m*r/Math.max(.25,Math.cos(f.lat*Math.PI/180))),lat:gt(f.lat+h*r)}}_=!0,$()},le=o=>{if(!B.has(o.pointerId))return;const r=jt(o);if(B.delete(o.pointerId),it=performance.now(),!!b){if(b.kind==="drag"&&B.size===0){const i=performance.now();if(b.moved<9&&i-b.t0<450&&o.type==="pointerup")jn(r.x,r.y,o.pointerType!=="mouse");else{const m=b.hist.filter(h=>i-h.t<90);if(m.length>=2&&!ie){const h=m[0],C=m[m.length-1],z=Math.max(16,i-h.t);ot=[Q(C.lon-h.lon)/z,(C.lat-h.lat)/z]}}b=null}else if(B.size===1){const i=[...B.values()][0];b={kind:"drag",x:i.x,y:i.y,d0:0,dist0:f.dist,moved:99,t0:performance.now(),hist:[]}}else B.size===0&&(b=null);_=!0,$()}},rn=o=>{o.preventDefault(),it=performance.now(),tt=null,f={...f,dist:de(1+(f.dist-1)*Math.exp(o.deltaY*(o.ctrlKey?.01:.0015)))},_=!0,$()},jn=(o,r,i)=>{const m=i?xn.touch:xn.mouse;if(!k.game)return;const C=ke(f),z=[];for(const[G,q]of Bt)z.push({x:q.x,y:q.y,item:{kind:"aircraft",id:G}});for(const[G,q]of se)z.push({x:q.x,y:q.y,item:{kind:"flight",id:G}});for(const G of u.current.airports){const q=T[G.code];if(!q)continue;const Lt=I(q.lon,q.lat,Oe);if(!vt(Lt,C,qt))continue;const Ct=me(Lt,C,J,O);Ct&&z.push({x:Ct.x,y:Ct.y,item:{kind:"airport",id:G.code}})}const N=Go(z,o,r,m),X=performance.now();if(N){k.select(N),At={t:0,x:o,y:r};return}if(X-At.t<340&&Math.hypot(o-At.x,r-At.y)<30){At={t:0,x:o,y:r},Ze();return}At={t:X,x:o,y:r},k.nav.sel&&k.select(void 0)};d.addEventListener("pointerdown",an),d.addEventListener("pointermove",sn),d.addEventListener("pointerup",le),d.addEventListener("pointercancel",le),d.addEventListener("wheel",rn,{passive:!1});const ln=new ResizeObserver(Qe);ln.observe(d);const cn=()=>{document.visibilityState==="visible"&&(ne=0,_=!0,$())};document.addEventListener("visibilitychange",cn);const Hn=k.subscribe(()=>{_=!0,$()}),$n=k.subscribeClock($),un=o=>{o.preventDefault(),bt=!1,cancelAnimationFrame(_t)},dn=()=>{_=!0,Me="",$()};p.domElement.addEventListener("webglcontextlost",un),p.domElement.addEventListener("webglcontextrestored",dn),l.current={kick:()=>{_=!0,$()},zoom:o=>{it=performance.now();const r={...f,dist:de(1+(f.dist-1)*o)},i=fn(u.current.sel);if(i&&o<1&&vt(I(...i),ke(f),qt)){const m=1-(r.dist-1)/(f.dist-1),h=De(i,r.dist,O,u.current.panelOpen?We/2:0);r.lon=Q(f.lon+Q(h.lon-f.lon)*m),r.lat=gt(f.lat+(h.lat-f.lat)*m)}re(r,350)},home:()=>{it=performance.now(),Ze()},propsChanged:()=>{const o=u.current,r=o.sel?`${o.sel.kind}:${o.sel.id}`:"";if(r!==Ae){Ae=r;const i=fn(o.sel);if(i){const m=[f.lon,f.lat],h=Math.acos(1/f.dist)*180/Math.PI;Ue(m,i)>h*.55&&re({...De(i,f.dist,O,o.panelOpen?We/2:0),dist:f.dist})}}_=!0,$()}};const fn=o=>{if(!o)return null;if(o.kind==="aircraft"){const r=ae.find(i=>i.id===o.id)??(k.game?An(k.game,gn()).find(i=>i.id===o.id):void 0);return r?r.pos:null}if(o.kind==="airport"){const r=T[o.id];return r?[r.lon,r.lat]:null}if(o.kind==="flight"){const r=mt.get(o.id);if(r){const i=T[r.cf.leg.to];return i?[i.lon,i.lat]:null}}return null};return nt.aim=(o,r,i)=>re({lon:Q(o),lat:gt(r),dist:de(i??f.dist)},600),Ae=u.current.sel?`${u.current.sel.kind}:${u.current.sel.id}`:"",Qe(),_n(),()=>{It=!0,l.current=null,nt.aim=null,cancelAnimationFrame(_t),window.clearTimeout(Ce),ln.disconnect(),d.removeEventListener("pointerdown",an),d.removeEventListener("pointermove",sn),d.removeEventListener("pointerup",le),d.removeEventListener("pointercancel",le),d.removeEventListener("wheel",rn),document.removeEventListener("visibilitychange",cn),p.domElement.removeEventListener("webglcontextlost",un),p.domElement.removeEventListener("webglcontextrestored",dn),Hn(),$n();for(const o of wt)ht(o.obj);for(const o of Dt.values())ht(o);for(const o of mt.values())ht(o.arc);for(const o of kt.values())o.label.remove();for(const o of Ot.values())o.remove();for(const o of Tt.values())o.dispose();for(const o of te.values())o.dispose();xe.dispose(),dt.geometry.dispose(),dt.material.dispose(),Jt.geometry.dispose(),Jt.material.dispose(),ft&&(ft.geometry.dispose(),ft.material.dispose()),yt.geometry.dispose(),yt.material.dispose(),Nt?.dispose(),A.clear(),p.dispose(),p.forceContextLoss(),p.domElement.remove()}},[]),lt.useEffect(()=>{l.current?.propsChanged()},[e.sel?.kind,e.sel?.id,e.airports,e.nextArcs,e.tours,e.theme,e.accent,e.panelOpen,e.g]),U.jsxs("div",{className:"globe-view",children:[U.jsx("div",{className:"globe-stage",ref:t}),U.jsx("div",{className:"globe-labels",ref:n,"aria-hidden":!0,children:U.jsx("div",{className:"gl-sel",ref:s,style:{display:"none"}})}),U.jsxs("div",{className:"map-zoom globe-zoom",children:[U.jsx("button",{className:"btn btn-icon btn-sm",onClick:e.onFlat,"aria-label":"Flat map",title:"Flat map",children:U.jsx(Xn,{})}),U.jsx("button",{className:"btn btn-icon btn-sm",onClick:()=>l.current?.zoom(1/1.8),"aria-label":"Zoom in",children:U.jsx(Yn,{})}),U.jsx("button",{className:"btn btn-icon btn-sm",onClick:()=>l.current?.zoom(1.8),"aria-label":"Zoom out",children:U.jsx(Qn,{})}),U.jsx("button",{className:"btn btn-icon btn-sm",onClick:()=>l.current?.home(),"aria-label":"Home base",title:"Home base",children:U.jsx(Zn,{})})]})]})}export{qa as default};
