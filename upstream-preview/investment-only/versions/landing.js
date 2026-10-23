import { createArchiveScene, initLiquidBalance } from './archive.js';
'use strict';
// Native scrolling remains available with or without JavaScript.
for (const host of document.querySelectorAll('[data-archive-scene]')) host.append(createArchiveScene({density:host.dataset.archiveScene}));
const copy = document.querySelector('.story-copy');
const next = document.querySelector('.story-next');
const flip = document.querySelector('.coin-flip');
const glyph = document.querySelector('.coin-glyph');
const ridges = document.querySelector('.coin-edge-ridges');
const story = document.querySelector('.scroll-story');
const coin = document.querySelector('#coin');
const spine = document.querySelector('#k-spine');
const arms = document.querySelector('#k-arms');
const upper = document.querySelector('#k-upper');
const lower = document.querySelector('#k-lower');
const material = document.querySelector('.coin-material');
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const upperStart = [104,200,136,174,168,148,200,122,232,96,264,70,296,44];
const lowerStart = [104,200,136,226,168,252,200,278,232,304,264,330,296,356];
const upperEnd = [200,52,281.738,52,348,118.262,348,200,348,281.738,281.738,348,200,348];
const lowerEnd = [200,348,118.262,348,52,281.738,52,200,52,118.262,118.262,52,200,52];
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
function morphPath(start, end, progress) {
  const v = start.map((value, index) => (value + (end[index] - value) * progress).toFixed(3));
  return `M${v[0]} ${v[1]}C${v.slice(2,8).join(' ')}C${v.slice(8).join(' ')}`;
}
let pending = false;
function render() {
  pending = false;
  const rect = story.getBoundingClientRect();
  const stageHeight = story.firstElementChild.offsetHeight;
  const progress = motion.matches ? 0 : clamp(-rect.top / Math.max(1, rect.height - stageHeight));
  // Mutually exclusive title intervals remain deterministic in both directions.
  for (const [element, opacity] of [[copy,1-smooth(progress/.18)],[next,smooth((progress-.31)/.17)]]) {
    element.style.opacity=opacity;
    element.style.visibility=opacity===0?'hidden':'visible';
    element.setAttribute('aria-hidden',String(opacity===0));
  }
  // Form the coin at the left before allowing any rightward travel.
  const forming = smooth((progress - .06) / .38);
  const rounding = smooth((progress - .16) / .28);
  const travel = smooth((progress - .54) / .46);
  const width = document.documentElement.clientWidth;
  const size = coin.offsetWidth;
  const startCenter = coin.offsetLeft + size / 2;
  const endCenter = width - Math.max(28, width * .08) - size * .34 * Math.SQRT2 / 2;
  const travelDistance = Math.max(0, endCenter - startCenter);
  story.style.setProperty('--progress', progress);
  upper.setAttribute('d', morphPath(upperStart, upperEnd, rounding));
  lower.setAttribute('d', morphPath(lowerStart, lowerEnd, rounding));
  arms.setAttribute('transform', `rotate(${forming * 360} 200 200)`);
  arms.setAttribute('stroke-width', 58 - rounding * 38);
  spine.style.opacity = 1 - smooth((progress - .20) / .19);
  material.style.opacity = smooth((progress - .30) / .14);
  const angle = travel * 360;
  const side = (angle>=60 && angle<=120) || (angle>=240 && angle<=300);
  const formed = smooth((progress-.30)/.14);
  flip.style.transform = 'rotateY('+angle+'deg)';
  glyph.style.opacity = side ? 0 : formed;
  glyph.style.visibility = side || !formed ? 'hidden' : 'visible';
  // The independent glyph remains upright and never gets horizontally squeezed.
  glyph.style.transform = 'rotate('+(-travel*360)+'deg)';
  ridges.style.opacity = formed * Math.abs(Math.sin(angle*Math.PI/180));
  coin.dataset.flipAngle = angle.toFixed(3);
  story.querySelector('.archive-scene')?.style.setProperty('--archive-parallax',motion.matches?'0px':(-progress*18)+'px');
  coin.style.transform = `translate3d(${travel * travelDistance}px,${-travel * 90}px,0) scale(${1 - travel * .66}) rotate(${travel * 360}deg)`;
}
function schedule() { if (!pending) { pending = true; requestAnimationFrame(render); } }
addEventListener('scroll', schedule, {passive:true});
addEventListener('resize', schedule);
motion.addEventListener('change', schedule);
document.documentElement.classList.add('motion-ready');
render();

initLiquidBalance(document.querySelector('.feature-grid'));
