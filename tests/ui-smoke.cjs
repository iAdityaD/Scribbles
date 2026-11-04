// Run after npm run export:mobile and npx playwright install chromium.
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const http=require('node:http');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
 const {createGameServer}=await import(pathToFileURL(path.join(root,'apps/server/src/server.ts')).href);
 const server=createGameServer();await new Promise(r=>server.http.listen(3001,'127.0.0.1',r));
 const dist=path.join(root,'apps/mobile/dist');
 const web=http.createServer((req,res)=>{
  const filename=path.resolve(dist,'.'+(req.url==='/'?'/index.html':decodeURIComponent(req.url.split('?')[0])));
  if(!filename.startsWith(dist+path.sep)||!fs.existsSync(filename)||!fs.statSync(filename).isFile()){res.statusCode=404;res.end();return;}
  const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.ttf':'font/ttf','.png':'image/png'};
  res.setHeader('Content-Type',mime[path.extname(filename)]||'application/octet-stream');fs.createReadStream(filename).pipe(res);
 });await new Promise(r=>web.listen(8081,'127.0.0.1',r));
 const customArgs=process.env.PLAYWRIGHT_SERVERLESS_MODULE?require(process.env.PLAYWRIGHT_SERVERLESS_MODULE).default.args:['--no-sandbox'];
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined,args:customArgs});
 const screenshots=process.env.UI_SCREENSHOT_DIR||fs.mkdtempSync(path.join(require('node:os').tmpdir(),'scribbles-ui-'));
 fs.mkdirSync(screenshots,{recursive:true});const errors=[];
 try{
  const pages=[];
  for(const name of ['Alice','Bob']){
   const context=await browser.newContext({viewport:{width:390,height:844}});
   await context.addInitScript(name=>localStorage.setItem('scribbles.profile',JSON.stringify({name,avatar:name==='Alice'?1:2})),name);
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:8081');await page.getByText('Ready when you are').waitFor();pages.push(page);
  }
  const [a,b]=pages;
  const wordList=['mountain','rainbow','bicycle','pizza','castle','guitar','rocket','snowman','umbrella','lighthouse','campfire','waterfall','island','airplane','suitcase','bridge','volcano','camera','robot','pirate'];
  await a.getByRole('button',{name:'Word sets',exact:true}).click();await a.getByRole('button',{name:'New word set',exact:true}).click();
  await a.getByLabel('Word set name',{exact:true}).fill('Weekend words');await a.getByLabel('Words in this set',{exact:true}).fill(wordList.slice(0,19).join('\n'));
  assert.equal(await a.getByRole('button',{name:'Save word set',exact:true}).isDisabled(),true);
  await a.getByLabel('Words in this set',{exact:true}).fill(wordList.join('\n'));await a.getByRole('button',{name:'Save word set',exact:true}).click();
  await a.getByRole('button',{name:'Use Weekend words',exact:true}).waitFor();await a.getByRole('button',{name:'Close word sets',exact:true}).click();
  await a.reload();await a.getByText('Ready when you are').waitFor();await a.getByRole('button',{name:'Word sets',exact:true}).click();await a.getByRole('button',{name:'Use Weekend words',exact:true}).click();
  await a.getByRole('button',{name:'Select word set',exact:true}).click();await a.getByRole('button',{name:'Select Weekend words',exact:true}).click();
  await a.getByRole('button',{name:'Decrease Rounds',exact:true}).click();await a.getByRole('button',{name:'Decrease Rounds',exact:true}).click();
  await a.getByRole('button',{name:'More game options',exact:true}).click();await a.getByRole('button',{name:'Decrease Word choices',exact:true}).click();
  await a.screenshot({path:path.join(screenshots,'custom-room.png')});
  await a.getByRole('button',{name:'Create private room',exact:true}).click();await a.getByText('Room lobby').waitFor();
  const room=[...server.store.rooms.values()][0];assert.equal(room.settings.rounds,1);assert.equal(room.settings.mode,'custom');assert.equal(room.settings.wordSetName,'Weekend words');assert.equal(room.settings.customWords.length,20);assert.equal(room.settings.wordChoices,2);
  await b.getByRole('button',{name:'Join with a code',exact:true}).click();await b.context().grantPermissions(['clipboard-read','clipboard-write']);
  await b.evaluate(code=>navigator.clipboard.writeText('Join my room: '+code+'\nscribbles://join/'+code),room.code);
  await b.getByRole('button',{name:'Paste invite',exact:true}).click();await b.waitForFunction(code=>document.querySelector('[aria-label="Room code"]')?.value===code,room.code);await b.getByRole('button',{name:'Join the room',exact:true}).click();await b.getByText('Room lobby').waitFor();
  const bobId=room.members.find(m=>m.name==='Bob').id;await b.reload();await b.getByText('Room lobby').waitFor();assert.equal(room.members.find(m=>m.name==='Bob').id,bobId);assert.equal(room.members.length,2);
  await b.getByRole('button',{name:'I’m ready',exact:true}).click();await a.screenshot({path:path.join(screenshots,'custom-lobby.png')});await a.getByRole('button',{name:'Start game',exact:true}).click();await a.getByText('Pick your masterpiece').waitFor();
  assert.equal(room.choices.length,2);assert.ok(room.choices.every(w=>wordList.includes(w)));
  await a.getByText(room.choices[0],{exact:true}).click();await a.getByLabel('Drawing canvas. Draw with your finger.',{exact:true}).waitFor();
  const box=await a.getByLabel('Drawing canvas. Draw with your finger.',{exact:true}).boundingBox();
  await a.mouse.move(box.x+30,box.y+100);await a.mouse.down();await a.mouse.move(box.x+110,box.y+35,{steps:10});await a.mouse.move(box.x+180,box.y+130,{steps:10});await a.mouse.up();await a.waitForTimeout(400);assert.ok(room.strokes.length>0);assert.ok(wordList.includes(room.secret));
  await a.screenshot({path:path.join(screenshots,'drawing.png')});
  await b.getByLabel('Input mode guess. Tap to switch',{exact:true}).click();await b.getByLabel('Chat message',{exact:true}).fill('hello from Bob');await b.getByRole('button',{name:'Send message',exact:true}).click();await a.getByText('hello from Bob',{exact:false}).waitFor();await b.waitForTimeout(650);
  await b.getByLabel('Input mode chat. Tap to switch',{exact:true}).click();await b.getByLabel('Your guess',{exact:true}).fill(room.secret);await b.getByRole('button',{name:'Send message',exact:true}).click();await a.getByText(`The word was ${room.secret}`,{exact:true}).waitFor();
  await b.getByText('Pick your masterpiece').waitFor({timeout:10000});await b.getByText(room.choices[0],{exact:true}).click();await a.getByLabel('Your guess',{exact:true}).fill(room.secret);await a.getByRole('button',{name:'Send message',exact:true}).click();await a.getByText('Masterpieces made.',{exact:true}).waitFor({timeout:10000});
  assert.equal(room.phase,'finished');assert.ok(room.members.every(m=>m.score>0));assert.deepEqual(errors,[]);
  await a.getByRole('button',{name:'Play again',exact:true}).click();await a.getByText('Pick your masterpiece').waitFor();assert.ok(room.members.every(m=>m.score===0));
  console.log('PASS: 19-word rejection; 20-word set save; persistence; dropdown selection; custom room; word-choice setting; two-player join, reconnect, drawing, chat, full match and rematch. No browser errors.');console.log(`Screenshots: ${screenshots}`);
 }finally{await browser.close();await new Promise(r=>web.close(r));await server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
