// 50 series x 15 Doods. Each entry is either "@Name" (a hand-built Dood from engine.js)
// or a recipe string: "Name|Class|shape|body|belly|eyes.mouth|part:arg,part,..."
// Colours are a palette digit (the theme's `pal`), a named letter (see NAMED in engine.js) or a 6-digit hex.
import t1 from './themes-1.js';
import t2 from './themes-2.js';
import t3 from './themes-3.js';
import t4 from './themes-4.js';
import t5 from './themes-5.js';
export const THEMES = [...t1, ...t2, ...t3, ...t4, ...t5];
