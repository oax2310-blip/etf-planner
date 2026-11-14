// Android 표준 SDK·JDK만 사용하는 선택형 APK 빌드. 기존 Pages 빌드·배포에는 연결하지 않는다.
// 플랫폼 도구는 내려받지 않으며 호출자가 설치한 API 35 / build-tools 35.0.0을 사용한다.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');

function options(args, env = process.env) {
  const result = {sdk:env.ANDROID_SDK_ROOT || env.ANDROID_HOME, jdk:env.JAVA_HOME, out:path.join(os.tmpdir(), 'etf-planner-android'), debug:false};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--debug') result.debug = true;
    else if (['--sdk', '--jdk', '--out'].includes(args[i]) && args[i+1] && !args[i+1].startsWith('--')) {
      const key = args[i].slice(2); result[key] = args[++i];
    }
    else throw Error('사용법: node android/build.cjs --sdk <SDK> [--jdk <JDK>] [--out <출력 폴더>] [--debug]');
  }
  if (!result.sdk) throw Error('Android API 35 SDK 경로를 --sdk로 지정하세요.');
  return result;
}
function files(root, extension) {
  return fs.readdirSync(root, {withFileTypes:true}).flatMap(entry => entry.isDirectory() ? files(path.join(root, entry.name), extension) : entry.name.endsWith(extension) ? [path.join(root, entry.name)] : []).sort();
}
function build(config) {
  const source = __dirname, sdk = path.resolve(config.sdk), out = path.resolve(config.out);
  const platform = path.join(sdk, 'platforms/android-35/android.jar'), tools = path.join(sdk, 'build-tools/35.0.0');
  for (const file of [platform, ...['aapt2', 'd8', 'zipalign', 'apksigner'].map(name => path.join(tools, name))])
    if (!fs.existsSync(file)) throw Error(`필요한 SDK 도구가 없습니다: ${file}`);
  const env = {...process.env};
  if (config.jdk) { env.JAVA_HOME = path.resolve(config.jdk); env.PATH = path.join(env.JAVA_HOME, 'bin') + path.delimiter + (env.PATH || ''); }
  const jdkTool = name => config.jdk ? path.join(path.resolve(config.jdk), 'bin', name) : name;
  const run = (command, args) => {
    const result = spawnSync(command, args, {stdio:'inherit', env});
    if (result.error) throw result.error;
    if (result.status !== 0) throw Error(`${path.basename(command)} 실행 실패: ${result.status}`);
  };
  fs.mkdirSync(out, {recursive:true});
  const work = fs.mkdtempSync(path.join(out, 'work-'));
  try {
    for (const dir of ['res', 'generated', 'classes', 'dex']) fs.mkdirSync(path.join(work, dir));
    fs.cpSync(path.join(source, 'res'), path.join(work, 'res'), {recursive:true});
    fs.mkdirSync(path.join(work, 'res/drawable'));
    fs.copyFileSync(path.join(source, '../icons/planner-192.png'), path.join(work, 'res/drawable/planner.png'));
    const generated = path.join(work, 'generated/io/github/oax2310blip/etfplanner');
    fs.mkdirSync(generated, {recursive:true});
    fs.writeFileSync(path.join(generated, 'BuildConfig.java'), `package io.github.oax2310blip.etfplanner; public final class BuildConfig { public static final boolean DEBUG = ${config.debug}; }\n`);
    run(path.join(tools, 'aapt2'), ['compile', '--dir', path.join(work, 'res'), '-o', path.join(work, 'resources.zip')]);
    const unaligned = path.join(work, 'app.apk');
    run(path.join(tools, 'aapt2'), ['link', '-o', unaligned, '--manifest', path.join(source, 'AndroidManifest.xml'), '-I', platform, '--java', path.join(work, 'generated'), '-A', path.join(source, 'assets'), ...(config.debug ? ['--debug-mode'] : []), path.join(work, 'resources.zip')]);
    run(jdkTool('javac'), ['--release', '8', '-classpath', platform, '-d', path.join(work, 'classes'), ...files(path.join(source, 'src'), '.java'), ...files(path.join(work, 'generated'), '.java')]);
    run(path.join(tools, 'd8'), ['--release', '--min-api', '23', '--lib', platform, '--output', path.join(work, 'dex'), ...files(path.join(work, 'classes'), '.class')]);
    run(jdkTool('jar'), ['--update', '--file', unaligned, '-C', path.join(work, 'dex'), 'classes.dex']);
    const unsigned = path.join(out, 'etf-planner-unsigned.apk');
    run(path.join(tools, 'zipalign'), ['-f', '4', unaligned, unsigned]);
    let apk = unsigned;
    if (config.debug) {
      const privateDir = path.join(out, 'private');
      fs.mkdirSync(privateDir, {recursive:true, mode:0o700});
      const key = path.join(privateDir, 'debug.keystore');
      // 알려진 Android 개발용 암호다. 실제 배포 서명키·토큰은 받거나 생성하지 않는다.
      if (!fs.existsSync(key)) run(jdkTool('keytool'), ['-genkeypair', '-keystore', key, '-storepass', 'android', '-keypass', 'android', '-alias', 'androiddebugkey', '-dname', 'CN=Android Debug,O=Android,C=US', '-validity', '10000', '-keyalg', 'RSA', '-keysize', '2048']);
      fs.chmodSync(key, 0o600);
      apk = path.join(out, 'etf-planner-debug.apk');
      run(path.join(tools, 'apksigner'), ['sign', '--ks', key, '--ks-key-alias', 'androiddebugkey', '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--v4-signing-enabled', 'false', '--out', apk, unsigned]);
      run(path.join(tools, 'apksigner'), ['verify', '--verbose', apk]);
    }
    run(path.join(tools, 'zipalign'), ['-c', '4', apk]);
    const result = {apk, sha256:crypto.createHash('sha256').update(fs.readFileSync(apk)).digest('hex'), debug:config.debug};
    fs.writeFileSync(path.join(out, 'build-result.json'), JSON.stringify(result, null, 2)+'\n');
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally { fs.rmSync(work, {recursive:true, force:true}); }
}
if (require.main === module) {
  try { build(options(process.argv.slice(2))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = {options, build};
