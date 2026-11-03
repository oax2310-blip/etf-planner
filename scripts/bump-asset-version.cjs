// 세 HTML과 push-sw.js의 로컬 자산 버전을 확인하고 함께 +1 한다.
// 사용: node scripts/bump-asset-version.cjs [--check] [--root <폴더>]
const fs = require('node:fs');
const path = require('node:path');

const files = ['index.html', 'assets.html', 'valuation.html', 'push-sw.js'];

function main(args) {
  let root = path.resolve(__dirname, '..');
  let check = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--check') check = true;
    else if (args[i] === '--root' && args[i + 1] && !args[i + 1].startsWith('--')) root = path.resolve(args[++i]);
    else throw Error('사용법: node scripts/bump-asset-version.cjs [--check] [--root <폴더>]');
  }

  // 모든 파일을 읽고 검증한 뒤에만 쓴다. 버전이 섞이거나 참조가 없으면 아무것도 바꾸지 않는다.
  const snapshots = files.map(name => {
    const pattern = name === 'push-sw.js'
      ? /("js\/[^"?\r\n]+\?v=)(\d+)"/g
      : /((?:^|\s)(?:href|src)="(?:css|js)\/[^"?\r\n]+\?v=)(\d+)"/g;
    const file = path.join(root, name);
    const text = fs.readFileSync(file, 'utf8');
    const versions = [...new Set([...text.matchAll(pattern)].map(match => match[2]))];
    if (!versions.length) throw Error(`${name}: 로컬 ?v= 참조가 없습니다.`);
    return {name, file, text, pattern, versions};
  });
  const versions = [...new Set(snapshots.flatMap(snapshot => snapshot.versions))];
  if (versions.length !== 1) {
    throw Error(`버전 불일치: ${snapshots.map(({name, versions}) => `${name}=${versions.join(', ')}`).join('; ')}`);
  }

  const current = versions[0];
  if (check) {
    console.log(`${current} (일치)`);
    return;
  }
  const next = String(BigInt(current) + 1n);
  for (const {file, text, pattern} of snapshots) {
    fs.writeFileSync(file, text.replace(pattern, (_, prefix) => `${prefix}${next}"`));
  }
  console.log(`${current} → ${next}`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
