import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';
import FadeContent from './components/FadeContent';
import ShapeGrid from './components/ShapeGrid';
import StarBorder from './components/StarBorder';
import WebThreads from './components/WebThreads';
import SpotlightCard from './components/SpotlightCard';

// WebThreads needs WebGL2; without it the hero falls back to the 2D ShapeGrid
const HAS_WEBGL2 = (() => {
  try {
    return Boolean(document.createElement('canvas').getContext('webgl2'));
  } catch {
    return false;
  }
})();

const REPO_URL = 'https://github.com/sandeepkrishnams/github-claude-mod';
const INSTALL = '/plugin install accounts-band --marketplace sandeepkrishnams/github-claude-mod';

// Same hues as hooks/register.tsx
const C = {
  green: '#3FB950',
  blue: '#58A6FF',
  purple: '#A371F7',
  orange: '#F0883E',
  yellow: '#D29922',
  idle: '#8B949E'
} as const;

type Repo = { name: string; branch: string; ahead: number; behind: number; dirty: number };

// Sample data only
const REPOS: Repo[] = [
  { name: 'api', branch: 'develop', ahead: 2, behind: 0, dirty: 3 },
  { name: 'web', branch: 'main', ahead: 0, behind: 1, dirty: 0 },
  { name: 'mobile', branch: 'develop', ahead: 0, behind: 0, dirty: 0 }
];

const GitHubMark = ({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 16 16" focusable="false">
    <path
      fill={color}
      d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
    />
  </svg>
);


const Count = ({ glyph, value, color, label }: { glyph: string; value: number; color: string; label: string }) =>
  value ? (
    <span className="count" style={{ color }}>
      <span aria-hidden="true">{glyph}</span>
      {value}
      <span className="sr-only"> {label}</span>
    </span>
  ) : null;

const Action = ({ glyph, name, color, className }: { glyph: string; name: string; color?: string; className?: string }) => (
  <span className={`act ${className ?? ''}`} data-tip={name} style={color ? { color } : undefined}>
    <span aria-hidden="true">{glyph}</span>
    <span className="sr-only">{name}</span>
  </span>
);

// Band segments in left-to-right order; PARTS below follows the same order
const ACCOUNT = 0;
const TABS = 1;
const COUNTS = 2;
const BRANCH = 3;
const SYNC = 4;
const REFRESH = 5;
const HIDE = 6;

/**
 * The band row. Repo tabs are real buttons that change the selection.
 * `focus` dims every segment except one (used by the anatomy walk-through).
 */
function Band({ focus, label }: { focus?: number; label: string }) {
  const [selected, setSelected] = useState(0);
  const repo = REPOS[selected];
  const seg = (i: number) => (focus === undefined ? 'seg' : focus === i ? 'seg is-on' : 'seg is-dim');

  return (
    <div className="band" role="group" aria-label={label}>
      <div className="band__left">
        <span className={`band__who ${seg(ACCOUNT)}`} data-seg={ACCOUNT}>
          <GitHubMark size={14} color={C.idle} />
          <span aria-hidden="true" style={{ color: C.green }}>●</span>
          <span className="band__account">
            octo-dev <span aria-hidden="true">▾</span>
            <span className="sr-only"> (account dropdown)</span>
          </span>
        </span>
        {REPOS.map((r, i) => (
          <span className="tab" key={r.name}>
            <span className={`tab__name ${seg(TABS)}`} data-seg={i === 0 ? TABS : undefined}>
              {i === selected ? (
                <span aria-hidden="true" style={{ color: C.orange }}>▸</span>
              ) : null}
              <button
                type="button"
                className="tab__button"
                aria-pressed={i === selected}
                onClick={() => setSelected(i)}
              >
                {r.name}
              </button>
            </span>
            <span className={`tab__counts ${seg(COUNTS)}`} data-seg={i === 0 ? COUNTS : undefined}>
              <Count glyph="↑" value={r.ahead} color={C.green} label="ahead" />
              <Count glyph="↓" value={r.behind} color={C.blue} label="behind" />
              <Count glyph="●" value={r.dirty} color={C.yellow} label="uncommitted" />
            </span>
          </span>
        ))}
      </div>
      <div className="band__right">
        <span className={`band__branch ${seg(BRANCH)}`} data-seg={BRANCH}>
          <span aria-hidden="true" style={{ color: C.purple }}>⎇</span>
          <span aria-live="polite">
            {repo.branch} <span aria-hidden="true">▾</span>
            <span className="sr-only"> (branch dropdown)</span>
          </span>
        </span>
        <span className={`band__sync ${seg(SYNC)}`} data-seg={SYNC}>
          <Action glyph="⇣" name="pull" color={C.green} />
          <Action glyph="⇡" name="push" color={C.blue} />
        </span>
        <Action glyph="⟳" name="fetch & refresh" color={C.purple} className={seg(REFRESH)} />
        <Action glyph="×" name="hide" className={seg(HIDE)} />
      </div>
    </div>
  );
}

/** The hero visual: the band sitting on a mock prompt box. Tilts flat as it scrolls in. */
function BandMock() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'start 0.3'] });
  const rotateX = useTransform(scrollYProgress, [0, 1], [26, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [0.86, 1]);
  const y = useTransform(scrollYProgress, [0, 1], [60, 0]);

  return (
    <div className="stage" ref={ref}>
      <motion.div className="stage__tilt" style={reduce ? undefined : { rotateX, scale, y }}>
        <SpotlightCard
          className="mock"
          spotlightColor="rgba(240, 136, 62, 0.18)"
          spotlightSize={480}
          intensity={0.6}
          borderGlow={0.5}
          style={
            {
              '--spotlight-card-surface': '#111117',
              '--spotlight-card-border': '#34333f'
            } as CSSProperties
          }
        >
          <figure className="mock__figure">
            <div className="band-scroll">
              <Band label="accounts-band sample" />
            </div>
            <div className="prompt" aria-hidden="true">
              <span>Reply to Claude…</span>
              <span className="prompt__send">↑</span>
            </div>
            <figcaption className="sr-only">
              A sample of the band: account dropdown octo-dev, repo tabs api, web and mobile, and the selected
              repo's branch dropdown with pull, push, refresh and hide.
            </figcaption>
          </figure>
        </SpotlightCard>
      </motion.div>
      <p className="mock__hint">Try the repo tabs. Sample names, not a live account.</p>
    </div>
  );
}


/** Sticky band on top; each step below lights up its segment as it reaches the middle of the screen. */
function Anatomy() {
  const [active, setActive] = useState(0);
  const steps = useRef<(HTMLLIElement | null)[]>([]);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const io = new IntersectionObserver(
      entries => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.i));
      },
      { rootMargin: '-45% 0px -45% 0px' }
    );
    steps.current.forEach(el => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  // On narrow screens the band scrolls sideways: bring the lit segment into view
  useEffect(() => {
    const box = scroller.current;
    const el = box?.querySelector<HTMLElement>(`[data-seg="${active}"]`) ?? box?.querySelector<HTMLElement>('.seg.is-on');
    if (!box || !el || box.scrollWidth <= box.clientWidth) return;
    const left = el.offsetLeft - box.clientWidth / 2 + el.offsetWidth / 2;
    box.scrollTo({ left, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [active]);

  return (
    <div className="anatomy">
      <div className="anatomy__pin">
        <div className="anatomy__band band-scroll" ref={scroller}>
          <Band focus={active} label="accounts-band, highlighted part by part" />
        </div>
      </div>
      <ol className="anatomy__steps">
        {PARTS.map((p, i) => (
          <li
            key={p.name}
            data-i={i}
            ref={el => {
              steps.current[i] = el;
            }}
            className={`step ${i === active ? 'is-on' : ''}`}
          >
            <span className="step__num">{String(i + 1).padStart(2, '0')}</span>
            <span className="step__glyph" aria-hidden="true">
              {p.glyph}
            </span>
            <h3 className="step__name">{p.name}</h3>
            <p className="step__text">{p.text}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

const PARTS: { glyph: ReactNode; name: string; text: string }[] = [
  {
    glyph: (
      <>
        <span style={{ color: C.green }}>●</span> octo-dev ▾
      </>
    ),
    name: 'Account',
    text: 'A dropdown of your signed-in gh accounts; ● marks the ones that can reach the project’s repos.'
  },
  {
    glyph: (
      <>
        <span style={{ color: C.orange }}>▸</span> api
      </>
    ),
    name: 'Repo tabs',
    text: 'One tab per repo: the one the session is in and every separate repo nested up to 3 folders down. ▸ marks the selected tab.'
  },
  {
    glyph: (
      <>
        <span style={{ color: C.green }}>↑2</span> <span style={{ color: C.blue }}>↓1</span>{' '}
        <span style={{ color: C.yellow }}>●3</span>
      </>
    ),
    name: 'Counts',
    text: 'Commits ahead, commits behind, uncommitted files. Shown only when not zero.'
  },
  {
    glyph: (
      <>
        <span style={{ color: C.purple }}>⎇</span> develop ▾
      </>
    ),
    name: 'Branch',
    text: 'A dropdown of the repo’s branches, most recent first. Won’t switch over uncommitted changes.'
  },
  {
    glyph: (
      <>
        <span style={{ color: C.green }}>⇣</span> <span style={{ color: C.blue }}>⇡</span>
      </>
    ),
    name: 'Pull · push',
    text: 'Fast-forward pull and push for the selected repo.'
  },
  {
    glyph: <span style={{ color: C.purple }}>⟳</span>,
    name: 'Refresh',
    text: 'Fetches every remote of the selected repo, then re-reads accounts and repos.'
  },
  { glyph: '×', name: 'Hide', text: 'Tucks the band away.' }
];

const FEATURES: { glyph: string; color: string; title: string; text: string }[] = [
  {
    glyph: '●',
    color: C.green,
    title: 'Picks the right account',
    text: 'Opening a project switches to the account you last picked there, or else to one that can push to its GitHub repo.'
  },
  {
    glyph: '▸',
    color: C.orange,
    title: 'Child repos as tabs',
    text: 'Monorepo-ish folders with separate repos inside get a tab each, counts included.'
  },
  {
    glyph: '⎇',
    color: C.purple,
    title: 'Branch, pull, push in one click',
    text: 'Switch branch or sync the selected repo without typing a git command or leaving Claude.'
  },
  {
    glyph: '⊘',
    color: C.blue,
    title: 'Hides what you can’t reach',
    text: 'A repo the active account can’t read is left out, so the tabs match what you can work on.'
  }
];

function CopyCommand() {
  const [status, setStatus] = useState('');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL);
      setStatus('Copied');
    } catch {
      setStatus('Copy failed, select the text instead');
    }
    window.setTimeout(() => setStatus(''), 2000);
  };

  return (
    <div className="cmd">
      <code className="cmd__text">
        <span className="cmd__prompt" aria-hidden="true">&gt;</span> {INSTALL}
      </code>
      <button type="button" className="cmd__copy" onClick={copy} aria-label="Copy install command">
        {status === 'Copied' ? 'copied' : 'copy'}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {status}
      </span>
    </div>
  );
}


const Chapter = ({ title, id }: { title: ReactNode; id: string }) => (
  <h2 id={id} className="chapter__title">
    {title}
  </h2>
);

export default function App() {
  return (
    <>
      <div className="bg" aria-hidden="true">
        {HAS_WEBGL2 ? (
          <WebThreads
            colors={['#8e8ba6', '#8a74d6', '#5f86cf']}
            coreColor="#edebf5"
            threadCount={7}
            speed={0.15}
            spread={0.2}
            brightness={0.45}
            opacity={0.6}
            glow={0.02}
            grain={0.03}
            pulseOnClick={false}
          />
        ) : (
          <ShapeGrid
            shape="square"
            cellSize={56}
            lineWidth={1}
            direction="diagonal"
            speed={0.3}
            lineColor="#1d1c27"
            hoverColor={C.purple}
            fillOpacity={0.14}
            radius={2.5}
            trail={0.7}
            glow={0.35}
            twinkle={0.4}
            clickCascade={false}
          />
        )}
      </div>

      <main>
        <section className="hero" aria-labelledby="title">
          <div className="hero__copy">
            <h1 id="title">
              Your GitHub account, one quiet row above the prompt.
            </h1>
            <p className="lede">
              A Claude Code mod that shows your <code>gh</code> account and the project&rsquo;s repos. Switch,
              pull and push without leaving the chat.
            </p>
            <StarBorder
              as="a"
              href={REPO_URL}
              className="cta"
              color={C.green}
              radius={999}
              thickness={1.5}
              duration={5}
              stars={2}
              glow={0.9}
              backgroundColor="#edebf5"
              textColor="#0b0b10"
              borderColor="#edebf5"
            >
              <GitHubMark size={24} />
              <span className="cta__text">
                <span className="cta__label">View on GitHub</span>
                <span className="cta__repo">sandeepkrishnams/github-claude-mod</span>
              </span>
              <span className="cta__arrow" aria-hidden="true">
                →
              </span>
            </StarBorder>
          </div>
        </section>

        <BandMock />

        <section className="section" aria-labelledby="shows">
          <Chapter id="shows" title={<>What the band shows, left to&nbsp;right</>} />
          <Anatomy />
        </section>

        <section className="section" aria-labelledby="features">
          <Chapter id="features" title="What it does for you" />
          <FadeContent className="features" role="list" duration={700} stagger={100}>
            {FEATURES.map(f => (
              <div key={f.title} role="listitem" className="feature">
                <h3>
                  <span aria-hidden="true" style={{ color: f.color }}>
                    {f.glyph}
                  </span>
                  {f.title}
                </h3>
                <p>{f.text}</p>
              </div>
            ))}
          </FadeContent>
        </section>

        <section className="section section--install" aria-labelledby="install">
          <Chapter id="install" title="Install" />
          <div className="install">
            <CopyCommand />
            <ol className="install__steps">
              <li>
                <span>1</span>Run it in a Claude Code terminal session.
              </li>
              <li>
                <span>2</span>Answer <kbd>y</kbd> to add the marketplace, then pick a scope.
              </li>
              <li>
                <span>3</span>Start a new session. The band appears above the prompt box.
              </li>
            </ol>
            <p className="note">
              Desktop app: click + next to the prompt box → Plugins → Add marketplace{' '}
              <code>sandeepkrishnams/github-claude-mod</code> → Add plugin. Needs the GitHub CLI with your accounts
              signed in (<code>gh auth login</code>).
            </p>
          </div>
        </section>
      </main>

      <footer className="footer">
        <span>accounts-band</span>
        <span>MIT License · not affiliated with Anthropic or GitHub</span>
      </footer>
    </>
  );
}
