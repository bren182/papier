/**
 * The ambient "outside": blurred palette glows, a treeline and floating motes.
 * Purely decorative; it sits behind the glass surfaces and never takes input.
 */

const GLOWS = [
  { className: 'p-drift-slow', left: 860, top: -300, w: 820, h: 820, color: 'var(--p-sky)', opacity: 0.34, blur: 110 },
  { className: 'p-drift', left: 480, top: 160, w: 620, h: 620, color: 'var(--p-steel)', opacity: 0.3, blur: 100 },
  { className: 'p-drift', left: -160, top: 460, w: 760, h: 760, color: 'var(--p-olive)', opacity: 0.55, blur: 100 },
  { className: 'p-drift-slow', left: 360, top: 660, w: 960, h: 520, color: 'var(--p-walnut)', opacity: 0.9, blur: 90 },
  { className: 'p-drift', left: 1160, top: 380, w: 360, h: 360, color: 'var(--p-ash)', opacity: 0.2, blur: 90 },
];

const MOTES = [
  [1080, 560, 0], [1190, 640, 3], [1320, 600, 6.5], [980, 700, 9],
  [240, 690, 2], [120, 620, 7.5], [1400, 700, 12],
];

const PINES = [
  [300, 560, 690, 28], [344, 590, 690, 24], [980, 540, 670, 30],
  [1030, 570, 670, 26], [1076, 550, 672, 28], [1370, 560, 670, 26],
];

/** @param {{ intensity?: number }} props */
export function Backdrop({ intensity = 0.9 }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        background: '#0d0f0d',
        filter: 'var(--s-backdrop-filter)',
        transition: 'filter 600ms ease',
        pointerEvents: 'none',
      }}
    >
      {GLOWS.map((g, i) => (
        <div
          key={i}
          className={g.className}
          style={{
            position: 'absolute',
            left: g.left,
            top: g.top,
            width: g.w,
            height: g.h,
            borderRadius: '50%',
            background: g.color,
            opacity: g.opacity * intensity,
            filter: `blur(${g.blur}px)`,
          }}
        />
      ))}

      <svg
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMax slice"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      >
        <path
          d="M0 700 C 200 640, 380 690, 560 660 S 900 610, 1100 650 S 1340 630, 1440 660 L1440 900 L0 900 Z"
          fill="var(--p-steel)"
          opacity="0.14"
        />
        <g opacity="0.5" style={{ filter: 'blur(2.5px)' }} fill="#222a25">
          {PINES.map(([x, top, base, half], i) => (
            <polygon key={i} points={`${x},${top} ${x - half},${base} ${x + half},${base}`} />
          ))}
        </g>
        <path d="M0 810 C 300 770, 700 800, 1000 776 S 1300 766, 1440 786 L1440 900 L0 900 Z" fill="#161a13" />
        <g className="p-sway" style={{ transformOrigin: '1232px 800px' }}>
          <path
            d="M1226 800 L1230 620 Q1232 590 1212 560 M1230 650 Q1252 610 1280 598"
            stroke="#2a2014"
            strokeWidth="11"
            fill="none"
            strokeLinecap="round"
          />
          <circle cx="1196" cy="528" r="82" fill="#3d4530" />
          <circle cx="1272" cy="508" r="92" fill="var(--p-olive)" opacity="0.72" />
          <circle cx="1236" cy="452" r="86" fill="#56603f" />
          <circle cx="1156" cy="572" r="60" fill="#3d4530" />
          <circle cx="1316" cy="572" r="66" fill="#4a5336" />
          <circle cx="1214" cy="436" r="42" fill="var(--p-ash)" opacity="0.13" />
        </g>
        <g className="p-sway-slow" style={{ transformOrigin: '150px 810px' }}>
          <path d="M146 810 L150 660 Q152 640 138 620" stroke="#2a2014" strokeWidth="8" fill="none" strokeLinecap="round" />
          <circle cx="130" cy="600" r="58" fill="#3d4530" />
          <circle cx="182" cy="586" r="62" fill="#56603f" />
          <circle cx="154" cy="548" r="54" fill="var(--p-olive)" opacity="0.7" />
        </g>
      </svg>

      {MOTES.map(([x, y, delay], i) => (
        <div
          key={i}
          className="p-mote"
          style={{
            position: 'absolute',
            left: `${(x / 1440) * 100}%`,
            top: `${(y / 900) * 100}%`,
            width: 4,
            height: 4,
            borderRadius: '50%',
            background: 'var(--p-ash)',
            boxShadow: '0 0 10px 2px rgb(191 210 191 / 0.45)',
            animationDelay: `${delay}s`,
          }}
        />
      ))}
    </div>
  );
}
