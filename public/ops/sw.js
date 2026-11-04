// This worker only handles notifications. It never caches order data or credentials.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
 let data={};try{data=event.data?.json()||{};}catch{}
 event.waitUntil(self.registration.showNotification(data.title||'Streetball · Suas vendas',{
  body:data.body||'Há uma atualização na sua loja.',tag:data.tag||'streetball',
  icon:'/apple-touch-icon.png',data:{url:safeUrl(data.url)},renotify:false
 }));
});
function safeUrl(value){
 try{const url=new URL(value,self.location.origin);if(url.origin===self.location.origin&&url.pathname==='/ops/')return url.href;}catch{}
 return new URL('/ops/',self.location.origin).href;
}
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const target=safeUrl(event.notification.data?.url);
 event.waitUntil((async()=>{
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const current=windows.find(c=>{const u=new URL(c.url);return u.origin===self.location.origin&&u.pathname.startsWith('/ops/');});
  if(current){const opened=await current.navigate(target);if(opened)return opened.focus();}
  return self.clients.openWindow(target);
 })());
});
