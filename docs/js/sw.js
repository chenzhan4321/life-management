// Service Worker for 生活管理系统 PWA v4.4
const CACHE_NAME = 'life-management-v4.4.0';
const STATIC_CACHE = 'life-management-static-v4.4.0';
const DYNAMIC_CACHE = 'life-management-dynamic-v4.4.0';

// 需要缓存的静态文件 - 修复路径
const STATIC_FILES = [
  '../',
  '../index.html',
  './app.js',
  './config.js',
  '../css/styles.css',
  '../css/theme-dark.css',
  '../css/mobile.css',
  '../manifest.json',
  // 图标文件
  '../assets/icons/icon-192x192.png',
  '../assets/icons/icon-512x512.png',
];

// API 端点（用于网络优先策略）
const API_ENDPOINTS = [
  '/api/tasks',
  '/api/analytics/daily',
];

// 安装事件 - 预缓存静态资源
self.addEventListener('install', event => {
  console.log('Service Worker: 安装中...');
  
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        console.log('Service Worker: 预缓存静态文件');
        // 尝试缓存，失败不阻断安装
        return Promise.allSettled(
          STATIC_FILES.map(url => cache.add(url).catch(err => {
            console.warn(`Failed to cache ${url}:`, err);
          }))
        );
      })
      .then(() => {
        console.log('Service Worker: 安装完成');
        return self.skipWaiting();
      })
      .catch(error => {
        console.error('Service Worker: 预缓存失败', error);
      })
  );
});

// 激活事件 - 清理旧缓存
self.addEventListener('activate', event => {
  console.log('Service Worker: 激活中...');
  
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (cacheName !== STATIC_CACHE && 
                cacheName !== DYNAMIC_CACHE && 
                cacheName !== CACHE_NAME) {
              console.log('Service Worker: 删除旧缓存', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('Service Worker: 激活完成');
        return self.clients.claim();
      })
  );
});

// 获取事件 - 处理网络请求
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  
  // 只处理同源请求
  if (url.origin !== location.origin) {
    return;
  }
  
  // API 请求：网络优先策略
  if (isApiRequest(request)) {
    event.respondWith(
      networkFirst(request)
    );
  }
  // 静态资源：缓存优先策略
  else {
    event.respondWith(
      cacheFirst(request)
    );
  }
});

// 判断是否为API请求
function isApiRequest(request) {
  const url = new URL(request.url);
  return url.pathname.startsWith('/api/') || 
         API_ENDPOINTS.some(endpoint => url.pathname.startsWith(endpoint));
}

// 缓存优先策略（适用于静态资源）
async function cacheFirst(request) {
  try {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      console.log('Service Worker: 从缓存返回', request.url);
      return cachedResponse;
    }
    
    // 缓存未命中，尝试网络请求
    const networkResponse = await fetch(request);
    
    // 缓存成功的网络响应
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, networkResponse.clone());
      console.log('Service Worker: 网络请求成功并缓存', request.url);
    }
    
    return networkResponse;
  } catch (error) {
    console.error('Service Worker: 请求失败', request.url, error);
    
    // 如果是页面请求，返回离线页面
    if (request.destination === 'document') {
      return caches.match('/');
    }
    
    // 其他请求返回错误响应
    return new Response('离线状态，无法加载资源', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: new Headers({
        'Content-Type': 'text/plain'
      })
    });
  }
}

// 网络优先策略（适用于API请求）
async function networkFirst(request) {
  try {
    // 首先尝试网络请求
    const networkResponse = await fetch(request);
    
    if (networkResponse && networkResponse.status === 200) {
      // 如果是GET请求，缓存响应
      if (request.method === 'GET') {
        const cache = await caches.open(DYNAMIC_CACHE);
        cache.put(request, networkResponse.clone());
        console.log('Service Worker: API响应已缓存', request.url);
      }
    }
    
    return networkResponse;
  } catch (error) {
    console.log('Service Worker: 网络请求失败，尝试缓存', request.url);
    
    // 网络失败，尝试缓存
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      console.log('Service Worker: 从缓存返回API响应', request.url);
      return cachedResponse;
    }
    
    // 返回离线响应
    if (request.url.includes('/api/tasks')) {
      return new Response(JSON.stringify({
        tasks: [],
        offline: true,
        message: '离线模式 - 数据可能不是最新的'
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response('离线状态，API不可用', {
      status: 503,
      statusText: 'Service Unavailable'
    });
  }
}

// 后台同步（当网络恢复时同步离线操作）
self.addEventListener('sync', event => {
  console.log('Service Worker: 后台同步', event.tag);
  
  if (event.tag === 'background-sync-tasks') {
    event.waitUntil(syncOfflineTasks());
  }
});

// 推送通知支持
self.addEventListener('push', event => {
  if (!event.data) {
    return;
  }
  
  const data = event.data.json();
  const options = {
    body: data.body || '您有新的任务提醒',
    icon: './static/icon-192x192.png',
    badge: './static/icon-72x72.png',
    tag: 'task-reminder',
    renotify: true,
    actions: [
      {
        action: 'view',
        title: '查看任务',
        icon: './static/icon-192x192.png'
      },
      {
        action: 'dismiss',
        title: '忽略',
        icon: './static/icon-192x192.png'
      }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title || '任务提醒', options)
  );
});

// 通知点击事件
self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  if (event.action === 'view') {
    event.waitUntil(
      clients.openWindow('/')
    );
  }
});

// 同步离线任务
async function syncOfflineTasks() {
  try {
    // 这里可以实现离线时创建的任务的同步逻辑
    console.log('Service Worker: 同步离线任务');
    
    // 从本地存储获取离线创建的任务
    const offlineTasks = await getOfflineTasks();
    
    for (const task of offlineTasks) {
      try {
        const response = await fetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(task)
        });
        
        if (response.ok) {
          console.log('Service Worker: 离线任务同步成功', task);
          // 从离线存储中移除已同步的任务
          await removeOfflineTask(task.id);
        }
      } catch (error) {
        console.error('Service Worker: 任务同步失败', task, error);
      }
    }
  } catch (error) {
    console.error('Service Worker: 同步过程出错', error);
  }
}

// 获取离线任务（示例实现）
async function getOfflineTasks() {
  // 这里应该从 IndexedDB 或其他本地存储获取
  return [];
}

// 移除已同步的离线任务
async function removeOfflineTask(taskId) {
  // 这里应该从本地存储移除任务
  console.log('Service Worker: 移除已同步任务', taskId);
}

// 版本更新处理
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

console.log('Service Worker: 脚本加载完成');