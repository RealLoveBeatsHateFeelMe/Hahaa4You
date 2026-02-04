/**
 * Hahha4You - 渲染进程脚本
 * 处理所有UI交互逻辑
 */

const { ipcRenderer } = require('electron');
const remote = require('@electron/remote');
const path = require('path');
const fs = require('fs');

// ============ 数据存储 ============
let jokes = [];          // 笑话数组
let images = [];         // 图片数组
let currentJokeIndex = -1;  // 当前笑话索引

// ============ 资源路径 ============
const assetsPath = path.join(__dirname, '..', 'assets');
const jokesPath = path.join(assetsPath, 'jokes.json');
const imagesPath = path.join(assetsPath, 'images');

/**
 * 加载笑话数据
 */
function loadJokes() {
    try {
        const data = fs.readFileSync(jokesPath, 'utf8');
        const jsonData = JSON.parse(data);
        jokes = jsonData.jokes || [];
        console.log(`已加载 ${jokes.length} 条笑话`);
    } catch (error) {
        console.error('加载笑话失败:', error);
        jokes = [];
    }
}

/**
 * 加载图片列表
 */
function loadImages() {
    try {
        if (fs.existsSync(imagesPath)) {
            const files = fs.readdirSync(imagesPath);
            images = files.filter(file => {
                const ext = path.extname(file).toLowerCase();
                return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
            });
            console.log(`已加载 ${images.length} 张图片`);
        }
    } catch (error) {
        console.error('加载图片失败:', error);
        images = [];
    }
}

/**
 * 获取随机笑话
 */
function getRandomJoke() {
    if (jokes.length === 0) {
        return '暂无笑话，请在 assets/jokes.json 中添加笑话！';
    }

    // 避免连续显示同一条笑话
    let newIndex;
    if (jokes.length === 1) {
        newIndex = 0;
    } else {
        do {
            newIndex = Math.floor(Math.random() * jokes.length);
        } while (newIndex === currentJokeIndex);
    }

    currentJokeIndex = newIndex;
    return jokes[currentJokeIndex];
}

/**
 * 获取随机图片路径
 */
function getRandomImage() {
    if (images.length === 0) {
        return null;
    }
    const randomIndex = Math.floor(Math.random() * images.length);
    return path.join(imagesPath, images[randomIndex]);
}

// ============ 小球窗口初始化 ============
function initBall() {
    const ball = document.getElementById('floating-ball');
    const ballEmoji = ball.querySelector('.ball-emoji');
    let hoverTimeout = null;
    let autoShowTimeout = null;  // 2秒自动显示笑话框的计时器
    let isDragging = false;
    let dragStartX, dragStartY;

    // 鼠标进入小球 - 显示完整 + 显示预览
    ball.addEventListener('mouseenter', () => {
        ipcRenderer.send('ball-mouse-enter');
        hoverTimeout = setTimeout(() => {
            ipcRenderer.send('show-preview');
        }, 200);

        // 2秒后自动显示笑话框
        autoShowTimeout = setTimeout(() => {
            ipcRenderer.send('hide-preview');  // 隐藏预览
            ipcRenderer.send('show-joke');     // 显示笑话框
        }, 2000);
    });

    // 鼠标离开小球 - 半隐藏 + 隐藏预览
    ball.addEventListener('mouseleave', () => {
        if (hoverTimeout) {
            clearTimeout(hoverTimeout);
            hoverTimeout = null;
        }
        if (autoShowTimeout) {
            clearTimeout(autoShowTimeout);
            autoShowTimeout = null;
        }
        ipcRenderer.send('hide-preview');
        if (!isDragging) {
            ipcRenderer.send('ball-mouse-leave');
        }
    });

    // 拖动开始
    ball.addEventListener('mousedown', (e) => {
        if (e.button === 0) {
            isDragging = true;
            dragStartX = e.screenX;
            dragStartY = e.screenY;
        }
    });

    // 拖动中
    document.addEventListener('mousemove', (e) => {
        if (isDragging) {
            const deltaX = e.screenX - dragStartX;
            const deltaY = e.screenY - dragStartY;

            const currentWindow = remote.getCurrentWindow();
            const bounds = currentWindow.getBounds();
            currentWindow.setPosition(bounds.x + deltaX, bounds.y + deltaY);

            dragStartX = e.screenX;
            dragStartY = e.screenY;

            // 通知主进程更新笑话窗口位置
            ipcRenderer.send('ball-dragging');
        }
    });

    // 拖动结束
    document.addEventListener('mouseup', (e) => {
        if (isDragging) {
            isDragging = false;
            // 通知主进程吸附到边缘
            const currentWindow = remote.getCurrentWindow();
            const bounds = currentWindow.getBounds();
            ipcRenderer.send('ball-drag-end', { x: bounds.x, y: bounds.y });
        }
    });

    // ============ 点击计数系统（支持单击/三击） ============
    let clickCount = 0;
    let clickTimer = null;
    const CLICK_INTERVAL = 350;  // 点击间隔判定（毫秒）

    // 点击小球（通过emoji） - 处理单击/三击
    ballEmoji.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();

        if (isDragging) return;

        // 通知主进程重置空闲计时器
        ipcRenderer.send('user-activity');

        clickCount++;

        // 清除之前的计时器
        if (clickTimer) {
            clearTimeout(clickTimer);
            clickTimer = null;
        }

        // 三击立即触发终极毁灭（不用等）
        if (clickCount >= 3) {
            clickCount = 0;
            // 清除自动显示笑话的计时器
            if (autoShowTimeout) {
                clearTimeout(autoShowTimeout);
                autoShowTimeout = null;
            }
            ipcRenderer.send('ultimate-destroy');
            return;
        }

        // 延迟判断是单击还是双击
        clickTimer = setTimeout(() => {
            if (clickCount === 1) {
                // 单击显示笑话窗口
                ipcRenderer.send('show-joke');
            } else if (clickCount === 2) {
                // 双击触发散弹枪效果
                ipcRenderer.send('shotgun-fire');
            }
            clickCount = 0;
        }, CLICK_INTERVAL);
    });

    // 超速弹簧炮效果 - 蓄力缩小
    let chargeShakeInterval = null;
    ipcRenderer.on('ball-charge', (event, isCharging) => {
        if (isCharging) {
            // 极度压缩 + 蓄力抖动
            ball.style.transition = 'transform 0.15s cubic-bezier(0.4, 0, 0.2, 1)';
            ball.style.transform = 'scale(0.25)';
            ball.style.boxShadow = '0 0 60px #ff0, 0 0 100px #f80';
            // 蓄力抖动
            let shakeCount = 0;
            chargeShakeInterval = setInterval(() => {
                shakeCount++;
                const intensity = Math.min(shakeCount * 0.5, 8);
                const offsetX = (Math.random() - 0.5) * intensity;
                const offsetY = (Math.random() - 0.5) * intensity;
                ball.style.transform = `scale(0.25) translate(${offsetX}px, ${offsetY}px)`;
            }, 20);
        } else {
            // 停止抖动
            if (chargeShakeInterval) {
                clearInterval(chargeShakeInterval);
                chargeShakeInterval = null;
            }
            // 爆发放大！
            ball.style.transition = 'transform 0.08s cubic-bezier(0, 0.9, 0.3, 1.5)';
            ball.style.transform = 'scale(1.8)';
            ball.style.boxShadow = '0 0 80px #fff, 0 0 120px #ff0';
            setTimeout(() => {
                ball.style.transition = 'transform 0.15s ease-out, box-shadow 0.3s';
                ball.style.transform = '';
                ball.style.boxShadow = '';
            }, 80);
        }
    });

    // 超速弹簧炮效果 - 碰撞挤压变形
    ipcRenderer.on('ball-squash', (event, direction) => {
        if (direction === 'horizontal') {
            ball.style.transition = 'transform 0.06s ease-out';
            ball.style.transform = 'scaleX(0.6) scaleY(1.4)';
        } else {
            ball.style.transition = 'transform 0.06s ease-out';
            ball.style.transform = 'scaleX(1.4) scaleY(0.6)';
        }
        setTimeout(() => {
            ball.style.transform = '';
            ball.style.transition = '';
        }, 60);
    });
}

// ============ 笑话窗口初始化 ============
function initJokeWindow() {
    // 加载笑话数据
    loadJokes();

    const jokeText = document.getElementById('joke-text');
    const nextBtn = document.getElementById('next-btn');
    const closeBtn = document.getElementById('close-btn');

    // 显示第一条笑话
    jokeText.textContent = getRandomJoke();

    // 下一个按钮点击事件
    nextBtn.addEventListener('click', () => {
        // 请求主进程执行围绕小球旋转的动画
        ipcRenderer.send('spin-around-ball');

        // 动画完成后切换笑话内容（800ms后，匹配新动画时长）
        setTimeout(() => {
            jokeText.textContent = getRandomJoke();
        }, 800);
    });

    // 关闭按钮点击事件
    closeBtn.addEventListener('click', () => {
        ipcRenderer.send('close-joke');
    });

    // 添加文本淡入淡出过渡效果
    jokeText.style.transition = 'opacity 0.2s ease';
}

// ============ 预览窗口初始化 ============
function initPreviewWindow() {
    // 加载图片列表
    loadImages();

    const previewImage = document.getElementById('preview-image');
    const placeholder = document.getElementById('preview-placeholder');

    // 尝试显示随机图片
    const imagePath = getRandomImage();

    if (imagePath) {
        previewImage.src = imagePath;
        previewImage.classList.remove('hidden');
        placeholder.classList.add('hidden');

        // 图片加载失败时显示占位符
        previewImage.onerror = () => {
            previewImage.classList.add('hidden');
            placeholder.classList.remove('hidden');
        };
    } else {
        previewImage.classList.add('hidden');
        placeholder.classList.remove('hidden');
    }
}

// 导出函数供HTML调用
if (typeof window !== 'undefined') {
    window.initBall = initBall;
    window.initJokeWindow = initJokeWindow;
    window.initPreviewWindow = initPreviewWindow;
}
