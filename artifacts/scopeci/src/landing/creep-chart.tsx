import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion, useInView } from '../motion';

/**
 * An illustrative fixed-price project, not customer data: twelve weeks,
 * quoted at 320 hours, with nine merged pull requests that built work the
 * statement of work excluded. The toggle shows the same project with each of
 * those pull requests flagged in review.
 */

const WEEKS = 12;
const QUOTE = 320;
const MAX_HOURS = 440;
const W = 720;
const H = 260;

/** [week merged, extra hours when it built excluded work] */
const PULLS: ReadonlyArray<readonly [number, number]> = [
  [0.4, 0], [0.9, 0], [1.3, 0], [1.7, 0], [2.2, 0], [2.6, 0], [3.0, 0], [3.2, 8], [3.6, 0],
  [4.1, 6], [4.4, 0], [4.9, 0], [5.2, 0], [5.4, 12], [5.8, 0], [6.1, 0], [6.3, 10], [6.7, 0],
  [7.0, 9], [7.3, 0], [7.8, 14], [8.1, 0], [8.4, 0], [8.6, 11], [9.0, 0], [9.3, 0], [9.5, 8],
  [9.9, 0], [10.2, 0], [10.4, 12], [10.8, 0], [11.1, 0], [11.5, 0], [11.8, 0],
];

const EXTRA = PULLS.reduce((sum, [, extra]) => sum + extra, 0);
const FLAGGED = PULLS.filter(([, extra]) => extra > 0).length;

const x = (week: number) => (week / WEEKS) * W;
const y = (hours: number) => H - 12 - (hours / MAX_HOURS) * (H - 28);
const planned = (week: number) => (QUOTE * week) / WEEKS;

/** Delivered hours step up at each pull request that added excluded work. */
function deliveredPoints(): Array<[number, number]> {
  const points: Array<[number, number]> = [[0, 0]];
  let extra = 0;
  for (const [week, hours] of PULLS) {
    if (!hours) continue;
    points.push([week, planned(week) + extra]);
    extra += hours;
    points.push([week, planned(week) + extra]);
  }
  points.push([WEEKS, planned(WEEKS) + extra]);
  return points;
}

const DELIVERED = deliveredPoints();
const toPath = (points: Array<[number, number]>) =>
  points.map(([week, hours], i) => `${i ? 'L' : 'M'}${x(week).toFixed(1)} ${y(hours).toFixed(1)}`).join(' ');
const DELIVERED_PATH = toPath(DELIVERED);
const BAND_PATH = `${DELIVERED_PATH} L${x(WEEKS)} ${y(planned(WEEKS))} L${x(0)} ${y(0)} Z`;

const pct = (value: number, of: number) => `${((value / of) * 100).toFixed(2)}%`;

type View = 'without' | 'with';

export function CreepChart() {
  const [view, setView] = useState<View>('without');
  const [ref, inView] = useInView<HTMLDivElement>('-25% 0px -25% 0px');
  const touched = useRef(false);

  // Shows the difference once, a moment after the chart is read, unless the
  // visitor has already chosen a side.
  useEffect(() => {
    if (!inView || prefersReducedMotion()) return;
    const timer = window.setTimeout(() => {
      if (!touched.current) setView('with');
    }, 2600);
    return () => window.clearTimeout(timer);
  }, [inView]);

  const choose = (next: View) => {
    touched.current = true;
    setView(next);
  };

  const flagged = view === 'with';

  return (
    <figure className={`creep ${inView ? 'is-drawn' : ''} ${flagged ? 'is-flagged' : ''}`} ref={ref}>
      <div className="creep-head">
        <p className="creep-caption">
          Hours on an illustrative 12-week fixed-price build
        </p>
        <div className="segmented" role="group" aria-label="Show the project">
          <button type="button" aria-pressed={!flagged} className={!flagged ? 'is-active' : ''} onClick={() => choose('without')}>
            Without ScopeCI
          </button>
          <button type="button" aria-pressed={flagged} className={flagged ? 'is-active' : ''} onClick={() => choose('with')}>
            With ScopeCI
          </button>
        </div>
      </div>

      <div className="creep-plot">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <pattern id="creep-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" className="creep-hatch-line" />
            </pattern>
          </defs>
          {[0, 100, 200, 300, 400].map((hours) => (
            <line key={hours} x1="0" x2={W} y1={y(hours)} y2={y(hours)} className="creep-grid" />
          ))}
          <path d={BAND_PATH} className="creep-band" />
          <path d={BAND_PATH} className="creep-band-hatch" fill="url(#creep-hatch)" />
          <line x1="0" x2={W} y1={y(QUOTE)} y2={y(QUOTE)} className="creep-quote" />
          <line x1={x(0)} y1={y(0)} x2={x(WEEKS)} y2={y(planned(WEEKS))} className="creep-planned" />
          <path d={DELIVERED_PATH} className="creep-delivered" pathLength={1} />
        </svg>

        <span className="creep-label creep-label-quote" style={{ top: pct(y(QUOTE), H) }}>
          Quoted <strong className="num">{QUOTE} h</strong>
        </span>
        <span className="creep-label creep-label-end" style={{ top: pct(y(QUOTE + EXTRA), H) }}>
          Delivered <strong className="num">{QUOTE + EXTRA} h</strong>
        </span>
        <span className="creep-label creep-label-band" style={{ top: pct(y(400), H) }}>
          <span className="creep-label-swap" data-show={!flagged}>
            <strong className="num">{EXTRA} h</strong> built, never billed
          </span>
          <span className="creep-label-swap" data-show={flagged}>
            <strong className="num">{EXTRA} h</strong> sent as change orders
          </span>
        </span>
      </div>

      <div className="creep-rug" aria-hidden="true">
        {PULLS.map(([week, extra]) => (
          <span
            key={week}
            className={`creep-tick ${extra ? 'is-out' : ''}`}
            style={{ left: pct(week, WEEKS), ['--tick-delay' as string]: `${Math.round(week * 60)}ms` }}
          />
        ))}
      </div>
      <div className="creep-axis mono" aria-hidden="true">
        <span>Week 1</span>
        <span>Week 6</span>
        <span>Week 12</span>
      </div>

      <p className="sr-only">
        {flagged
          ? `With ScopeCI, the ${FLAGGED} pull requests that built excluded work are flagged in review, and the ${EXTRA} extra hours go to the client as change orders.`
          : `Delivered hours climb to ${QUOTE + EXTRA} against a ${QUOTE}-hour quote. ${FLAGGED} of ${PULLS.length} merged pull requests built work the statement of work excluded, adding ${EXTRA} hours nobody billed.`}
      </p>
      <figcaption className="creep-legend" aria-hidden="true">
        <span><i className="legend-swatch is-delivered" />Hours delivered</span>
        <span><i className="legend-swatch is-planned" />Work the SOW covers</span>
        <span><i className="legend-swatch is-tick" />Merged pull request</span>
        <span>
          <i className="legend-swatch is-out" />
          {flagged ? `Flagged in review (${FLAGGED})` : `Built excluded work (${FLAGGED})`}
        </span>
      </figcaption>
    </figure>
  );
}
