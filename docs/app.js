// 生活管理系统前端应用
// 使用配置的API地址
const API_BASE = window.API_CONFIG ? window.API_CONFIG.baseURL + '/api' : '/api';

// 重构：使用单一全局计时器管理所有任务，避免重复
let globalTimerInterval = null;
const taskTimerData = new Map(); // 任务ID -> {status: 'active'|'paused', elapsedSeconds, startTime}
const taskReminders = new Map(); // 存储任务提醒的 timeout ID

// 兼容旧代码的别名
const activeTimers = taskTimerData;
const pausedTimers = new Map();

// 检查浏览器通知权限
async function checkNotificationPermission() {
    if (!("Notification" in window)) {
        console.log("浏览器不支持通知");
        return false;
    }
    
    if (Notification.permission === "granted") {
        return true;
    }
    
    if (Notification.permission !== "denied") {
        const permission = await Notification.requestPermission();
        return permission === "granted";
    }
    
    return false;
}

// 显示系统通知
function showNotification(title, body, taskId = null) {
    if (Notification.permission === "granted") {
        const notification = new Notification(title, {
            body: body,
            icon: '/favicon.ico',
            badge: '/favicon.ico',
            tag: taskId || 'task-reminder',
            requireInteraction: true
        });
        
        notification.onclick = function() {
            window.focus();
            if (taskId) {
                // 滚动到对应任务
                const taskElement = document.querySelector(`[data-task-id="${taskId}"]`);
                if (taskElement) {
                    taskElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    taskElement.classList.add('highlight');
                    setTimeout(() => taskElement.classList.remove('highlight'), 2000);
                }
            }
            notification.close();
        };
        
        // 5秒后自动关闭
        setTimeout(() => notification.close(), 5000);
    }
}

// 启动全局计时器（如果还没启动）
function ensureGlobalTimer() {
    if (!globalTimerInterval) {
        console.log('启动全局计时器');
        globalTimerInterval = setInterval(() => {
            taskTimerData.forEach((data, taskId) => {
                if (data.status === 'active') {
                    data.elapsedSeconds++;
                    updateTimerDisplay(taskId, data.elapsedSeconds);
                } else if (data.status === 'paused') {
                    // 暂停状态不增加时间，但保持显示
                    updateTimerDisplay(taskId, data.elapsedSeconds);
                }
            });
        }, 1000);
    }
}

// 启动任务计时器
function startTaskTimer(taskId, taskTitle) {
    // 先停止该任务的任何现有计时
    const existingData = taskTimerData.get(taskId);
    if (existingData) {
        // 如果已经在活动状态，不重复启动
        if (existingData.status === 'active') {
            showToast('该任务已在计时中', 'info');
            return;
        }
        // 如果是暂停状态，恢复计时
        if (existingData.status === 'paused') {
            existingData.status = 'active';
            ensureGlobalTimer();
            showToast(`继续任务: ${taskTitle}`, 'success');
            saveTimersToLocalStorage();
            return;
        }
    }
    
    // 新开始计时
    const now = new Date();
    const timerData = {
        status: 'active',
        startTime: now,
        actualStart: now.toISOString(),
        elapsedSeconds: 0
    };
    
    taskTimerData.set(taskId, timerData);
    
    // 确保全局计时器在运行
    ensureGlobalTimer();
    
    // 更新UI显示
    updateTimerDisplay(taskId, 0);
    
    // 保存状态
    saveTimersToLocalStorage();
    
    // 异步更新后端状态，然后刷新任务列表
    fetch(`${API_BASE}/tasks/${taskId}`, {
        method: 'PATCH',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({status: 'in_progress'})
    }).then(() => {
        loadTasks();
    });
    
    showToast(`开始任务: ${taskTitle}`, 'success');
}

// 暂停任务计时器
function pauseTaskTimer(taskId) {
    console.log('暂停任务:', taskId);
    const timerData = taskTimerData.get(taskId);
    if (!timerData || timerData.status !== 'active') {
        console.log('任务不存在或不在活动状态:', timerData);
        return;
    }
    
    // 只改变状态，不清理数据
    timerData.status = 'paused';
    console.log('任务状态已更改为暂停');
    
    // 保存状态
    saveTimersToLocalStorage();
    
    // 检查是否还有其他活动任务
    const hasOtherActive = Array.from(taskTimerData.values()).some(
        data => data.status === 'active'
    );
    
    // 如果没有其他活动任务，停止全局计时器
    if (!hasOtherActive && globalTimerInterval) {
        clearInterval(globalTimerInterval);
        globalTimerInterval = null;
    }
    
    // 更新主按钮为"继续"
    const taskElement = document.querySelector(`[data-task-id="${taskId}"]`);
    if (taskElement) {
        const mainBtn = taskElement.querySelector('.btn-timer');
        if (mainBtn) {
            mainBtn.innerHTML = '▶️ 继续';
            mainBtn.style.background = '#4CAF50';
            mainBtn.setAttribute('onclick', `resumeTaskTimer('${taskId}')`);
        }
    }
    
    showToast(`任务已暂停`, 'info');
}

// 继续任务计时器
function resumeTaskTimer(taskId) {
    const timerData = taskTimerData.get(taskId);
    if (!timerData || timerData.status !== 'paused') return;
    
    // 改变状态为活动
    timerData.status = 'active';
    
    // 确保全局计时器在运行
    ensureGlobalTimer();
    
    // 保存状态
    saveTimersToLocalStorage();
    
    // 更新主按钮为"暂停"
    const taskElement = document.querySelector(`[data-task-id="${taskId}"]`);
    if (taskElement) {
        const mainBtn = taskElement.querySelector('.btn-timer');
        if (mainBtn) {
            mainBtn.innerHTML = '⏸️ 暂停';
            mainBtn.style.background = '#FFA500';
            mainBtn.setAttribute('onclick', `pauseTaskTimer('${taskId}')`);
        }
    }
    
    showToast(`继续任务`, 'success');
}

// 保存暂停的计时器到localStorage
function savePausedTimersToLocalStorage() {
    const pausedData = [];
    pausedTimers.forEach((data, taskId) => {
        pausedData.push({
            taskId,
            startTime: data.startTime,
            actualStart: data.actualStart,
            elapsedSeconds: data.elapsedSeconds
        });
    });
    localStorage.setItem('pausedTimers', JSON.stringify(pausedData));
}

// 从 localStorage 恢复暂停的计时器
function loadPausedTimersFromLocalStorage() {
    // 新版本：从统一的 taskTimers 加载
    const saved = localStorage.getItem('taskTimers');
    if (saved) {
        try {
            const timersData = JSON.parse(saved);
            Object.entries(timersData).forEach(([taskId, data]) => {
                // 恢复计时器数据到内存
                taskTimerData.set(taskId, {
                    status: data.status,
                    startTime: new Date(data.startTime),
                    actualStart: data.actualStart,
                    elapsedSeconds: data.elapsedSeconds || 0
                });
                
                // 如果有活动的计时器，启动全局计时器
                if (data.status === 'active') {
                    ensureGlobalTimer();
                }
            });
        } catch (error) {
            console.error('加载计时器失败:', error);
        }
    }
}

// 停止任务计时器（完成任务）
async function stopTaskTimer(taskId) {
    const timerData = taskTimerData.get(taskId);
    if (!timerData) return;
    
    // 计算实际用时
    const actualMinutes = Math.ceil(timerData.elapsedSeconds / 60);
    const completedAt = new Date().toISOString();
    
    // 立即删除计时器数据，防止重复
    taskTimerData.delete(taskId);
    
    // 检查是否还有其他活动任务
    const hasOtherActive = Array.from(taskTimerData.values()).some(
        data => data.status === 'active'
    );
    
    // 如果没有其他活动任务，停止全局计时器
    if (!hasOtherActive && globalTimerInterval) {
        clearInterval(globalTimerInterval);
        globalTimerInterval = null;
    }
    
    // 保存状态
    saveTimersToLocalStorage();
    
    // 更新任务状态
    try {
        await updateTaskField(taskId, 'status', 'completed');
        await updateTaskField(taskId, 'actual_minutes', actualMinutes);
        await updateTaskField(taskId, 'completed_at', completedAt);
        
        if (timerData.actualStart) {
            await updateTaskField(taskId, 'actual_start', timerData.actualStart);
        }
        
        showToast(`任务完成！用时 ${formatTime(timerData.elapsedSeconds)}`, 'success');
    } catch (error) {
        console.error('更新任务失败:', error);
        showToast('更新任务状态失败', 'error');
    }
    
    // 刷新界面
    await loadTasks();
    await updateDashboard();
}

// 更新计时器显示
function updateTimerDisplay(taskId, seconds, isPaused = false) {
    const taskElement = document.querySelector(`[data-task-id="${taskId}"]`);
    if (!taskElement) return;
    
    let timerDisplay = taskElement.querySelector('.timer-display');
    if (!timerDisplay) {
        // 创建计时器显示元素
        const actionsDiv = taskElement.querySelector('.task-actions');
        timerDisplay = document.createElement('div');
        timerDisplay.className = 'timer-display';
        actionsDiv.insertBefore(timerDisplay, actionsDiv.firstChild);
    }
    
    // 只显示计时和完成按钮，暂停/继续由主按钮处理
    timerDisplay.innerHTML = `
        <span class="timer-time">⏱️ ${formatTime(seconds)}</span>
        <button onclick="stopTaskTimer('${taskId}')" class="btn-stop-timer">✅ 完成</button>
    `;
    
    // 更新主按钮的状态
    const timerData = taskTimerData.get(taskId);
    const mainBtn = taskElement.querySelector('.btn-timer');
    if (mainBtn && timerData) {
        if (timerData.status === 'active') {
            mainBtn.innerHTML = '⏸️ 暂停';
            mainBtn.style.background = '#FFA500';
            mainBtn.setAttribute('onclick', `pauseTaskTimer('${taskId}')`);
        } else if (timerData.status === 'paused') {
            mainBtn.innerHTML = '▶️ 继续';
            mainBtn.style.background = '#4CAF50';
            mainBtn.setAttribute('onclick', `resumeTaskTimer('${taskId}')`);
        }
    }
}

// 格式化时间显示
function formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
}

// 设置任务提醒
function setupTaskReminders() {
    // 清除所有现有的提醒
    taskReminders.forEach(timeoutId => clearTimeout(timeoutId));
    taskReminders.clear();
    
    // 为所有有计划时间的待完成任务设置提醒
    const tasks = window.currentTasks || [];
    const now = new Date();
    
    tasks.forEach(task => {
        if (task.scheduled_start && (task.status === 'pending' || task.status === 'in_progress')) {
            const scheduledTime = new Date(task.scheduled_start);
            const timeUntilTask = scheduledTime - now;
            
            // 30分钟前开始闪烁提醒
            const thirtyMinutesBefore = timeUntilTask - 30 * 60 * 1000;
            if (thirtyMinutesBefore > 0) {
                const flashTimeoutId = setTimeout(() => {
                    // 添加闪烁效果
                    const taskElement = document.querySelector(`[data-task-id="${task.id}"]`);
                    if (taskElement) {
                        taskElement.classList.add('task-flash-warning');
                    }
                    showToast(`⏰ 任务 "${task.title}" 将在30分钟后开始`, 'info');
                }, thirtyMinutesBefore);
                taskReminders.set(`${task.id}-flash`, flashTimeoutId);
            } else if (timeUntilTask > 0 && timeUntilTask <= 30 * 60 * 1000) {
                // 如果已经在30分钟内，立即添加闪烁
                const taskElement = document.querySelector(`[data-task-id="${task.id}"]`);
                if (taskElement) {
                    taskElement.classList.add('task-flash-warning');
                }
            }
            
            if (timeUntilTask > 0) {
                // 设置准时提醒
                const timeoutId = setTimeout(() => {
                    showNotification(
                        '任务提醒',
                        `任务 "${task.title}" 计划开始时间到了！`,
                        task.id
                    );
                    
                    // 移除闪烁效果
                    const taskElement = document.querySelector(`[data-task-id="${task.id}"]`);
                    if (taskElement) {
                        taskElement.classList.remove('task-flash-warning');
                        taskElement.classList.add('task-should-start');
                    }
                    
                    // 同时显示页面内提醒
                    showToast(`⏰ 任务 "${task.title}" 计划开始时间到了！`, 'warning');
                    
                    // 自动开始计时器（可选）
                    if (confirm(`是否开始任务 "${task.title}" 的计时器？`)) {
                        startTaskTimer(task.id, task.title);
                    }
                }, timeUntilTask);
                
                taskReminders.set(task.id, timeoutId);
            } else if (timeUntilTask > -3600000 && timeUntilTask < -300000) { // 过去5分钟到1小时内的任务
                // 只对已经过期超过5分钟的任务提醒（避免刚设置的时间就提醒）
                showToast(`⚠️ 任务 "${task.title}" 已过计划时间！`, 'warning');
                
                // 添加过期样式
                const taskElement = document.querySelector(`[data-task-id="${task.id}"]`);
                if (taskElement) {
                    taskElement.classList.add('task-should-start');
                }
            }
        }
    });
}

// 恢复活动的计时器（用于页面刷新后）
function restoreActiveTimers() {
    // 从localStorage恢复计时器状态
    const savedTimers = localStorage.getItem('activeTimers');
    if (savedTimers) {
        try {
            const timersData = JSON.parse(savedTimers);
            Object.entries(timersData).forEach(([taskId, timerInfo]) => {
                const task = window.currentTasks.find(t => t.id === taskId);
                // 检查任务是否存在且未完成（in_progress或pending状态都可以恢复计时器）
                if (task && task.status !== 'completed') {
                    // 恢复计时器
                    const startTime = new Date(timerInfo.startTime);
                    const now = new Date();
                    const elapsedSeconds = Math.floor((now - startTime) / 1000);
                    
                    const timerData = {
                        startTime: startTime,
                        actualStart: timerInfo.actualStart,
                        intervalId: null,
                        elapsedSeconds: elapsedSeconds
                    };
                    
                    // 更新UI显示计时器
                    updateTimerDisplay(taskId, elapsedSeconds);
                    
                    // 设置定时更新
                    timerData.intervalId = setInterval(() => {
                        timerData.elapsedSeconds++;
                        updateTimerDisplay(taskId, timerData.elapsedSeconds);
                        
                        // 保存计时器状态
                        saveTimersToLocalStorage();
                    }, 1000);
                    
                    activeTimers.set(taskId, timerData);
                }
            });
        } catch (error) {
            console.error('恢复计时器失败:', error);
            localStorage.removeItem('activeTimers');
        }
    }
}

// 保存计时器状态到localStorage
function saveTimersToLocalStorage() {
    const timersData = {};
    taskTimerData.forEach((data, taskId) => {
        timersData[taskId] = {
            status: data.status,
            elapsedSeconds: data.elapsedSeconds,
            startTime: data.startTime instanceof Date ? data.startTime.toISOString() : data.startTime,
            actualStart: data.actualStart
        };
    });
    localStorage.setItem('taskTimers', JSON.stringify(timersData));
}

// 显示 Toast 提示
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// 清空输入
function clearInput() {
    document.getElementById('aiTaskInput').value = '';
    const resultDiv = document.getElementById('processResult');
    resultDiv.classList.add('hidden');
}

// 快速添加单个任务
async function addQuickTask() {
    console.log('开始添加快速任务');
    
    const titleInput = document.getElementById('quickTaskInput');
    const domainSelect = document.getElementById('quickTaskDomain');
    const minutesInput = document.getElementById('quickTaskMinutes');
    
    if (!titleInput || !domainSelect || !minutesInput) {
        console.error('找不到输入元素');
        showToast('页面元素错误', 'error');
        return;
    }
    
    const title = titleInput.value.trim();
    if (!title) {
        showToast('请输入任务标题', 'warning');
        return;
    }
    
    const domain = domainSelect.value;
    const estimatedMinutes = parseInt(minutesInput.value) || 30;
    
    console.log('任务信息:', { title, domain, estimatedMinutes });
    
    try {
        // 自动安排时间
        const scheduledTime = await autoScheduleTaskTime({ 
            estimated_minutes: estimatedMinutes,
            domain: domain 
        });
        
        const taskData = {
            title: title,
            domain: domain,
            estimated_minutes: estimatedMinutes,
            priority: 3, // 默认中等优先级
            status: 'pending',
            scheduled_start: scheduledTime ? scheduledTime.toISOString() : null,
            scheduled_end: scheduledTime ? 
                new Date(scheduledTime.getTime() + estimatedMinutes * 60000).toISOString() : null
        };
        
        // 使用本地时间而非UTC
        if (scheduledTime) {
            const toLocalISOString = (date) => {
                const tzOffset = date.getTimezoneOffset() * 60000;
                const localTime = new Date(date.getTime() - tzOffset);
                return localTime.toISOString().slice(0, -1) + '+00:00';
            };
            taskData.scheduled_start = toLocalISOString(scheduledTime);
            taskData.scheduled_end = toLocalISOString(new Date(scheduledTime.getTime() + estimatedMinutes * 60000));
        }
        
        const response = await fetch(`${API_BASE}/tasks`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(taskData)
        });
        
        if (response.ok) {
            const result = await response.json();
            showToast(`✅ 添加任务：${title}`, 'success');
            
            // 清空输入框
            titleInput.value = '';
            minutesInput.value = '30';
            
            // 刷新任务列表
            await loadTasks();
            await updateDashboard();
            
            // 设置提醒
            setupTaskReminders();
        } else {
            const error = await response.text();
            showToast(`添加失败: ${error}`, 'error');
        }
    } catch (error) {
        console.error('添加任务失败:', error);
        showToast('添加任务失败', 'error');
    }
}

// AI 智能处理任务
async function aiProcessTasks() {
    const textarea = document.getElementById('aiTaskInput');
    const input = textarea.value.trim();
    
    if (!input) {
        showToast('请输入任务描述', 'error');
        return;
    }
    
    // 显示处理中状态
    const processingDiv = document.getElementById('aiProcessing');
    const resultDiv = document.getElementById('processResult');
    processingDiv.classList.remove('hidden');
    resultDiv.classList.add('hidden');
    
    try {
        const response = await fetch(`${API_BASE}/tasks/ai-process`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ input: input })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // 显示处理结果
            showProcessResult(data);
            showToast(data.message, 'success');
            
            // 清空输入框
            textarea.value = '';
            
            // 刷新任务列表和仪表板
            await loadTasks();
            await updateDashboard();
        } else {
            showToast(data.detail || '处理失败', 'error');
        }
    } catch (error) {
        console.error('Error:', error);
        showToast('网络错误，请稍后重试', 'error');
    } finally {
        processingDiv.classList.add('hidden');
    }
}

// 显示处理结果
function showProcessResult(data) {
    const resultDiv = document.getElementById('processResult');
    
    if (!data.tasks || data.tasks.length === 0) {
        resultDiv.classList.add('hidden');
        return;
    }
    
    // 按域分组
    const tasksByDomain = {
        academic: [],
        income: [],
        growth: [],
        life: []
    };
    
    data.tasks.forEach(task => {
        if (tasksByDomain[task.domain]) {
            tasksByDomain[task.domain].push(task);
        }
    });
    
    // 生成结果 HTML
    let html = `
        <div class="result-header">
            ✅ 成功处理 ${data.count} 个任务
        </div>
        <div class="result-tasks">
    `;
    
    const domainNames = {
        academic: '🎓 学术',
        income: '💰 收入',
        growth: '🌱 成长',
        life: '🏠 生活'
    };
    
    for (const [domain, tasks] of Object.entries(tasksByDomain)) {
        if (tasks.length > 0) {
            html += `<div class="domain-group">
                <div class="domain-title">${domainNames[domain]} (${tasks.length})</div>`;
            
            tasks.forEach(task => {
                const scheduleInfo = task.scheduled_start 
                    ? `📅 ${new Date(task.scheduled_start).toLocaleString('zh-CN', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}`
                    : '待安排';
                
                html += `
                    <div class="result-task-item">
                        <span class="task-name">${task.title}</span>
                        <span class="task-info">
                            ⏱ ${task.estimated_minutes}分钟 | 
                            ${scheduleInfo} | 
                            🤖 ${Math.round(task.ai_confidence * 100)}%
                        </span>
                    </div>
                `;
            });
            
            html += `</div>`;
        }
    }
    
    html += `</div>`;
    
    resultDiv.innerHTML = html;
    resultDiv.classList.remove('hidden');
    
    // 5秒后自动隐藏
    setTimeout(() => {
        resultDiv.classList.add('hidden');
    }, 8000);
}

// 加载任务列表
async function loadTasks() {
    try {
        const response = await fetch(`${API_BASE}/tasks`);
        const data = await response.json();
        
        // 保存任务数据到全局变量，供提醒功能使用
        window.currentTasks = data.tasks;
        
        // 清理已完成任务的计时器
        data.tasks.forEach(task => {
            if (task.status === 'completed') {
                // 如果任务已完成，确保没有活动或暂停的计时器
                if (activeTimers.has(task.id)) {
                    const timer = activeTimers.get(task.id);
                    if (timer.intervalId) {
                        clearInterval(timer.intervalId);
                    }
                    activeTimers.delete(task.id);
                    saveTimersToLocalStorage();
                }
                if (pausedTimers.has(task.id)) {
                    pausedTimers.delete(task.id);
                    savePausedTimersToLocalStorage();
                }
            }
        });
        
        const tasksList = document.getElementById('tasksList');
        
        if (data.tasks.length === 0) {
            tasksList.innerHTML = '<div class="no-tasks">暂无任务，请添加新任务</div>';
            return;
        }
        
        // 分类任务
        const pendingTasks = data.tasks.filter(t => t.status === 'pending' || t.status === 'in_progress');
        const waitingTasks = data.tasks.filter(t => t.status === 'waiting');
        const poolTasks = data.tasks.filter(t => t.status === 'pool' || (!t.scheduled_start && t.status !== 'completed' && t.status !== 'in_progress'));
        const completedTasks = data.tasks.filter(t => t.status === 'completed');
        
        // 按优先级排序（优先级高的在前），优先级相同则按时间排序
        pendingTasks.sort((a, b) => {
            // 确保优先级有默认值
            const priorityA = a.priority || 3;
            const priorityB = b.priority || 3;
            
            // 先按优先级排序（数字越大优先级越高，所以用 b - a）
            if (priorityA !== priorityB) {
                return priorityB - priorityA;
            }
            
            // 优先级相同，按计划时间排序
            if (a.scheduled_start && b.scheduled_start) {
                return new Date(a.scheduled_start) - new Date(b.scheduled_start);
            } else if (a.scheduled_start) {
                return -1; // 有计划时间的排在前面
            } else if (b.scheduled_start) {
                return 1;
            }
            
            return 0;
        });
        
        // 调试：打印排序后的任务优先级
        console.log('排序后的任务:', pendingTasks.map(t => ({
            title: t.title,
            priority: t.priority,
            scheduled_start: t.scheduled_start
        })));
        
        // 构建HTML
        let html = '';
        
        // 待完成任务
        html += '<div class="tasks-pending task-drop-zone" data-status="pending">';
        html += '<h3>🎯 待完成任务 <span style="font-size: 12px; color: #666;">（今日要做的任务，包括进行中）</span></h3>';
        html += '<div class="tasks-container">';
        if (pendingTasks.length > 0) {
            html += pendingTasks.map(task => renderTaskItem(task)).join('');
        } else {
            html += '<div class="empty-hint">拖动任务到这里开始执行</div>';
        }
        html += '</div></div>';
        
        // 等待任务
        html += '<div class="tasks-waiting task-drop-zone" data-status="waiting">';
        html += '<h3>⏳ 等待任务 <span style="font-size: 12px; color: #666;">（等待条件满足）</span></h3>';
        html += '<div class="tasks-container">';
        if (waitingTasks.length > 0) {
            html += waitingTasks.map(task => renderTaskItem(task)).join('');
        } else {
            html += '<div class="empty-hint">等待中的任务会显示在这里</div>';
        }
        html += '</div></div>';
        
        // 任务池
        html += '<div class="tasks-pool task-drop-zone" data-status="pool">';
        html += '<h3>📋 任务池 <span style="font-size: 12px; color: #666;">（AI处理的任务，拖到待完成区域执行）</span>';
        if (poolTasks.length > 0) {
            html += `
                <button onclick="selectAllPoolTasks()" class="btn-small" style="margin-left: 10px;">全选</button>
                <button onclick="moveSelectedToToday()" class="btn-small btn-primary" style="margin-left: 5px;">移到今日任务</button>
            `;
        }
        html += '</h3>';
        html += '<div class="tasks-container">';
        if (poolTasks.length > 0) {
            html += poolTasks.map(task => renderTaskItem(task)).join('');
        } else {
            html += '<div class="empty-hint">AI处理的任务会放在这里</div>';
        }
        html += '</div></div>';
        
        // 已完成任务
        if (completedTasks.length > 0) {
            html += '<div class="tasks-completed task-drop-zone" data-status="completed"><h3>今日已完成</h3>';
            html += '<div class="tasks-container">';
            html += completedTasks.map(task => renderTaskItem(task)).join('');
            html += '</div></div>';
        }
        
        tasksList.innerHTML = html;
        
        // 初始化拖放功能
        initDragAndDrop();
        
        // 更新各域的任务列表和进度圆环
        updateDomainDisplay(data.tasks);
        
        // 设置任务提醒
        setupTaskReminders();
        
        // 恢复正在进行的计时器（如果页面刷新后）
        restoreActiveTimers();
        
    } catch (error) {
        console.error('Error loading tasks:', error);
        console.error('Error details:', error.stack);
        // 不显示错误提示，避免干扰用户
        // showToast('加载任务失败', 'error');
    }
}

// 渲染单个任务项
function renderTaskItem(task) {
    const domainColors = {
        academic: '#4285F4',
        income: '#34A853',
        growth: '#FBBC04',
        life: '#EA4335'
    };
    
    // 检查任务的计时器状态
    const timerData = taskTimerData.get(task.id);
    let hasActiveTimer = timerData && timerData.status === 'active';
    let hasPausedTimer = timerData && timerData.status === 'paused';
    
    // 如果没有在内存中找到，检查localStorage
    if (!timerData) {
        const savedTimers = localStorage.getItem('taskTimers');
        if (savedTimers) {
            try {
                const timersData = JSON.parse(savedTimers);
                if (timersData[task.id]) {
                    const savedData = timersData[task.id];
                    hasActiveTimer = savedData.status === 'active';
                    hasPausedTimer = savedData.status === 'paused';
                }
            } catch (e) {
                // 忽略错误
            }
        }
    }
    
    return `
        <div class="task-item ${task.domain} ${task.status}" 
             data-task-id="${task.id}" 
             draggable="true" 
             ondragstart="handleDragStart(event, '${task.id}')"
             ondragend="handleDragEnd(event)">
            <span class="drag-handle">⋮⋮</span>
            <input type="checkbox" class="task-checkbox" 
                   ${task.status === 'completed' ? 'checked' : ''}
                   onchange="toggleTaskStatus('${task.id}', this.checked)">
            <div class="task-content">
                <div class="task-title" contenteditable="true" 
                     onblur="updateTaskTitle('${task.id}', this.innerText)"
                     onkeypress="if(event.key==='Enter'){event.preventDefault();this.blur();}">${task.title}</div>
                <div class="task-meta">
                    <select class="domain-selector ${task.domain}" 
                            onchange="changeTaskDomain('${task.id}', this.value)"
                            data-current="${task.domain}">
                        <option value="academic" ${task.domain === 'academic' ? 'selected' : ''}>🎓 学术</option>
                        <option value="income" ${task.domain === 'income' ? 'selected' : ''}>💰 收入</option>
                        <option value="growth" ${task.domain === 'growth' ? 'selected' : ''}>🌱 成长</option>
                        <option value="life" ${task.domain === 'life' ? 'selected' : ''}>🏠 生活</option>
                    </select>
                    <span>⏱ <input type="number" class="inline-edit-number" value="${task.estimated_minutes || 30}" 
                            onchange="updateTaskField('${task.id}', 'estimated_minutes', this.value)" min="5" max="480"> 分钟</span>
                    <span>🎯 优先级 <select class="inline-edit-select" 
                            onchange="updateTaskField('${task.id}', 'priority', this.value)">
                        ${[1,2,3,4,5].map(p => `<option value="${p}" ${task.priority === p ? 'selected' : ''}>${p}</option>`).join('')}
                    </select></span>
                    ${task.status !== 'pool' ? `<span class="time-input-wrapper">📅 
                        <input type="text" class="inline-edit-time" 
                               value="${task.scheduled_start ? formatTimeForDisplay(task.scheduled_start) : ''}"
                               placeholder="HHMM"
                               maxlength="4"
                               onchange="updateTaskTime('${task.id}', this.value)"
                               title="输入四位数时间，如 0930 表示 9:30，23 表示 23:00">
                    </span>` : ''}
                </div>
            </div>
            <div class="task-actions">
                ${task.status !== 'completed' ? 
                    (hasActiveTimer ? 
                        `<button onclick="pauseTaskTimer('${task.id}')" class="btn-small btn-timer" style="background: #FFA500;">⏸️ 暂停</button>` :
                        (hasPausedTimer ? 
                            `<button onclick="resumeTaskTimer('${task.id}')" class="btn-small btn-timer btn-resume" style="background: #4CAF50;">▶️ 继续</button>` :
                            `<button onclick="startTaskTimer('${task.id}', '${task.title.replace(/'/g, "\\'")}')" class="btn-small btn-timer" style="background: #4CAF50;">▶️ 开始</button>`
                        )
                    ) : ''}
                <input type="checkbox" class="task-select-checkbox" 
                       data-task-id="${task.id}"
                       onchange="toggleTaskSelection('${task.id}')">
                <button onclick="deleteTask('${task.id}')" class="btn-small btn-danger">删除</button>
            </div>
        </div>
    `;
}

// 更新域显示和进度圆环
function updateDomainDisplay(tasks) {
    const domains = ['academic', 'income', 'growth', 'life'];
    domains.forEach(domain => {
        // 只统计今日任务（pending、in_progress、completed）
        const todayDomainTasks = tasks.filter(t => 
            t.domain === domain && 
            (t.status === 'pending' || t.status === 'in_progress' || t.status === 'completed')
        );
        
        const domainElement = document.getElementById(`${domain}Tasks`);
        
        // 更新任务列表 - 只显示今日任务
        if (todayDomainTasks.length > 0) {
            domainElement.innerHTML = todayDomainTasks.slice(0, 3).map(task => `
                <div class="mini-task ${task.status}">
                    ${task.status === 'completed' ? '✓ ' : ''}${task.title.substring(0, 20)}${task.title.length > 20 ? '...' : ''}
                </div>
            `).join('');
        } else {
            domainElement.innerHTML = '<div class="no-tasks-mini">暂无任务</div>';
        }
        
        // 更新进度圆环 - 根据今日任务统计
        const completedMinutes = todayDomainTasks
            .filter(t => t.status === 'completed')
            .reduce((sum, t) => sum + (t.estimated_minutes || 0), 0);
        const inProgressMinutes = todayDomainTasks
            .filter(t => t.status === 'in_progress')
            .reduce((sum, t) => sum + (t.estimated_minutes || 0), 0);
        const pendingMinutes = todayDomainTasks
            .filter(t => t.status === 'pending')
            .reduce((sum, t) => sum + (t.estimated_minutes || 0), 0);
        
        updateDomainProgress(domain, completedMinutes, inProgressMinutes, pendingMinutes);
    });
}

// 更新仪表板
async function updateDashboard() {
    try {
        const response = await fetch(`${API_BASE}/analytics/daily`);
        const data = await response.json();
        
        // 更新统计数据
        document.getElementById('todayCompleted').textContent = 
            `${data.summary.completed_tasks}/${data.summary.total_tasks}`;
        document.getElementById('productivityScore').textContent = 
            `${data.summary.productivity_score}%`;
        
        // 更新各域进度 - 基于实际今日任务
        const domains = ['academic', 'income', 'growth', 'life'];
        const tasks = window.currentTasks || [];
        
        domains.forEach(domain => {
            // 只统计今日任务（pending、in_progress、completed）
            const todayDomainTasks = tasks.filter(t => 
                t.domain === domain && 
                (t.status === 'pending' || t.status === 'in_progress' || t.status === 'completed')
            );
            
            // 计算已完成的小时数
            const completedHours = todayDomainTasks
                .filter(t => t.status === 'completed')
                .reduce((sum, t) => sum + (t.estimated_minutes || 0) / 60, 0);
            
            // 计算总计划小时数（包括已完成、正在进行、待完成）
            const totalPlannedHours = todayDomainTasks
                .reduce((sum, t) => sum + (t.estimated_minutes || 0) / 60, 0);
            
            const circle = document.getElementById(`${domain}Progress`);
            
            if (circle) {
                // 计算进度百分比
                const progress = totalPlannedHours > 0 ? (completedHours / totalPlannedHours) * 100 : 0;
                const circumference = 2 * Math.PI * 54;
                const offset = circumference - (progress / 100) * circumference;
                circle.style.strokeDashoffset = offset;
                
                // 更新文字 - 显示 [已完成小时数]/[计划小时数]
                const card = document.querySelector(`.domain-card.${domain}`);
                if (card) {
                    const hoursText = card.querySelector('.hours');
                    hoursText.textContent = `${completedHours.toFixed(1)}/${totalPlannedHours.toFixed(1)}`;
                }
            }
        });
        
        // 更新 AI 洞察
        if (data.recommendations && data.recommendations.length > 0) {
            const insightsDiv = document.getElementById('aiInsights');
            insightsDiv.innerHTML = data.recommendations.map(rec => `
                <div class="insight-item">${rec}</div>
            `).join('');
        }
        
    } catch (error) {
        console.error('Error updating dashboard:', error);
    }
}

// 优化日程
async function optimizeSchedule() {
    showToast('正在优化日程...', 'info');
    
    try {
        const response = await fetch(`${API_BASE}/tasks`);
        const tasksData = await response.json();
        
        if (tasksData.tasks.length === 0) {
            showToast('没有任务需要优化', 'info');
            return;
        }
        
        const taskIds = tasksData.tasks
            .filter(t => t.status !== 'completed')
            .map(t => t.id);
        
        const optimizeResponse = await fetch(`${API_BASE}/schedule/optimize`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                task_ids: taskIds,
                date_range_start: new Date().toISOString(),
                date_range_end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                respect_energy_levels: true,
                allow_domain_overflow: false
            })
        });
        
        const result = await optimizeResponse.json();
        
        if (result.success) {
            showToast(result.message, 'success');
            await loadTasks();
            await updateDashboard();
        }
    } catch (error) {
        console.error('Error optimizing schedule:', error);
        showToast('优化失败', 'error');
    }
}

// 更新本体论
async function updateOntology() {
    showToast('AI 正在学习您的使用模式...', 'info');
    
    try {
        const response = await fetch(`${API_BASE}/ontology/update`, {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast('AI 学习完成！', 'success');
            
            // 显示学习结果
            if (data.insights && data.insights.length > 0) {
                const insightsDiv = document.getElementById('aiInsights');
                insightsDiv.innerHTML = `
                    <div class="insight-item">
                        <strong>🧠 AI 学习结果：</strong><br>
                        ${data.insights.join('<br>')}
                    </div>
                    ${data.recommendations.map(rec => `
                        <div class="insight-item">${rec}</div>
                    `).join('')}
                `;
            }
        } else {
            showToast(data.message || 'AI 学习失败', 'info');
        }
    } catch (error) {
        console.error('Error updating ontology:', error);
        showToast('AI 学习失败', 'error');
    }
}

// 切换任务状态
async function toggleTask(taskId) {
    // 这里应该调用 API 更新任务状态
    console.log('Toggle task:', taskId);
    showToast('任务状态已更新', 'success');
}

// 删除任务
async function deleteTask(taskId) {
    if (!confirm('确定要删除这个任务吗？')) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/tasks/${taskId}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            showToast(data.message || '任务已删除', 'success');
            await loadTasks();
            await updateDashboard();
        } else {
            showToast(data.detail || '删除失败', 'error');
        }
    } catch (error) {
        console.error('删除任务失败:', error);
        showToast('删除任务失败', 'error');
    }
}

// 全选/取消全选
let allSelected = false;
let selectedTasks = new Set();

function toggleSelectAll() {
    allSelected = !allSelected;
    const checkboxes = document.querySelectorAll('.task-select-checkbox');
    
    checkboxes.forEach(checkbox => {
        checkbox.checked = allSelected;
        const taskId = checkbox.dataset.taskId;
        if (allSelected) {
            selectedTasks.add(taskId);
        } else {
            selectedTasks.delete(taskId);
        }
    });
    
    updateSelectionUI();
}

// 切换单个任务选择
function toggleTaskSelection(taskId) {
    const checkbox = document.querySelector(`.task-select-checkbox[data-task-id="${taskId}"]`);
    
    if (checkbox.checked) {
        selectedTasks.add(taskId);
    } else {
        selectedTasks.delete(taskId);
    }
    
    updateSelectionUI();
}

// 更新选择UI
function updateSelectionUI() {
    const deleteBtn = document.querySelector('.btn-delete-selected');
    const selectAllBtn = document.querySelector('.btn-select-all');
    
    if (selectedTasks.size > 0) {
        deleteBtn.style.display = 'inline-block';
        deleteBtn.innerHTML = `<span class="btn-icon">🗑️</span> 删除选中 (${selectedTasks.size})`;
    } else {
        deleteBtn.style.display = 'none';
    }
    
    // 更新任务项的选中样式
    document.querySelectorAll('.task-item').forEach(item => {
        const taskId = item.dataset.taskId;
        if (selectedTasks.has(taskId)) {
            item.classList.add('selected');
        } else {
            item.classList.remove('selected');
        }
    });
}

// 批量删除选中的任务
async function deleteSelectedTasks() {
    if (selectedTasks.size === 0) {
        showToast('请先选择要删除的任务', 'warning');
        return;
    }
    
    if (!confirm(`确定要删除选中的 ${selectedTasks.size} 个任务吗？`)) {
        return;
    }
    
    let successCount = 0;
    let failCount = 0;
    
    for (const taskId of selectedTasks) {
        try {
            const response = await fetch(`${API_BASE}/tasks/${taskId}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.ok) {
                successCount++;
            } else {
                failCount++;
            }
        } catch (error) {
            console.error(`删除任务 ${taskId} 失败:`, error);
            failCount++;
        }
    }
    
    if (successCount > 0) {
        showToast(`成功删除 ${successCount} 个任务`, 'success');
    }
    if (failCount > 0) {
        showToast(`${failCount} 个任务删除失败`, 'error');
    }
    
    selectedTasks.clear();
    allSelected = false;
    await loadTasks();
    await updateDashboard();
}

// 全选任务池中的任务
function selectAllPoolTasks() {
    const poolTaskElements = document.querySelectorAll('.tasks-pool .task-item');
    poolTaskElements.forEach(item => {
        const taskId = item.dataset.taskId;
        const checkbox = item.querySelector('.task-select-checkbox');
        if (checkbox) {
            selectedTasks.add(taskId);
            checkbox.checked = true;
        }
    });
    updateSelectionUI();
}

// 将选中的任务移到今日任务
async function moveSelectedToToday() {
    if (selectedTasks.size === 0) {
        showToast('请先选择要移动的任务', 'warning');
        return;
    }
    
    let successCount = 0;
    let failCount = 0;
    
    for (const taskId of selectedTasks) {
        try {
            // 获取任务信息
            const tasksResponse = await fetch(`${API_BASE}/tasks`);
            const tasksData = await tasksResponse.json();
            const task = tasksData.tasks.find(t => t.id === taskId);
            
            if (task && task.status === 'pool') {
                // 自动安排时间
                const scheduledTime = await autoScheduleTaskTime(task);
                let updateData = { status: 'pending' };
                
                if (scheduledTime) {
                    updateData.scheduled_start = scheduledTime.toISOString();
                    updateData.scheduled_end = new Date(scheduledTime.getTime() + (task.estimated_minutes || 30) * 60000).toISOString();
                }
                
                const response = await fetch(`${API_BASE}/tasks/${taskId}`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(updateData)
                });
                
                if (response.ok) {
                    successCount++;
                } else {
                    failCount++;
                }
            }
        } catch (error) {
            console.error(`移动任务 ${taskId} 失败:`, error);
            failCount++;
        }
    }
    
    if (successCount > 0) {
        showToast(`成功移动 ${successCount} 个任务到今日任务`, 'success');
    }
    if (failCount > 0) {
        showToast(`${failCount} 个任务移动失败`, 'error');
    }
    
    // 清空选中列表
    selectedTasks.clear();
    updateSelectionUI();
    
    // 刷新任务列表
    await loadTasks();
}

// 更新圆环进度显示 - 重写为更稳定的版本
function updateDomainProgress(domain, completedMinutes, inProgressMinutes, pendingMinutes) {
    const card = document.querySelector(`.domain-card.${domain}`);
    if (!card) return;
    
    const svgElement = card.querySelector('svg');
    if (!svgElement) return;
    
    const totalMinutes = completedMinutes + inProgressMinutes + pendingMinutes;
    const maxHours = 4; // 每个域4小时
    
    // 计算角度（基于360度）
    const completedAngle = Math.min((completedMinutes / 60) / maxHours * 360, 360);
    const inProgressAngle = Math.min((inProgressMinutes / 60) / maxHours * 360, 360);
    const pendingAngle = Math.min((pendingMinutes / 60) / maxHours * 360, 360);
    
    // 定义各域的颜色
    const domainColors = {
        'academic': '#4285F4',
        'income': '#34A853',
        'growth': '#FBBC04',
        'life': '#EA4335'
    };
    
    const color = domainColors[domain] || '#4285F4';
    
    // 完全重建SVG内容，避免DOM操作冲突
    const radius = 54;
    const cx = 60;
    const cy = 60;
    const strokeWidth = 8;
    
    // 创建新的SVG内容
    let svgContent = `
        <!-- 背景圆 -->
        <circle cx="${cx}" cy="${cy}" r="${radius}" 
                fill="none" stroke="#e0e0e0" stroke-width="${strokeWidth}"/>
    `;
    
    // 辅助函数：创建圆弧路径
    function createArcPath(startAngle, endAngle, opacity) {
        if (endAngle - startAngle <= 0) return '';
        
        const start = polarToCartesian(cx, cy, radius, startAngle);
        const end = polarToCartesian(cx, cy, radius, endAngle);
        const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
        
        return `
            <path d="M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y}"
                  fill="none" stroke="${color}" stroke-width="${strokeWidth}"
                  opacity="${opacity}" stroke-linecap="round"/>
        `;
    }
    
    // 辅助函数：创建带类名的圆弧路径（用于动画）
    function createArcPathWithClass(startAngle, endAngle, opacity, className) {
        if (endAngle - startAngle <= 0) return '';
        
        const start = polarToCartesian(cx, cy, radius, startAngle);
        const end = polarToCartesian(cx, cy, radius, endAngle);
        const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
        
        return `
            <path class="${className}" d="M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y}"
                  fill="none" stroke="${color}" stroke-width="${strokeWidth}"
                  opacity="${opacity}" stroke-linecap="round"/>
        `;
    }
    
    // 辅助函数：极坐标转笛卡尔坐标
    function polarToCartesian(centerX, centerY, radius, angleInDegrees) {
        const angleInRadians = (angleInDegrees - 90) * Math.PI / 180.0;
        return {
            x: centerX + (radius * Math.cos(angleInRadians)),
            y: centerY + (radius * Math.sin(angleInRadians))
        };
    }
    
    // 添加各部分圆弧（按顺序：待完成、进行中、已完成）
    let currentAngle = 0;
    
    // 1. 已完成部分（深色）
    if (completedMinutes > 0) {
        svgContent += createArcPath(0, completedAngle, 1.0);
        currentAngle = completedAngle;
    }
    
    // 2. 进行中部分（中等透明度，带动画）
    if (inProgressMinutes > 0) {
        const inProgressPath = createArcPathWithClass(currentAngle, currentAngle + inProgressAngle, 0.6, 'in-progress-ring');
        svgContent += inProgressPath;
        currentAngle += inProgressAngle;
    }
    
    // 3. 待完成部分（浅色）
    if (pendingMinutes > 0) {
        svgContent += createArcPath(currentAngle, currentAngle + pendingAngle, 0.3);
    }
    
    // 一次性更新SVG内容
    svgElement.innerHTML = svgContent;
    
    // 更新文本显示
    const hoursText = card.querySelector('.hours');
    if (hoursText) {
        const completedHours = (completedMinutes / 60).toFixed(1);
        const totalPlannedHours = (totalMinutes / 60).toFixed(1);
        hoursText.textContent = `${completedHours}/${totalPlannedHours}`;
    }
}

// 更新任务标题
async function updateTaskTitle(taskId, newTitle) {
    if (!newTitle.trim()) return;
    
    try {
        const response = await fetch(`${API_BASE}/tasks/${taskId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                title: newTitle.trim()
            })
        });
        
        if (response.ok) {
            showToast('任务标题已更新', 'success');
        } else {
            showToast('更新失败', 'error');
            await loadTasks();
        }
    } catch (error) {
        console.error('更新任务标题失败:', error);
        showToast('更新失败', 'error');
        await loadTasks();
    }
}

// 更新任务字段
async function updateTaskField(taskId, field, value) {
    try {
        const updateData = {};
        updateData[field] = field === 'estimated_minutes' || field === 'priority' ? parseInt(value) : value;
        
        const response = await fetch(`${API_BASE}/tasks/${taskId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(updateData)
        });
        
        if (response.ok) {
            showToast(`${field === 'estimated_minutes' ? '预计时间' : '优先级'}已更新`, 'success');
            await loadTasks();
            await updateDashboard();
        } else {
            showToast('更新失败', 'error');
            await loadTasks();
        }
    } catch (error) {
        console.error(`更新任务${field}失败:`, error);
        showToast('更新失败', 'error');
        await loadTasks();
    }
}

// 更新任务小时
async function updateTaskHour(taskId, hour) {
    if (hour === '' || hour < 0 || hour > 23) return;
    
    // 获取当前任务的分钟（如果有）
    const taskElement = document.querySelector(`[data-task-id="${taskId}"]`);
    const minuteInput = taskElement ? taskElement.querySelector('.inline-edit-minute') : null;
    const minute = minuteInput ? (minuteInput.value || 0) : 0;
    
    const date = new Date();
    date.setHours(parseInt(hour), parseInt(minute), 0, 0);
    
    await updateTaskTimeWithDate(taskId, date);
}

// 更新任务分钟
async function updateTaskMinute(taskId, minute) {
    if (minute === '' || minute < 0 || minute > 59) return;
    
    // 获取当前任务的小时（如果有）
    const taskElement = document.querySelector(`[data-task-id="${taskId}"]`);
    const hourInput = taskElement ? taskElement.querySelector('.inline-edit-hour') : null;
    const hour = hourInput ? (hourInput.value || new Date().getHours()) : new Date().getHours();
    
    const date = new Date();
    date.setHours(parseInt(hour), parseInt(minute), 0, 0);
    
    await updateTaskTimeWithDate(taskId, date);
}

// 格式化时间为输入框显示（处理时区问题）
function formatTimeForDisplay(isoString) {
    if (!isoString) return '';
    
    // 解析ISO字符串，但保持本地时间解释
    const date = new Date(isoString);
    
    // 获取本地时间的小时和分钟
    const hours = date.getHours();
    const minutes = date.getMinutes();
    
    // 如果是整点，只返回小时数
    if (minutes === 0) {
        return hours.toString();
    }
    
    // 非整点时间
    if (hours < 10) {
        return hours.toString() + minutes.toString().padStart(2, '0');
    } else {
        return hours.toString() + minutes.toString().padStart(2, '0');
    }
}

// 格式化时间为输入框显示（旧函数保留兼容）
function formatTimeForInput(date) {
    if (!date || isNaN(date.getTime())) {
        return '';
    }
    
    const hours = date.getHours();
    const minutes = date.getMinutes();
    
    // 如果是整点，只返回小时数
    if (minutes === 0) {
        return hours.toString();
    }
    
    // 非整点时间：确保格式正确
    // 9:30 => "930", 12:04 => "1204"
    if (hours < 10) {
        // 单位数小时
        return hours.toString() + minutes.toString().padStart(2, '0');
    } else {
        // 双位数小时
        return hours.toString() + minutes.toString().padStart(2, '0');
    }
}

// 更新任务时间（支持灵活的时间输入格式）
async function updateTaskTime(taskId, timeStr) {
    try {
        if (!timeStr || timeStr.trim() === '') {
            // 清空时间
            await clearTaskTime(taskId);
            return;
        }
        
        // 去除空格
        timeStr = timeStr.trim();
        
        let hour, minute;
        
        // 解析不同格式的时间输入
        if (timeStr.length === 1 || timeStr.length === 2) {
            // 1-2位数字：表示小时，分钟为0
            // 例如：9 => 9:00, 22 => 22:00
            hour = parseInt(timeStr);
            minute = 0;
        } else if (timeStr.length === 3) {
            // 3位数字：第1位是小时，后2位是分钟
            // 例如：930 => 9:30
            hour = parseInt(timeStr.substring(0, 1));
            minute = parseInt(timeStr.substring(1));
        } else if (timeStr.length === 4) {
            // 4位数字：前2位是小时，后2位是分钟
            // 例如：1332 => 13:32, 2230 => 22:30
            hour = parseInt(timeStr.substring(0, 2));
            minute = parseInt(timeStr.substring(2));
        } else {
            showToast('时间格式错误，请输入如 9, 22, 930 或 2230', 'error');
            return;
        }
        
        // 验证时间有效性
        if (isNaN(hour) || isNaN(minute)) {
            showToast('请输入有效的数字', 'error');
            return;
        }
        
        if (hour < 0 || hour > 23) {
            showToast('小时应在 0-23 之间', 'error');
            return;
        }
        
        if (minute < 0 || minute > 59) {
            showToast('分钟应在 0-59 之间', 'error');
            return;
        }
        
        // 创建时间对象
        const scheduledDate = new Date();
        scheduledDate.setHours(hour, minute, 0, 0);
        
        // 获取任务信息
        const tasksResp = await fetch(`${API_BASE}/tasks`);
        if (!tasksResp.ok) {
            throw new Error('获取任务信息失败');
        }
        
        const tasksData = await tasksResp.json();
        const task = tasksData.tasks.find(t => t.id === taskId);
        
        if (!task) {
            showToast('任务不存在', 'error');
            return;
        }
        
        // 计算结束时间
        const duration = task.estimated_minutes || 30;
        const endDate = new Date(scheduledDate.getTime() + duration * 60000);
        
        // 将本地时间转换为 ISO 格式，但保持本地时区
        const toLocalISOString = (date) => {
            const tzOffset = date.getTimezoneOffset() * 60000;
            const localTime = new Date(date.getTime() - tzOffset);
            return localTime.toISOString().slice(0, -1) + '+00:00';
        };
        
        // 发送更新请求
        const updateResp = await fetch(`${API_BASE}/tasks/${taskId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                scheduled_start: toLocalISOString(scheduledDate),
                scheduled_end: toLocalISOString(endDate)
            })
        });
        
        if (!updateResp.ok) {
            const errorText = await updateResp.text();
            console.error('更新失败:', errorText);
            throw new Error('更新任务时间失败');
        }
        
        // 显示成功消息
        const timeString = `${hour}:${minute.toString().padStart(2, '0')}`;
        showToast(`时间已更新为 ${timeString}`, 'success');
        
        // 重新加载任务列表
        await loadTasks();
        await updateDashboard();
        
    } catch (error) {
        console.error('更新任务时间出错:', error);
        showToast('更新失败，请重试', 'error');
    }
}

// 清空任务时间
async function clearTaskTime(taskId) {
    try {
        const response = await fetch(`${API_BASE}/tasks/${taskId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                scheduled_start: null,
                scheduled_end: null
            })
        });
        
        if (response.ok) {
            showToast('已清空计划时间', 'info');
            await loadTasks();
            await updateDashboard();
        }
    } catch (error) {
        console.error('清空时间失败:', error);
    }
}

// 智能自动安排任务时间（根据用户作息习惯）
async function autoScheduleTaskTime(task) {
    try {
        // 获取所有今日任务以找到空闲时段
        const response = await fetch(`${API_BASE}/tasks`);
        const data = await response.json();
        const todayTasks = data.tasks.filter(t => 
            t.status === 'pending' && 
            t.scheduled_start && 
            t.id !== task.id
        ).sort((a, b) => new Date(a.scheduled_start) - new Date(b.scheduled_start));
        
        // 获取用户作息习惯（从localStorage或默认值）
        const workSchedule = JSON.parse(localStorage.getItem('workSchedule') || '{}');
        const morningStartHour = workSchedule.morningStart || 9;   // 早上9点开始
        const eveningEndHour = workSchedule.eveningEnd || 22;      // 晚上22点结束
        const lunchStartHour = workSchedule.lunchStart || 12;      // 午休开始
        const lunchEndHour = workSchedule.lunchEnd || 13;          // 午休结束
        
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        const taskDuration = task.estimated_minutes || 30;
        
        // 找到合适的时间段
        let bestTime = new Date();
        bestTime.setSeconds(0, 0);
        
        // 根据当前时间判断
        if (currentHour >= 0 && currentHour < 6) {
            // 凌晨0-6点：不应该工作，安排到早上9点
            bestTime.setHours(morningStartHour, 0);
        } else if (currentHour >= 22 || (currentHour === 21 && currentMinute > 30)) {
            // 晚上21:30后：不应该再安排新任务，安排到明天早上
            bestTime.setDate(bestTime.getDate() + 1);
            bestTime.setHours(morningStartHour, 0);
        } else if (currentHour < morningStartHour) {
            // 6-9点：安排到早上9点开始
            bestTime.setHours(morningStartHour, 0);
        } else {
            // 正常工作时间（9-22点）：从当前时间+30分钟开始
            bestTime.setTime(now.getTime() + 30 * 60000); // 当前时间+30分钟
            
            // 向上取整到15分钟
            const minutes = Math.ceil(bestTime.getMinutes() / 15) * 15;
            bestTime.setMinutes(minutes);
            if (minutes >= 60) {
                bestTime.setHours(bestTime.getHours() + 1, 0);
            }
            
            // 如果超过了晚上工作时间，安排到明天
            if (bestTime.getHours() >= eveningEndHour || 
                (bestTime.getHours() === eveningEndHour - 1 && bestTime.getMinutes() > 30)) {
                bestTime.setDate(bestTime.getDate() + 1);
                bestTime.setHours(morningStartHour, 0);
            }
        }
        
        // 检查是否与其他任务冲突，找到空闲时间段
        for (const existingTask of todayTasks) {
            const taskStart = new Date(existingTask.scheduled_start);
            const taskEnd = new Date(existingTask.scheduled_end || 
                new Date(taskStart.getTime() + (existingTask.estimated_minutes || 30) * 60000));
            
            const proposedEnd = new Date(bestTime.getTime() + taskDuration * 60000);
            
            // 检查时间冲突
            if (bestTime < taskEnd && proposedEnd > taskStart) {
                // 有冲突，将开始时间设置为这个任务结束后
                bestTime = new Date(taskEnd);
                
                // 检查是否在午休时间
                if (bestTime.getHours() >= lunchStartHour && bestTime.getHours() < lunchEndHour) {
                    bestTime.setHours(lunchEndHour, 0);
                }
            }
        }
        
        // 确保不在午休时间
        if (bestTime.getHours() >= lunchStartHour && bestTime.getHours() < lunchEndHour) {
            bestTime.setHours(lunchEndHour, 0);
        }
        
        // 学习用户习惯：记录安排的时间
        const scheduleHistory = JSON.parse(localStorage.getItem('scheduleHistory') || '[]');
        scheduleHistory.push({
            domain: task.domain,
            hour: bestTime.getHours(),
            dayOfWeek: bestTime.getDay(),
            duration: taskDuration
        });
        // 只保留最近100条记录
        if (scheduleHistory.length > 100) {
            scheduleHistory.shift();
        }
        localStorage.setItem('scheduleHistory', JSON.stringify(scheduleHistory));
        
        return bestTime;
        
    } catch (error) {
        console.error('自动安排时间失败:', error);
        // 失败时返回当前时间向上取整15分钟
        const now = new Date();
        const minutes = Math.ceil(now.getMinutes() / 15) * 15;
        now.setMinutes(minutes, 0, 0);
        return now;
    }
}

// 自动安排任务时间（旧函数保留兼容性）
async function autoScheduleTask(taskId) {
    try {
        // 获取任务信息
        const response = await fetch(`${API_BASE}/tasks`);
        const data = await response.json();
        const task = data.tasks.find(t => t.id === taskId);
        
        if (!task) {
            showToast('任务不存在', 'error');
            return;
        }
        
        // 根据优先级和当前时间自动安排
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        
        // 高优先级任务安排在更近的时间
        let scheduledTime = new Date();
        
        if (task.priority >= 4) {
            // 高优先级：下一个整点
            if (currentMinute < 30) {
                scheduledTime.setHours(currentHour, 30, 0, 0);
            } else {
                scheduledTime.setHours(currentHour + 1, 0, 0, 0);
            }
        } else if (task.priority >= 3) {
            // 中优先级：2小时后
            scheduledTime.setHours(currentHour + 2, 0, 0, 0);
        } else {
            // 低优先级：4小时后
            scheduledTime.setHours(currentHour + 4, 0, 0, 0);
        }
        
        // 根据任务域调整时间
        if (task.domain === 'academic' && scheduledTime.getHours() > 12) {
            // 学术任务优先安排在上午
            scheduledTime.setDate(scheduledTime.getDate() + 1);
            scheduledTime.setHours(9, 0, 0, 0);
        } else if (task.domain === 'life' && scheduledTime.getHours() < 17) {
            // 生活任务安排在下午或晚上
            scheduledTime.setHours(17, 0, 0, 0);
        }
        
        await updateTaskTimeWithDate(taskId, scheduledTime);
        showToast('已自动安排时间', 'success');
        
    } catch (error) {
        console.error('自动安排失败:', error);
        showToast('自动安排失败', 'error');
    }
}

// 显示时间选择器（保留但简化，不再使用）
function showTimeSelector(taskId, element) {
    // 如果已经有打开的选择器，先关闭
    const existingSelector = document.querySelector('.time-picker-popup');
    if (existingSelector) {
        existingSelector.remove();
    }
    
    // 创建时间选择器弹窗
    const popup = document.createElement('div');
    popup.className = 'time-picker-popup';
    
    // 获取当前时间
    const now = new Date();
    const currentHour = now.getHours();
    
    popup.innerHTML = `
        <div class="time-picker-content">
            <div class="time-picker-header">选择计划时间</div>
            
            <div class="quick-time-buttons">
                <div class="quick-time-section">
                    <div class="section-title">快速选择</div>
                    <button onclick="setQuickTime('${taskId}', 'now')">现在</button>
                    <button onclick="setQuickTime('${taskId}', '30min')">30分钟后</button>
                    <button onclick="setQuickTime('${taskId}', '1hour')">1小时后</button>
                    <button onclick="setQuickTime('${taskId}', '2hour')">2小时后</button>
                </div>
                
                <div class="quick-time-section">
                    <div class="section-title">上午</div>
                    <button onclick="setSpecificTime('${taskId}', 9, 0)">9:00</button>
                    <button onclick="setSpecificTime('${taskId}', 9, 30)">9:30</button>
                    <button onclick="setSpecificTime('${taskId}', 10, 0)">10:00</button>
                    <button onclick="setSpecificTime('${taskId}', 10, 30)">10:30</button>
                    <button onclick="setSpecificTime('${taskId}', 11, 0)">11:00</button>
                    <button onclick="setSpecificTime('${taskId}', 11, 30)">11:30</button>
                </div>
                
                <div class="quick-time-section">
                    <div class="section-title">下午</div>
                    <button onclick="setSpecificTime('${taskId}', 14, 0)">14:00</button>
                    <button onclick="setSpecificTime('${taskId}', 14, 30)">14:30</button>
                    <button onclick="setSpecificTime('${taskId}', 15, 0)">15:00</button>
                    <button onclick="setSpecificTime('${taskId}', 15, 30)">15:30</button>
                    <button onclick="setSpecificTime('${taskId}', 16, 0)">16:00</button>
                    <button onclick="setSpecificTime('${taskId}', 16, 30)">16:30</button>
                </div>
                
                <div class="quick-time-section">
                    <div class="section-title">晚上</div>
                    <button onclick="setSpecificTime('${taskId}', 19, 0)">19:00</button>
                    <button onclick="setSpecificTime('${taskId}', 19, 30)">19:30</button>
                    <button onclick="setSpecificTime('${taskId}', 20, 0)">20:00</button>
                    <button onclick="setSpecificTime('${taskId}', 20, 30)">20:30</button>
                    <button onclick="setSpecificTime('${taskId}', 21, 0)">21:00</button>
                    <button onclick="setSpecificTime('${taskId}', 21, 30)">21:30</button>
                </div>
            </div>
            
            <div class="custom-time-input">
                <label>自定义时间：</label>
                <input type="time" id="customTimeInput" value="${currentHour.toString().padStart(2, '0')}:00">
                <button onclick="setCustomTime('${taskId}')">确定</button>
            </div>
            
            <div class="time-picker-actions">
                <button onclick="clearTaskTime('${taskId}')" class="btn-clear">清除时间</button>
                <button onclick="closeTimeSelector()" class="btn-close">关闭</button>
            </div>
        </div>
    `;
    
    // 定位弹窗
    const rect = element.getBoundingClientRect();
    popup.style.position = 'fixed';
    popup.style.top = (rect.bottom + 5) + 'px';
    popup.style.left = rect.left + 'px';
    
    document.body.appendChild(popup);
    
    // 点击外部关闭
    setTimeout(() => {
        document.addEventListener('click', function closeOnClickOutside(e) {
            if (!popup.contains(e.target) && e.target !== element) {
                popup.remove();
                document.removeEventListener('click', closeOnClickOutside);
            }
        });
    }, 100);
}

// 设置快速时间
function setQuickTime(taskId, type) {
    const now = new Date();
    
    switch(type) {
        case 'now':
            break;
        case '30min':
            now.setMinutes(now.getMinutes() + 30);
            break;
        case '1hour':
            now.setHours(now.getHours() + 1);
            now.setMinutes(0);
            break;
        case '2hour':
            now.setHours(now.getHours() + 2);
            now.setMinutes(0);
            break;
    }
    
    updateTaskTimeWithDate(taskId, now);
    closeTimeSelector();
}

// 设置特定时间
function setSpecificTime(taskId, hour, minute) {
    const date = new Date();
    date.setHours(hour, minute, 0, 0);
    
    // 调试日志
    console.log('设置时间:', date.toLocaleString('zh-CN'));
    
    updateTaskTimeWithDate(taskId, date);
    closeTimeSelector();
}

// 设置自定义时间
function setCustomTime(taskId) {
    const input = document.getElementById('customTimeInput');
    if (input && input.value) {
        const [hours, minutes] = input.value.split(':');
        const date = new Date();
        date.setHours(parseInt(hours), parseInt(minutes), 0, 0);
        
        updateTaskTimeWithDate(taskId, date);
        closeTimeSelector();
    }
}

// 清除任务时间
async function clearTaskTime(taskId) {
    try {
        const response = await fetch(`${API_BASE}/tasks/${taskId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                scheduled_start: null
            })
        });
        
        if (response.ok) {
            showToast('计划时间已清除', 'success');
            await loadTasks();
            closeTimeSelector();
        }
    } catch (error) {
        console.error('清除任务时间失败:', error);
        showToast('操作失败', 'error');
    }
}

// 关闭时间选择器
function closeTimeSelector() {
    const selector = document.querySelector('.time-picker-popup');
    if (selector) {
        selector.remove();
    }
}

// 使用Date对象更新任务时间（保留用于兼容性）
async function updateTaskTimeWithDate(taskId, date) {
    // 转换为时间字符串并调用新函数
    const hour = date.getHours();
    const minute = date.getMinutes();
    const timeStr = minute === 0 ? hour.toString() : 
                    hour.toString() + minute.toString().padStart(2, '0');
    await updateTaskTime(taskId, timeStr);
}


// 更新任务状态
async function toggleTaskStatus(taskId, isCompleted) {
    try {
        const response = await fetch(`${API_BASE}/tasks/${taskId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                status: isCompleted ? 'completed' : 'pending'
            })
        });
        
        if (response.ok) {
            showToast(isCompleted ? '任务已完成' : '任务已恢复', 'success');
            await loadTasks();
            await updateDashboard();
        } else {
            showToast('更新失败', 'error');
            await loadTasks();
        }
    } catch (error) {
        console.error('更新任务状态失败:', error);
        showToast('更新失败', 'error');
        await loadTasks();
    }
}

// 修改任务域
async function changeTaskDomain(taskId, newDomain) {
    try {
        const response = await fetch(`${API_BASE}/tasks/${taskId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                domain: newDomain
            })
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            showToast(`任务已移动到 ${newDomain} 域`, 'success');
            await loadTasks();
            await updateDashboard();
        } else {
            showToast(data.detail || '修改失败', 'error');
            // 恢复原值
            await loadTasks();
        }
    } catch (error) {
        console.error('修改任务域失败:', error);
        showToast('修改任务域失败', 'error');
        await loadTasks();
    }
}

// 键盘快捷键
document.addEventListener('keydown', (e) => {
    // Cmd/Ctrl + Enter 快速添加任务
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        const textarea = document.getElementById('aiTaskInput');
        if (document.activeElement === textarea) {
            aiProcessTasks();
        }
    }
    
    // Cmd/Ctrl + O 优化日程
    if ((e.metaKey || e.ctrlKey) && e.key === 'o') {
        e.preventDefault();
        optimizeSchedule();
    }
    
    // Cmd/Ctrl + A 全选任务
    if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        const textarea = document.getElementById('aiTaskInput');
        if (document.activeElement !== textarea) {
            e.preventDefault();
            allSelected = false; // 重置状态以确保切换
            toggleSelectAll();
        }
    }
    
    // Delete 键删除选中任务
    if (e.key === 'Delete' && selectedTasks.size > 0) {
        deleteSelectedTasks();
    }
    
    // Cmd/Ctrl + L AI 学习
    if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
        e.preventDefault();
        updateOntology();
    }
});

// 页面加载完成后初始化
// 拖放功能
let draggedTaskId = null;

function initDragAndDrop() {
    const dropZones = document.querySelectorAll('.task-drop-zone');
    
    dropZones.forEach(zone => {
        zone.addEventListener('dragover', handleDragOver);
        zone.addEventListener('drop', handleDrop);
        zone.addEventListener('dragleave', handleDragLeave);
    });
}

function handleDragStart(event, taskId) {
    draggedTaskId = taskId;
    event.dataTransfer.effectAllowed = 'move';
    event.target.classList.add('dragging');
}

function handleDragEnd(event) {
    event.target.classList.remove('dragging');
}

function handleDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    event.currentTarget.classList.add('drag-over');
}

function handleDragLeave(event) {
    event.currentTarget.classList.remove('drag-over');
}

async function handleDrop(event) {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-over');
    
    const newStatus = event.currentTarget.dataset.status;
    
    if (draggedTaskId && newStatus) {
        try {
            // 获取任务信息
            const tasksResponse = await fetch(`${API_BASE}/tasks`);
            const tasksData = await tasksResponse.json();
            const task = tasksData.tasks.find(t => t.id === draggedTaskId);
            
            let updateData = { status: newStatus };
            
            // 如果从任务池拖到待完成（今日任务），自动安排时间
            if (task && task.status === 'pool' && newStatus === 'pending') {
                const scheduledTime = await autoScheduleTaskTime(task);
                if (scheduledTime) {
                    updateData.scheduled_start = scheduledTime.toISOString();
                    updateData.scheduled_end = new Date(scheduledTime.getTime() + (task.estimated_minutes || 30) * 60000).toISOString();
                }
            }
            
            const response = await fetch(`${API_BASE}/tasks/${draggedTaskId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(updateData)
            });
            
            if (response.ok) {
                showToast(`任务已移至${getStatusName(newStatus)}`, 'success');
                await loadTasks();
                await updateDashboard();
            } else {
                showToast('移动失败', 'error');
            }
        } catch (error) {
            console.error('移动任务失败:', error);
            showToast('操作失败', 'error');
        }
    }
    
    draggedTaskId = null;
}

function getStatusName(status) {
    const names = {
        'pending': '待完成',
        'waiting': '等待中',
        'pool': '任务池',
        'completed': '已完成'
    };
    return names[status] || status;
}

// 主题切换功能
function changeTheme(themeName) {
    const themeLink = document.getElementById('theme-stylesheet');
    // 修复路径问题
    const basePath = window.location.pathname.includes('.html') ? '.' : '/static';
    themeLink.href = `${basePath}/theme-${themeName}.css`;
    
    // 保存到 localStorage
    localStorage.setItem('selectedTheme', themeName);
    
    showToast(`已切换到 ${getThemeName(themeName)} 主题`, 'success');
}

function getThemeName(theme) {
    const names = {
        'default': '默认 macOS',
        'modernist': '极简主义',
        'dark': '深色模式'
    };
    return names[theme] || theme;
}

// 页面加载时恢复主题设置
function loadSavedTheme() {
    const savedTheme = localStorage.getItem('selectedTheme') || 'default';
    // 如果保存的是modernist，切换为default
    const validTheme = savedTheme === 'modernist' ? 'default' : savedTheme;
    
    const themeLink = document.getElementById('theme-stylesheet');
    const basePath = window.location.pathname.includes('.html') ? '.' : '/static';
    themeLink.href = `${basePath}/theme-${validTheme}.css`;
    
    const themeSelect = document.getElementById('theme-select');
    if (themeSelect) {
        themeSelect.value = validTheme;
    }
    
    // 更新localStorage
    if (savedTheme === 'modernist') {
        localStorage.setItem('selectedTheme', 'default');
    }
}

// 快捷键管理器
class ShortcutManager {
    constructor() {
        this.shortcuts = new Map();
        this.setupShortcuts();
    }
    
    setupShortcuts() {
        // 定义快捷键
        this.register('n', () => {
            document.getElementById('quickTaskInput')?.focus();
        }, '新建任务 (N)');
        
        this.register('/', () => {
            document.getElementById('quickTaskInput')?.focus();
        }, '快速添加 (/)');
        
        this.register('Enter', (e) => {
            if (e.ctrlKey || e.metaKey) {
                if (document.getElementById('quickTaskInput') === document.activeElement) {
                    e.preventDefault();
                    addQuickTask();
                } else if (document.getElementById('aiTaskInput') === document.activeElement) {
                    e.preventDefault();
                    aiProcessTasks();
                }
            }
        }, '快速提交 (Ctrl+Enter)');
        
        this.register('d', (e) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                deleteSelectedTasks();
            }
        }, '删除选中 (Ctrl+D)');
        
        this.register('a', (e) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                toggleSelectAll();
            }
        }, '全选 (Ctrl+A)');
        
        this.register(' ', (e) => {
            // 空格键 - 暂停/继续第一个进行中的任务
            if (document.activeElement.tagName !== 'INPUT' && 
                document.activeElement.tagName !== 'TEXTAREA' &&
                document.activeElement.tagName !== 'SELECT') {
                e.preventDefault();
                this.toggleFirstActiveTask();
            }
        }, '暂停/继续任务 (空格)');
        
        // 数字键 1-4 切换域视图
        ['1', '2', '3', '4'].forEach((num, index) => {
            const domains = ['academic', 'income', 'growth', 'life'];
            const names = ['学术', '收入', '成长', '生活'];
            this.register(num, () => {
                this.scrollToDomain(domains[index]);
            }, `查看${names[index]}域 (${num})`);
        });
        
        this.register('t', () => {
            this.cycleTheme();
        }, '切换主题 (T)');
        
        this.register('o', (e) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                optimizeSchedule();
            }
        }, '优化日程 (Ctrl+O)');
        
        this.register('Escape', () => {
            // 关闭所有弹窗或取消当前操作
            const helpModal = document.querySelector('[data-help-modal]');
            if (helpModal) {
                helpModal.remove();
            }
            clearInput?.();
        }, '取消操作 (ESC)');
        
        this.register('?', (e) => {
            if (e.shiftKey) {
                e.preventDefault();
                this.showHelp();
            }
        }, '显示帮助 (Shift+?)');
    }
    
    register(key, handler, description) {
        this.shortcuts.set(key, { handler, description });
    }
    
    handleKeydown(event) {
        const shortcut = this.shortcuts.get(event.key);
        if (shortcut) {
            shortcut.handler(event);
        }
    }
    
    toggleFirstActiveTask() {
        // 找到第一个计时器按钮
        const timerButton = document.querySelector('.btn-timer');
        if (timerButton) {
            timerButton.click();
            showToast('⚡ 快捷键操作：切换任务状态', 'info');
        } else {
            showToast('ℹ️ 没有找到可操作的任务', 'info');
        }
    }
    
    scrollToDomain(domain) {
        const domainCard = document.querySelector(`.domain-card.${domain}`);
        if (domainCard) {
            domainCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // 高亮动画
            domainCard.style.transition = 'all 0.3s ease';
            domainCard.style.transform = 'scale(1.05)';
            domainCard.style.boxShadow = '0 8px 32px rgba(66, 133, 244, 0.3)';
            setTimeout(() => {
                domainCard.style.transform = '';
                domainCard.style.boxShadow = '';
            }, 1000);
            
            const names = {academic: '学术', income: '收入', growth: '成长', life: '生活'};
            showToast(`📍 切换到${names[domain]}域`, 'info');
        }
    }
    
    cycleTheme() {
        const themeSelect = document.getElementById('theme-select');
        const themes = ['default', 'dark'];
        const themeNames = ['默认 macOS', '深色模式'];
        const currentIndex = themes.indexOf(themeSelect.value);
        const nextIndex = (currentIndex + 1) % themes.length;
        changeTheme(themes[nextIndex]);
        themeSelect.value = themes[nextIndex];
        showToast(`🎨 主题: ${themeNames[nextIndex]}`, 'info');
    }
    
    showHelp() {
        // 删除已存在的帮助弹窗
        const existingModal = document.querySelector('[data-help-modal]');
        if (existingModal) {
            existingModal.remove();
            return;
        }
        
        const shortcuts = Array.from(this.shortcuts.entries())
            .filter(([key, {description}]) => description) // 只显示有描述的
            .map(([key, {description}]) => {
                let displayKey = key;
                if (key === ' ') displayKey = 'Space';
                if (key === 'Escape') displayKey = 'ESC';
                return `<div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee;">
                    <span style="font-weight: 500; color: #333;">${displayKey}</span>
                    <span style="color: #666;">${description}</span>
                </div>`;
            });
        
        // 创建帮助弹窗
        const helpModal = document.createElement('div');
        helpModal.setAttribute('data-help-modal', 'true');
        helpModal.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            padding: 30px;
            border-radius: 12px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            z-index: 10000;
            max-width: 600px;
            max-height: 80vh;
            overflow-y: auto;
            border: 1px solid #ddd;
        `;
        
        helpModal.innerHTML = `
            <div style="display: flex; align-items: center; margin-bottom: 25px;">
                <h2 style="margin: 0; color: #333; font-size: 24px;">⌨️ 快捷键帮助</h2>
                <button onclick="this.parentElement.parentElement.remove()" 
                        style="margin-left: auto; padding: 8px 12px; 
                               background: #f5f5f5; color: #666; 
                               border: none; border-radius: 6px; 
                               cursor: pointer; font-size: 14px;">✕</button>
            </div>
            <div style="font-family: 'SF Mono', Monaco, monospace; line-height: 1.6; font-size: 14px;">
                ${shortcuts.join('')}
            </div>
            <div style="margin-top: 20px; text-align: center; color: #888; font-size: 12px;">
                按 ESC 或点击外部区域关闭
            </div>
        `;
        
        document.body.appendChild(helpModal);
        
        // 点击外部关闭
        setTimeout(() => {
            const closeOnClickOutside = (e) => {
                if (!helpModal.contains(e.target)) {
                    helpModal.remove();
                    document.removeEventListener('click', closeOnClickOutside);
                }
            };
            document.addEventListener('click', closeOnClickOutside);
        }, 100);
    }
}

// 初始化快捷键管理器
let shortcutManager;

document.addEventListener('DOMContentLoaded', () => {
    loadSavedTheme();
    
    // 初始化快捷键管理器
    shortcutManager = new ShortcutManager();
    document.addEventListener('keydown', (e) => shortcutManager.handleKeydown(e));
    
    // 加载暂停的计时器
    loadPausedTimersFromLocalStorage();
    
    loadTasks();
    updateDashboard();
    
    // 请求通知权限
    checkNotificationPermission();
    
    // 每分钟更新一次仪表板和提醒
    setInterval(() => {
        updateDashboard();
        setupTaskReminders(); // 定期检查新的提醒
    }, 60000);
    
    // 输入框支持 Cmd+Enter 提交（保持原有功能）
    document.getElementById('aiTaskInput').addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            aiProcessTasks();
        }
    });
    
    // 快速任务输入框也支持 Enter 提交
    document.getElementById('quickTaskInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addQuickTask();
        }
    });
    
    // 显示快捷键提示
    setTimeout(() => {
        showToast('💡 按 Shift+? 查看快捷键帮助', 'info');
    }, 3000);
});