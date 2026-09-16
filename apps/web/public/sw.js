self.addEventListener('push',event=>{const data=event.data?.json()||{};event.waitUntil(self.registration.showNotification(data.title||'FinSight',{body:data.body||'You have a new reminder.',data:{url:'/'},icon:'/icon.svg'}));});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil(clients.openWindow('/'));});
