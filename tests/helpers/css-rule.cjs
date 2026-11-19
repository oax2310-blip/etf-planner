const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

// 같은 선택자가 미디어 쿼리에서 덮어써지는 경우를 구분한다. 이 저장소의 중첩 없는 CSS 선언 블록만 읽는다.
function cssRule(file, selector, media = '') {
  const css = read(file).replace(/\/\*[\s\S]*?\*\//g, ''), stack = [], rules = [];
  for (const match of css.matchAll(/([^{}]+)\{|\}/g)) {
    if (match[1] !== undefined) stack.push({selector:match[1].trim(), start:match.index + match[0].length});
    else {
      const rule = stack.pop();
      if (!rule || rule.selector.startsWith('@')) continue;
      rules.push({...rule, media:stack.map(parent => parent.selector).join(''), body:css.slice(rule.start, match.index)});
    }
  }
  const compact = value => value.replace(/\s+/g, '');
  const found = rules.filter(rule => rule.selector === selector && compact(rule.media) === compact(media));
  assert.equal(found.length, 1, `${file}: ${selector} ${media || '기본'} 규칙`);
  return Object.fromEntries(found[0].body.split(';').filter(value => value.includes(':')).map(value => {
    const colon = value.indexOf(':');
    return [value.slice(0, colon).trim(), compact(value.slice(colon + 1))];
  }));
}

module.exports = { cssRule };
