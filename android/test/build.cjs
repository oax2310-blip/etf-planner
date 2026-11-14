// 표준 Android Instrumentation 검증 APK. 앱 배포 산출물에는 테스트 공급자·가상 화면·글꼴을 넣지 않는다.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const {options,build}=require('../build.cjs');
try {
  const args=process.argv.slice(2),fontIndex=args.indexOf('--font');
  if(fontIndex<0||!args[fontIndex+1])throw Error('기존 PretendardVariable.woff2의 로컬 경로를 --font로 지정하세요.');
  const font=args[fontIndex+1];args.splice(fontIndex,2);
  const config=options(args);config.debug=true;build(config);
  const sdk=path.resolve(config.sdk),out=path.resolve(config.out),platform=path.join(sdk,'platforms/android-35/android.jar'),tools=path.join(sdk,'build-tools/35.0.0');
  const env={...process.env};if(config.jdk){env.JAVA_HOME=path.resolve(config.jdk);env.PATH=path.join(env.JAVA_HOME,'bin')+path.delimiter+env.PATH;}
  const jdk=name=>config.jdk?path.join(path.resolve(config.jdk),'bin',name):name;
  const run=(command,args)=>{const result=spawnSync(command,args,{stdio:'inherit',env});if(result.error)throw result.error;if(result.status!==0)throw Error(`${path.basename(command)}: ${result.status}`);};
  const work=fs.mkdtempSync(path.join(out,'test-work-'));
  try {
    for(const name of ['assets','classes','dex'])fs.mkdirSync(path.join(work,name));
    const project=path.resolve(__dirname,'../..'),header=fs.readFileSync(path.join(project,'index.html'),'utf8').match(/<header class="top">[\s\S]*?<\/header>/)[0];
    const css=fs.readFileSync(path.join(project,'css/app.css'),'utf8')+fs.readFileSync(path.join(project,'css/safe-area.css'),'utf8');
    const face=`@font-face{font-family:"Pretendard Variable";font-style:normal;font-weight:45 920;src:url(data:font/woff2;base64,${fs.readFileSync(font).toString('base64')}) format("woff2")}`;
    const cards=Array.from({length:14},(_,i)=>`<button class="plan-item ${i===0?'active':''}"><span class="plan-row"><strong>가상 종목 ${i+1}</strong><span class="plan-count">0/30</span></span></button>`).join('');
    const html=`<!doctype html><html lang="ko" data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline';script-src 'unsafe-inline';font-src data:;connect-src 'self' blob:"><style>${css}${face}.native-check{min-height:900px;margin-top:18px;padding:20px}#importFile{position:fixed;bottom:14px;left:16px;z-index:10;width:180px;min-height:44px;background:var(--surface);color:var(--text)}</style></head><body class="planner-page">${header}<main><div class="card side"><h2>화면 검증용 가상 계획</h2><div class="plan-list">${cards}</div></div><section class="card native-check"><h1>상태바 스크롤 검증</h1><p>모든 가상 계획은 대기 회차입니다.</p></section></main><input id="importFile" type="file" accept="application/json"><script>document.querySelector('#importFile').addEventListener('change',function(){var r=new FileReader();r.onload=function(){window.importedText=r.result;window.imported=true;};r.readAsText(this.files[0]);});window.fixtureReady=true;</script></body></html>`;
    fs.writeFileSync(path.join(work,'assets/fixture.html'),html);
    const unaligned=path.join(work,'test.apk');
    run(path.join(tools,'aapt2'),['link','-o',unaligned,'--manifest',path.join(__dirname,'AndroidManifest.xml'),'-I',platform,'-A',path.join(work,'assets'),'--debug-mode']);
    run(jdk('javac'),['--release','8','-encoding','UTF-8','-classpath',platform,'-d',path.join(work,'classes'),...['ChromeInstrumentation.java','TestBackupProvider.java'].map(f=>path.join(__dirname,f))]);
    const classFiles=[];function walk(dir){for(const f of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,f.name);if(f.isDirectory())walk(file);else if(file.endsWith('.class'))classFiles.push(file);}}walk(path.join(work,'classes'));
    run(path.join(tools,'d8'),['--min-api','30','--lib',platform,'--output',path.join(work,'dex'),...classFiles]);
    run(jdk('jar'),['--update','--file',unaligned,'-C',path.join(work,'dex'),'classes.dex']);
    const aligned=path.join(work,'aligned.apk'),apk=path.join(out,'etf-planner-test.apk');
    run(path.join(tools,'zipalign'),['-f','4',unaligned,aligned]);
    run(path.join(tools,'apksigner'),['sign','--ks',path.join(out,'private/debug.keystore'),'--ks-key-alias','androiddebugkey','--ks-pass','pass:android','--key-pass','pass:android','--v4-signing-enabled','false','--out',apk,aligned]);
    run(path.join(tools,'apksigner'),['verify',apk]);
    console.log(JSON.stringify({testApk:apk,sha256:crypto.createHash('sha256').update(fs.readFileSync(apk)).digest('hex')},null,2));
  } finally {fs.rmSync(work,{recursive:true,force:true});}
} catch(error){console.error(error.message);process.exitCode=1;}
