const express=require('express'),http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto'),{WebSocketServer}=require('ws');
// iniciar(opciones): arranca el servidor. Opciones: dataDir (estado.json), configPath, port, host, generarPdf(url)->Buffer
// Variables de entorno: PORT, HOST, DATA_DIR (estado.json y proyectos/), CODIGO_JEFE, NOMBRE_JEFE,
//   CODIGOS_OPERARIOS ("1234,5678" o "1234:Juan,5678:Pedro"), CHROME_PATH (PDF en servidor, opcional)
function iniciar(opts={}){
const DATA_DIR=path.resolve(opts.dataDir||process.env.DATA_DIR||process.env.SV_DATA_DIR||path.join(__dirname,'data'));fs.mkdirSync(DATA_DIR,{recursive:true});
const CFG=JSON.parse(fs.readFileSync(opts.configPath||process.env.SV_CONFIG||path.join(__dirname,'config.json'),'utf8'));
// Códigos de acceso: variables de entorno > config (app de escritorio) > valores por defecto (con aviso)
const DEF_JEFE='9999',DEF_OPS=['1234','5678'];
const NOMBRE_JEFE=(process.env.NOMBRE_JEFE||'').trim()||'Jefe de sección';
const CODIGO_JEFE=(process.env.CODIGO_JEFE||'').trim()||(CFG.codigoAdmin!=null?String(CFG.codigoAdmin):'');
let OPERARIOS=[];
if((process.env.CODIGOS_OPERARIOS||'').trim())OPERARIOS=process.env.CODIGOS_OPERARIOS.split(',').map(x=>x.trim()).filter(Boolean).map((x,i)=>{const [c,...n]=x.split(':');return {codigo:c.trim(),nombre:n.join(':').trim()||'Operario '+(i+1)}});
else if(Array.isArray(CFG.codigosOperario))OPERARIOS=CFG.codigosOperario.map((c,i)=>({codigo:String(c),nombre:'Operario '+(i+1)}));
const JEFE=CODIGO_JEFE||DEF_JEFE;
if(!CODIGO_JEFE)console.warn('AVISO: CODIGO_JEFE no definido; se usa el código por defecto. Defina la variable de entorno CODIGO_JEFE.');
if(!OPERARIOS.length){OPERARIOS=DEF_OPS.map((c,i)=>({codigo:c,nombre:'Operario '+(i+1)}));console.warn('AVISO: CODIGOS_OPERARIOS no definido; se usan los códigos por defecto. Defina la variable de entorno CODIGOS_OPERARIOS.')}
if(OPERARIOS.some(o=>o.codigo===JEFE))console.warn('AVISO: un código de operario coincide con el del jefe de sección');
// PDF en servidor: solo con el generador de la app de escritorio o con Chrome/Chromium instalado
const CHROME=process.env.CHROME_PATH?(fs.existsSync(process.env.CHROME_PATH)?process.env.CHROME_PATH:null):['/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(f=>fs.existsSync(f));
let PUPP=null;if(!opts.generarPdf&&CHROME)try{PUPP=require('puppeteer-core')}catch{}
const PDF_OK=!!opts.generarPdf||!!(CHROME&&PUPP);
const ESTADO=path.join(DATA_DIR,'estado.json');
let estado={totales:{},colocadas:[]};
try{estado=JSON.parse(fs.readFileSync(ESTADO))}catch{}
for(const t of CFG.tipos) if(estado.totales[t.id]==null) estado.totales[t.id]=t.total;
// Proyectos de planificación por orden de trabajo: DATA_DIR/proyectos/<ordenId>.json (no se borran al recoger)
const DIR_PROY=path.join(DATA_DIR,'proyectos');fs.mkdirSync(DIR_PROY,{recursive:true});
const proyectos={};const sucios=new Set();
for(const f of fs.readdirSync(DIR_PROY))if(f.endsWith('.json'))try{const pr=JSON.parse(fs.readFileSync(path.join(DIR_PROY,f),'utf8'));if(pr&&pr.orden&&pr.orden.id)proyectos[pr.orden.id]=pr}catch(e){console.error('Proyecto ilegible',f,e.message)}
const escribirAtomico=(f,obj)=>{fs.writeFileSync(f+'.tmp',JSON.stringify(obj,null,1));fs.renameSync(f+'.tmp',f)};
const guardar=()=>{escribirAtomico(ESTADO,estado);
 for(const id of sucios){const pr=proyectos[id];if(pr&&/^[\w-]+$/.test(id))escribirAtomico(path.join(DIR_PROY,id+'.json'),pr)}sucios.clear()};
// Calle más cercana (calculada localmente a partir del GeoJSON OSM)
let CALLES=[];try{CALLES=JSON.parse(fs.readFileSync(path.join(__dirname,'data/osm/municipio.geojson'))).features.filter(f=>f.properties&&f.properties.highway&&f.properties.name&&/LineString/.test(f.geometry&&f.geometry.type))}catch{}
function calleCercana(lat,lng){const k=Math.cos(lat*Math.PI/180);let best=null,bd=1e18;
 for(const f of CALLES){const LL=f.geometry.type==='LineString'?[f.geometry.coordinates]:f.geometry.coordinates;
  for(const c of LL)for(let i=1;i<c.length;i++){const ax=(c[i-1][0]-lng)*k,ay=c[i-1][1]-lat,dx=(c[i][0]-lng)*k-ax,dy=c[i][1]-lat-ay;
   let t=dx||dy?-(ax*dx+ay*dy)/(dx*dx+dy*dy):0;t=Math.max(0,Math.min(1,t));const x=ax+t*dx,y=ay+t*dy,d=x*x+y*y;if(d<bd){bd=d;best=f.properties.name}}}
 const m=Math.round(Math.sqrt(bd)*111320);return best&&m<=150?{calle:best,dist:m}:{calle:null,dist:null}}
for(const c of estado.colocadas)if(!('calle' in c))Object.assign(c,calleCercana(c.lat,c.lng));
guardar();
function resumen(orden){const g={};for(const c of estado.colocadas.filter(c=>!orden||c.orden===orden||c.estado==='colocada'&&orden==='_colocadas')){const k=c.calle||'Sin calle identificada';(g[k]=g[k]||{calle:k,tipos:{},total:0,items:[],plan:0,col:0});g[k][c.estado==='planificada'?'plan':'col']++;g[k].tipos[c.tipo]=(g[k].tipos[c.tipo]||0)+1;g[k].total++;g[k].items.push(c)}
 return Object.values(g).sort((a,b)=>a.calle==='Sin calle identificada'?1:b.calle==='Sin calle identificada'?-1:a.calle.localeCompare(b.calle,'es'))}
estado.ordenes=estado.ordenes||[];for(const c of estado.colocadas)if(!c.estado)c.estado='colocada';
const CAMPOS=['tipo','lat','lng','calle','dist','estado','fecha','rol','creadaPor','colocadaPor','colocadaEn'];
function proyecto(ordenId){const o=estado.ordenes.find(x=>x.id===ordenId);if(!o)return null;
 let pr=proyectos[ordenId];if(!pr)pr=proyectos[ordenId]={orden:{id:o.id,nombre:o.nombre,fecha:o.fecha},items:[],creado:new Date().toISOString(),autoGuardado:null,guardadoManual:null};
 pr.orden.nombre=o.nombre;pr.orden.fecha=o.fecha;return pr}
// Copia el estado de una marca al proyecto de su orden (auto-guardado)
function registrar(c,extra){if(!c||!c.orden)return;const pr=proyecto(c.orden);if(!pr)return;
 if(!c.pid)c.pid=crypto.randomUUID();let it=pr.items.find(i=>i.pid===c.pid);
 if(!it){it={pid:c.pid,historial:[]};pr.items.push(it)}
 const antes=it.estado;for(const k of CAMPOS)if(c[k]!==undefined)it[k]=c[k];it.id=c.id;Object.assign(it,extra||{});
 if(it.estado!==antes)it.historial.push({estado:it.estado,fecha:new Date().toISOString(),por:(extra&&extra.recogidaPor)||c.colocadaPor||c.creadaPor||null});
 const t=new Date().toISOString();pr.autoGuardado=pr.ultimaModificacion=t;if(!pr.base)pr.base=t;sucios.add(c.orden)}
// Migración: marcas con orden que aún no están en ningún proyecto
for(const c of estado.colocadas)if(c.orden&&!(proyectos[c.orden]&&proyectos[c.orden].items.some(i=>i.pid===c.pid)))registrar(c);
for(const o of estado.ordenes)if(!proyectos[o.id]){proyecto(o.id);sucios.add(o.id)}
guardar();
const enCalle=id=>estado.colocadas.filter(c=>c.tipo===id).length; // fuera del almacén (colocadas + planificadas)
const nEst=(id,e)=>estado.colocadas.filter(c=>c.tipo===id&&c.estado===e).length;
const stock=()=>CFG.tipos.map(t=>({id:t.id,nombre:t.nombre,codigo:t.codigo,grupo:t.grupo,total:estado.totales[t.id],enCalle:nEst(t.id,'colocada'),planificadas:nEst(t.id,'planificada'),enAlmacen:estado.totales[t.id]-enCalle(t.id)}));
const app=express();app.set('trust proxy',1);app.disable('x-powered-by');app.use(express.json({limit:'100kb'}));
app.get('/healthz',(q,r)=>r.set('Cache-Control','no-store').json({ok:true,uptime:Math.round(process.uptime()),clientes:wss.clients.size}));
app.get('/api/capacidades',(q,r)=>r.json({pdf:PDF_OK}));
app.use(express.static(path.join(__dirname,'public')));
app.get('/api/tipos',(q,r)=>r.json(CFG.tipos.map(({id,nombre,codigo,grupo})=>({id,nombre,codigo,grupo}))));
app.get('/api/estado',(q,r)=>r.json({stock:stock(),colocadas:estado.colocadas}));
app.get('/api/mapa/meta',(q,r)=>r.sendFile(path.join(__dirname,'data/osm/meta.json')));
app.get('/api/mapa/geojson',(q,r)=>r.sendFile(path.join(__dirname,'data/osm/municipio.geojson')));
app.get('/api/mapa/osm',(q,r)=>r.download(path.join(__dirname,'data/osm/municipio.osm'),'municipio.osm'));
app.get('/api/resumen.csv',(q,r)=>{const N=Object.fromEntries(CFG.tipos.map(t=>[t.id,t]));const e=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
 const orden=q.query.orden||'';const filas=[['Calle','Total','Colocadas (verde)','Planificadas (ámbar)',...CFG.tipos.map(t=>t.nombre+(t.codigo?' ('+t.codigo+')':'')),'Detalle'].map(e).join(';')];
 for(const g of resumen(orden))filas.push([g.calle,g.total,g.col,g.plan,...CFG.tipos.map(t=>g.tipos[t.id]||0),g.items.map(c=>N[c.tipo].nombre+' ['+c.estado+(c.orden?' · '+((estado.ordenes.find(o=>o.id===c.orden)||{}).nombre||''):'')+'] @'+c.lat.toFixed(6)+','+c.lng.toFixed(6)).join(' | ')].map(e).join(';'));
 const R=resumen(orden);filas.push(['TOTAL',R.reduce((a,g)=>a+g.total,0),R.reduce((a,g)=>a+g.col,0),R.reduce((a,g)=>a+g.plan,0),...CFG.tipos.map(t=>R.reduce((a,g)=>a+(g.tipos[t.id]||0),0)),''].map(e).join(';'));
 r.type('text/csv; charset=utf-8').set('Content-Disposition','attachment; filename="resumen-por-calle.csv"').send('\ufeff'+filas.join('\r\n'))});
app.get(['/api/informe.pdf','/api/hoja.pdf'],async(q,r)=>{const modo=q.path.includes('hoja')?'hoja':'informe';const urlInf='http://127.0.0.1:'+server.address().port+'/?informe=1&modo='+modo+'&orden='+encodeURIComponent(q.query.orden||'');
 if(opts.generarPdf){try{const pdf=await opts.generarPdf(urlInf,modo,q.query.orden||'');return r.type('application/pdf').set('Content-Disposition','inline; filename="'+modo+'-senales.pdf"').send(Buffer.from(pdf))}catch(e){return r.status(500).send('Error generando PDF: '+e.message+'. Use Imprimir → Guardar como PDF.')}}
 if(!PDF_OK)return r.status(501).type('text/plain; charset=utf-8').send('La descarga de PDF no está disponible en este servidor. Use el botón «🖨 Imprimir» y elija «Guardar como PDF» en el diálogo de impresión.');
 const pp=PUPP,exe=CHROME;
 let b;try{b=await pp.launch({executablePath:exe,args:['--no-sandbox']});const p=await b.newPage();await p.setViewport({width:1100,height:800});
  await p.goto(urlInf,{waitUntil:'networkidle0'});
  await p.waitForFunction('typeof callesNombre!=="undefined"&&callesNombre.length&&stock.length');
  await p.evaluate((m,o)=>{ordenSel=o;prepararInforme(m)},modo,q.query.orden||'');await new Promise(x=>setTimeout(x,800));
  const pdf=await p.pdf({format:'A4',landscape:true,printBackground:true,margin:{top:'10mm',bottom:'10mm',left:'10mm',right:'10mm'}});
  r.type('application/pdf').set('Content-Disposition','inline; filename="'+modo+'-senales.pdf"').send(Buffer.from(pdf));}
 catch(e){r.status(500).send('Error generando PDF: '+e.message)}finally{b&&b.close()}});
const sesiones=new Map();
const fallos=new Map();// ip -> {n, hasta}: máx. 10 códigos erróneos cada 15 min por IP
app.post('/api/login',(q,r)=>{const ip=q.ip||'?',f=fallos.get(ip),ahora=Date.now();
 if(f&&f.n>=10&&f.hasta>ahora)return r.status(429).json({error:'Demasiados intentos. Espere unos minutos.'});
 const c=String((q.body&&q.body.codigo)||'').trim();const op=OPERARIOS.find(o=>o.codigo===c);let rol=c&&c===JEFE?'admin':op?'operario':null;
 if(!rol){const g=f&&f.hasta>ahora?f:{n:0,hasta:ahora+15*60e3};g.n++;fallos.set(ip,g);return r.status(401).json({error:'Código incorrecto'})}
 fallos.delete(ip);const tk=crypto.randomBytes(16).toString('hex');const nombre=rol==='admin'?NOMBRE_JEFE:op.nombre;sesiones.set(tk,{rol,nombre});r.json({token:tk,rol,nombre,editaTotales:rol==='admin'||!!CFG.operariosEditanTotales})});
const server=http.createServer(app),wss=new WebSocketServer({server,path:'/ws'});
const difundir=()=>{const m=JSON.stringify({t:'estado',stock:stock(),colocadas:estado.colocadas,ordenes:estado.ordenes,proyectos});wss.clients.forEach(c=>c.readyState===1&&c.send(m))};
wss.on('connection',(ws,req)=>{const tk=new URL(req.url,'http://x').searchParams.get('token');const se=sesiones.get(tk);ws.rol=se?se.rol:null;ws.nombre=se?se.nombre:null;
 ws.send(JSON.stringify({t:'estado',stock:stock(),colocadas:estado.colocadas,ordenes:estado.ordenes,proyectos,rol:ws.rol}));
 ws.on('message',raw=>{let m;try{m=JSON.parse(raw)}catch{return}
  let resp=null;
  const err=e=>ws.send(JSON.stringify({t:'error',msg:e}));
  if(!ws.rol)return err('Inicie sesión con su código');
  if(m.t==='colocar'){if(ws.rol!=='admin')return err('Solo el jefe de sección planifica elementos. Toque una marca ámbar y pulse «Fijar aquí».');const tp=CFG.tipos.find(x=>x.id===m.tipo);if(!tp)return err('Tipo desconocido');
   if(estado.totales[tp.id]-enCalle(tp.id)<=0)return err('Sin stock de '+tp.nombre);
   if(!isFinite(m.lat)||!isFinite(m.lng))return err('Posición no válida');
   const admin=ws.rol==='admin',orden=estado.ordenes.find(o=>o.id===m.orden);
   if(admin&&!orden)return err('Cree o seleccione una orden de trabajo antes de planificar');
   const ahora=new Date().toISOString();
   const nc={id:crypto.randomUUID(),pid:crypto.randomUUID(),tipo:tp.id,lat:+m.lat,lng:+m.lng,fecha:ahora,rol:ws.rol,creadaPor:ws.nombre,orden:orden?orden.id:null,
    estado:'planificada',...calleCercana(+m.lat,+m.lng)};estado.colocadas.push(nc);registrar(nc);}
  else if(m.t==='mover'){const c=estado.colocadas.find(x=>x.id===m.id);if(!c)return err('No existe');if(ws.rol!=='admin')return err('Solo el jefe de sección puede mover elementos planificados');if(c.estado!=='planificada')return err('Un elemento colocado no se mueve: recójalo y planifíquelo de nuevo');c.lat=+m.lat;c.lng=+m.lng;Object.assign(c,calleCercana(c.lat,c.lng));registrar(c);}
  else if(m.t==='confirmar'){const c=estado.colocadas.find(x=>x.id===m.id);if(!c)return err('No existe');if(c.estado!=='planificada')return err('Ya estaba colocada');
   c.estado='colocada';c.colocadaPor=ws.nombre;c.colocadaEn=new Date().toISOString();registrar(c);}
  else if(m.t==='orden_nueva'){if(ws.rol!=='admin')return err('Solo el jefe de sección crea órdenes');const nombre=String(m.nombre||'').trim().slice(0,80);if(!nombre)return err('Indique un nombre');
   const no={id:crypto.randomUUID(),nombre,fecha:String(m.fecha||new Date().toISOString().slice(0,10)).slice(0,10),creada:new Date().toISOString()};estado.ordenes.push(no);proyecto(no.id);sucios.add(no.id);}
  else if(m.t==='recoger'){const c=estado.colocadas.find(x=>x.id===m.id);if(!c)return err('No existe');
   if(c.estado==='planificada'&&ws.rol!=='admin')return err('Solo el jefe de sección puede eliminar una planificación');estado.colocadas=estado.colocadas.filter(x=>x.id!==m.id);
   registrar({...c,estado:'recogida'},{estadoPrevio:c.estado,recogidaPor:ws.nombre,recogidaEn:new Date().toISOString()});}
  else if(m.t==='guardar_proyecto'){if(ws.rol!=='admin')return err('Solo el jefe de sección guarda proyectos');const pr=proyecto(m.orden);if(!pr)return err('Seleccione una orden de trabajo');
   for(const c of estado.colocadas)if(c.orden===m.orden)registrar(c);const t=new Date().toISOString();pr.guardadoManual=t;pr.base=t;pr.autoGuardado=pr.ultimaModificacion=pr.ultimaModificacion||t;sucios.add(m.orden);
   resp=({t:'info',tipo:'guardado',orden:m.orden,msg:'Proyecto «'+pr.orden.nombre+'» guardado ('+pr.items.length+' elementos)'});}
  else if(m.t==='reutilizar'){if(ws.rol!=='admin')return err('Solo el jefe de sección reutiliza planes');const src=proyectos[m.origen];if(!src||!src.items.length)return err('Ese proyecto no tiene elementos guardados');
   let destino=m.origen,nueva=false;const nom=String(m.nombre||'').trim().slice(0,80);
   if(nom){const no={id:crypto.randomUUID(),nombre:nom,fecha:String(m.fecha||new Date().toISOString().slice(0,10)).slice(0,10),creada:new Date().toISOString(),deProyecto:m.origen};estado.ordenes.push(no);proyecto(no.id);sucios.add(no.id);destino=no.id;nueva=true}
   let n=0;const sinStock={},yaActivos=[];const ahora=new Date().toISOString();
   for(const it of src.items.slice()){const tp=CFG.tipos.find(x=>x.id===it.tipo);if(!tp)continue;
    if(!nueva&&it.estado!=='recogida'){yaActivos.push(it);continue}   // en la misma orden: solo lo que se recogió
    if(estado.totales[tp.id]-enCalle(tp.id)<=0){sinStock[tp.nombre]=(sinStock[tp.nombre]||0)+1;continue}
    const nc={id:crypto.randomUUID(),pid:nueva?crypto.randomUUID():it.pid,tipo:tp.id,lat:it.lat,lng:it.lng,fecha:ahora,rol:ws.rol,creadaPor:ws.nombre,orden:destino,estado:'planificada',calle:it.calle,dist:it.dist};
    if(!nueva){delete it.colocadaPor;delete it.colocadaEn;delete it.recogidaPor;delete it.recogidaEn;delete it.estadoPrevio}
    estado.colocadas.push(nc);registrar(nc);n++}
   const faltan=Object.entries(sinStock).map(([k,v])=>v+' × '+k).join(', ');
   resp=({t:'info',tipo:'reutilizado',orden:destino,msg:'Plan reutilizado: '+n+' elemento(s) planificados en ámbar'+(yaActivos.length?' · '+yaActivos.length+' ya estaban en el mapa':'')+(faltan?' · Sin stock: '+faltan:'')});}
  else if(m.t==='total'){if(ws.rol!=='admin'&&!CFG.operariosEditanTotales)return err('Solo administrador');const n=parseInt(m.total);
   if(!(m.tipo in estado.totales)||!(n>=enCalle(m.tipo)))return err('Total no puede ser menor que las unidades en calle');estado.totales[m.tipo]=n;}
  else if(m.t==='lote'||m.t==='orden_lote'){
   const acc=m.accion;if(!['colocar','recoger','quitar'].includes(acc))return err('Acción no válida');
   let lista;if(m.t==='orden_lote'){if(!estado.ordenes.some(o=>o.id===m.orden))return err('Seleccione una orden de trabajo');lista=estado.colocadas.filter(c=>c.orden===m.orden)}
   else{const ids=new Set(Array.isArray(m.ids)?m.ids.map(String):[]);lista=estado.colocadas.filter(c=>ids.has(c.id))}
   if(!lista.length)return err('No hay elementos para esta acción');
   let ok=0,omit=0;const ahora=new Date().toISOString();
   for(const c of lista){
    if(acc==='colocar'){if(c.estado!=='planificada'){omit++;continue}c.estado='colocada';c.colocadaPor=ws.nombre;c.colocadaEn=ahora;registrar(c);ok++}
    else{if(acc==='quitar'&&c.estado!=='planificada'){omit++;continue}
     if(c.estado==='planificada'&&ws.rol!=='admin'){omit++;continue}
     estado.colocadas=estado.colocadas.filter(x=>x.id!==c.id);registrar({...c,estado:'recogida'},{estadoPrevio:c.estado,recogidaPor:ws.nombre,recogidaEn:ahora});ok++}}
   const verbo={colocar:'marcados como colocados',recoger:'recogidos al almacén',quitar:'quitados del mapa'}[acc];
   resp={t:'info',tipo:'lote',msg:ok+' elemento(s) '+verbo+(omit?' · '+omit+' omitido(s)'+(acc==='colocar'?' (ya estaban colocados)':ws.rol!=='admin'?' (las planificadas solo las quita el jefe de sección)':' (no estaban planificados)'):'')};
   if(!ok)return ws.send(JSON.stringify(resp));}
  else return;
  guardar();difundir();if(resp)ws.send(JSON.stringify(resp));});});
// Ping cada 25 s: mantiene viva la conexión detrás de proxies (Render) y descarta clientes muertos
const latido=setInterval(()=>wss.clients.forEach(c=>{if(c.vivo===false)return c.terminate();c.vivo=false;try{c.ping()}catch{}}),25000);latido.unref();
wss.on('connection',c=>{c.vivo=true;c.on('pong',()=>c.vivo=true)});
const host=opts.host||process.env.HOST||'0.0.0.0';
// Con PORT definido (Render) se usa exactamente ese puerto; si no, el de config y, si está ocupado, uno libre
const puertos=opts.port!=null?[opts.port,0]:process.env.PORT?[+process.env.PORT]:[CFG.puerto||3000,0];
return new Promise((res,rej)=>{const intentar=i=>{server.once('error',e=>{if(e.code==='EADDRINUSE'&&i+1<puertos.length)intentar(i+1);else rej(e)});
 server.listen(puertos[i],host,()=>{const port=server.address().port;console.log('Servidor en http://localhost:'+port);console.log('Datos en '+DATA_DIR+' · PDF en servidor: '+(PDF_OK?'sí':'no (se usa Imprimir del navegador)'));res({server,port,dataDir:DATA_DIR,guardar,cerrar:()=>new Promise(ok=>{wss.clients.forEach(c=>c.terminate());server.close(()=>ok())})})})};intentar(0)});
}
// Direcciones IPv4 de la red local
function ipsLocales(){return Object.values(require('os').networkInterfaces()).flat().filter(i=>i&&i.family==='IPv4'&&!i.internal).map(i=>i.address)}
module.exports={iniciar,ipsLocales};
if(require.main===module)iniciar().then(srv=>{if(!process.env.RENDER)ipsLocales().forEach(ip=>console.log('Red local: http://'+ip+':'+srv.port));
 const parar=sig=>{console.log(sig+': guardando y cerrando…');try{srv.guardar()}catch(e){console.error(e)}srv.cerrar().then(()=>process.exit(0));setTimeout(()=>process.exit(0),5000).unref()};
 process.on('SIGTERM',()=>parar('SIGTERM'));process.on('SIGINT',()=>parar('SIGINT'))}).catch(e=>{console.error(e);process.exit(1)});
