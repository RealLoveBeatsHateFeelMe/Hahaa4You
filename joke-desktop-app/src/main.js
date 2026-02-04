/**
 * Hahha4You - Electron Main Process
 * 管理所有窗口：悬浮小球、预览窗口、笑话窗口
 */

const { app, BrowserWindow, ipcMain, screen, globalShortcut } = require('electron');
const path = require('path');
const remoteMain = require('@electron/remote/main');

// 初始化 remote
remoteMain.initialize();

// 窗口引用
let ballWindow = null;
let previewWindow = null;
let jokeWindow = null;
let overlayWindow = null;  // 特效叠加层窗口

// 窗口配置常量
const BALL_SIZE = 60;
const PREVIEW_WIDTH = 300;
const PREVIEW_HEIGHT = 200;
const JOKE_WIDTH = 400;
const JOKE_HEIGHT = 300;

// 小球位置状态：'right', 'left', 'top', 'bottom'
let ballEdge = 'right';
let isHalfHidden = true;
let isBouncing = false;  // 防止连续触发弹跳动画

// 5分钟空闲自动弹跳计时器
let idleTimer = null;
const IDLE_TIMEOUT = 5 * 60 * 1000;  // 5分钟 = 300000毫秒

function resetIdleTimer() {
    if (idleTimer) {
        clearTimeout(idleTimer);
    }
    idleTimer = setTimeout(() => {
        // 5分钟无操作，自动触发疯狂乱弹
        if (!isBouncing && ballWindow && !ballWindow.isDestroyed()) {
            triggerCrazyBounce();
        }
    }, IDLE_TIMEOUT);
}

// 声明 triggerCrazyBounce 函数（在后面定义）
let triggerCrazyBounce = null;

/**
 * 创建悬浮小球窗口
 */
function createBallWindow() {
    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

    // 初始位置：右边缘，半隐藏
    const initialX = screenWidth - BALL_SIZE / 2;
    const initialY = screenHeight - BALL_SIZE - 100;

    ballWindow = new BrowserWindow({
        width: BALL_SIZE,
        height: BALL_SIZE,
        x: initialX,
        y: initialY,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
        skipTaskbar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    ballWindow.loadFile(path.join(__dirname, 'index.html'));
    ballWindow.setIgnoreMouseEvents(false);

    // 启用 remote
    remoteMain.enable(ballWindow.webContents);

    ballWindow.on('closed', () => {
        ballWindow = null;
        if (previewWindow) previewWindow.close();
        if (jokeWindow) jokeWindow.close();
        if (idleTimer) clearTimeout(idleTimer);
        app.quit();
    });

    // 启动5分钟空闲计时器
    resetIdleTimer();
}

/**
 * 将小球吸附到最近的边缘
 */
function snapToEdge(x, y) {
    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

    // 计算到各边缘的距离
    const distToLeft = x;
    const distToRight = screenWidth - x - BALL_SIZE;
    const distToTop = y;
    const distToBottom = screenHeight - y - BALL_SIZE;

    const minDist = Math.min(distToLeft, distToRight, distToTop, distToBottom);

    let newX = x, newY = y;

    if (minDist === distToLeft) {
        ballEdge = 'left';
        newX = isHalfHidden ? -BALL_SIZE / 2 : 0;
    } else if (minDist === distToRight) {
        ballEdge = 'right';
        newX = isHalfHidden ? screenWidth - BALL_SIZE / 2 : screenWidth - BALL_SIZE;
    } else if (minDist === distToTop) {
        ballEdge = 'top';
        newY = isHalfHidden ? -BALL_SIZE / 2 : 0;
    } else {
        ballEdge = 'bottom';
        newY = isHalfHidden ? screenHeight - BALL_SIZE / 2 : screenHeight - BALL_SIZE;
    }

    // 限制在边缘范围内
    if (ballEdge === 'left' || ballEdge === 'right') {
        newY = Math.max(0, Math.min(y, screenHeight - BALL_SIZE));
    } else {
        newX = Math.max(0, Math.min(x, screenWidth - BALL_SIZE));
    }

    return { x: newX, y: newY };
}

/**
 * 显示完整小球（鼠标悬浮时）
 */
function showFullBall() {
    if (!ballWindow || !isHalfHidden) return;
    isHalfHidden = false;

    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
    const bounds = ballWindow.getBounds();

    let newX = bounds.x, newY = bounds.y;

    if (ballEdge === 'left') {
        newX = 0;
    } else if (ballEdge === 'right') {
        newX = screenWidth - BALL_SIZE;
    } else if (ballEdge === 'top') {
        newY = 0;
    } else if (ballEdge === 'bottom') {
        newY = screenHeight - BALL_SIZE;
    }

    ballWindow.setPosition(Math.round(newX), Math.round(newY));
}

/**
 * 半隐藏小球（鼠标离开时）
 */
function hideHalfBall() {
    if (!ballWindow || isHalfHidden) return;
    isHalfHidden = true;

    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
    const bounds = ballWindow.getBounds();

    let newX = bounds.x, newY = bounds.y;

    if (ballEdge === 'left') {
        newX = -BALL_SIZE / 2;
    } else if (ballEdge === 'right') {
        newX = screenWidth - BALL_SIZE / 2;
    } else if (ballEdge === 'top') {
        newY = -BALL_SIZE / 2;
    } else if (ballEdge === 'bottom') {
        newY = screenHeight - BALL_SIZE / 2;
    }

    ballWindow.setPosition(Math.round(newX), Math.round(newY));
}

/**
 * 更新笑话窗口位置（跟随小球）
 */
function updateJokeWindowPosition() {
    if (!jokeWindow || !ballWindow) return;

    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
    const ballBounds = ballWindow.getBounds();

    let x, y;

    // 根据小球位置决定笑话窗口位置
    if (ballEdge === 'left') {
        x = ballBounds.x + BALL_SIZE + 10;
        y = ballBounds.y - JOKE_HEIGHT / 2 + BALL_SIZE / 2;
    } else if (ballEdge === 'right') {
        x = ballBounds.x - JOKE_WIDTH - 10;
        y = ballBounds.y - JOKE_HEIGHT / 2 + BALL_SIZE / 2;
    } else if (ballEdge === 'top') {
        x = ballBounds.x - JOKE_WIDTH / 2 + BALL_SIZE / 2;
        y = ballBounds.y + BALL_SIZE + 10;
    } else {
        x = ballBounds.x - JOKE_WIDTH / 2 + BALL_SIZE / 2;
        y = ballBounds.y - JOKE_HEIGHT - 10;
    }

    // 确保在屏幕内
    x = Math.max(0, Math.min(x, screenWidth - JOKE_WIDTH));
    y = Math.max(0, Math.min(y, screenHeight - JOKE_HEIGHT));

    jokeWindow.setPosition(Math.round(x), Math.round(y));
}

/**
 * 创建图片预览窗口
 */
function createPreviewWindow(x, y) {
    // 确保坐标是有效数字
    x = Math.round(x) || 0;
    y = Math.round(y) || 0;

    if (previewWindow && !previewWindow.isDestroyed()) {
        try {
            previewWindow.setPosition(x, y);
            previewWindow.showInactive();  // 使用 showInactive 避免抢焦点
        } catch (e) {
            console.error('Preview window error:', e);
            previewWindow = null;
        }
        return;
    }

    // 如果窗口已被销毁，清空引用
    if (previewWindow) {
        previewWindow = null;
    }

    previewWindow = new BrowserWindow({
        width: PREVIEW_WIDTH,
        height: PREVIEW_HEIGHT,
        x: x,
        y: y,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
        skipTaskbar: true,
        show: false,
        focusable: false,  // 不可聚焦，避免抢走小球的焦点
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    previewWindow.loadFile(path.join(__dirname, 'preview.html'));

    previewWindow.once('ready-to-show', () => {
        if (previewWindow && !previewWindow.isDestroyed()) {
            previewWindow.showInactive();
        }
    });

    previewWindow.on('closed', () => {
        previewWindow = null;
    });
}

/**
 * 创建笑话显示窗口
 */
function createJokeWindow() {
    if (jokeWindow) {
        jokeWindow.show();
        jokeWindow.focus();
        return;
    }

    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
    const ballBounds = ballWindow.getBounds();

    // 根据小球位置决定笑话窗口位置
    let x, y;
    if (ballEdge === 'left') {
        x = ballBounds.x + BALL_SIZE + 10;
        y = ballBounds.y - JOKE_HEIGHT / 2 + BALL_SIZE / 2;
    } else if (ballEdge === 'right') {
        x = ballBounds.x - JOKE_WIDTH - 10;
        y = ballBounds.y - JOKE_HEIGHT / 2 + BALL_SIZE / 2;
    } else if (ballEdge === 'top') {
        x = ballBounds.x - JOKE_WIDTH / 2 + BALL_SIZE / 2;
        y = ballBounds.y + BALL_SIZE + 10;
    } else {
        x = ballBounds.x - JOKE_WIDTH / 2 + BALL_SIZE / 2;
        y = ballBounds.y - JOKE_HEIGHT - 10;
    }

    // 确保在屏幕内
    x = Math.max(0, Math.min(x, screenWidth - JOKE_WIDTH));
    y = Math.max(0, Math.min(y, screenHeight - JOKE_HEIGHT));

    jokeWindow = new BrowserWindow({
        width: JOKE_WIDTH,
        height: JOKE_HEIGHT,
        x: x,
        y: y,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
        skipTaskbar: true,
        show: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    jokeWindow.loadFile(path.join(__dirname, 'joke.html'));

    jokeWindow.once('ready-to-show', () => {
        jokeWindow.show();
    });

    jokeWindow.on('closed', () => {
        jokeWindow = null;
    });
}

// 应用启动
app.whenReady().then(() => {
    createBallWindow();

    // 注册全局快捷键 Ctrl+Alt+1 触发散弹枪（在shotgun-fire handler之后定义triggerShotgunFire）
    // 注意：快捷键注册会在所有IPC handler设置完成后生效

    // IPC 事件处理
    ipcMain.on('show-preview', (event, position) => {
        if (!ballWindow) return;
        const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
        const ballBounds = ballWindow.getBounds();

        // 根据小球边缘位置决定预览窗口位置
        let x, y;
        if (ballEdge === 'left') {
            x = ballBounds.x + BALL_SIZE + 10;
            y = ballBounds.y - PREVIEW_HEIGHT / 2 + BALL_SIZE / 2;
        } else if (ballEdge === 'right') {
            x = ballBounds.x - PREVIEW_WIDTH - 10;
            y = ballBounds.y - PREVIEW_HEIGHT / 2 + BALL_SIZE / 2;
        } else if (ballEdge === 'top') {
            x = ballBounds.x - PREVIEW_WIDTH / 2 + BALL_SIZE / 2;
            y = ballBounds.y + BALL_SIZE + 10;
        } else {
            x = ballBounds.x - PREVIEW_WIDTH / 2 + BALL_SIZE / 2;
            y = ballBounds.y - PREVIEW_HEIGHT - 10;
        }

        // 确保在屏幕内
        x = Math.max(0, Math.min(x, screenWidth - PREVIEW_WIDTH));
        y = Math.max(0, Math.min(y, screenHeight - PREVIEW_HEIGHT));

        createPreviewWindow(Math.round(x), Math.round(y));
    });

    ipcMain.on('hide-preview', () => {
        if (previewWindow && !previewWindow.isDestroyed()) {
            try {
                previewWindow.hide();
            } catch (e) {
                console.error('Hide preview error:', e);
            }
        }
    });

    // 小球拖动结束，吸附到边缘
    ipcMain.on('ball-drag-end', (event, { x, y }) => {
        const snapped = snapToEdge(x, y);
        if (ballWindow) {
            ballWindow.setPosition(Math.round(snapped.x), Math.round(snapped.y));
            // 更新笑话窗口位置
            updateJokeWindowPosition();
        }
    });

    // 小球拖动中，更新笑话窗口位置
    ipcMain.on('ball-dragging', () => {
        updateJokeWindowPosition();
    });

    // 鼠标进入小球，显示完整
    ipcMain.on('ball-mouse-enter', () => {
        resetIdleTimer();  // 重置空闲计时器
        showFullBall();
    });

    // 鼠标离开小球，半隐藏
    ipcMain.on('ball-mouse-leave', () => {
        // 延迟隐藏，避免快速移动时闪烁
        setTimeout(() => {
            hideHalfBall();
        }, 300);
    });

    // 获取小球当前边缘位置
    ipcMain.handle('get-ball-edge', () => {
        return ballEdge;
    });

    ipcMain.on('show-joke', () => {
        resetIdleTimer();  // 重置空闲计时器
        createJokeWindow();
    });

    // 用户活动 - 重置空闲计时器
    ipcMain.on('user-activity', () => {
        resetIdleTimer();
    });

    ipcMain.on('close-joke', () => {
        if (jokeWindow) {
            jokeWindow.close();
        }
    });

    // 笑话窗口碰撞动画（根据小球位置改变方向）- 更丝滑版本
    ipcMain.on('spin-around-ball', () => {
        if (!jokeWindow) return;

        const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

        // 获取当前位置
        const jokeBounds = jokeWindow.getBounds();
        const startX = jokeBounds.x;
        const startY = jokeBounds.y;

        // 动画参数 - 使用更高帧率和更长时间
        const duration = 800;
        const startTime = Date.now();

        // 根据小球边缘位置决定动画方向
        const isHorizontal = (ballEdge === 'left' || ballEdge === 'right');

        // 平滑缓动函数
        const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
        const easeInCubic = t => t * t * t;
        const easeInOutCubic = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

        // 弹性缓动 - 更自然的弹跳
        const elasticBounce = (t, intensity = 0.3) => {
            return Math.sin(t * Math.PI) * intensity * (1 - t);
        };

        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);

            let jokeX = startX, jokeY = startY;

            if (isHorizontal) {
                // 水平碰撞动画 - 更丝滑
                const rightEdge = screenWidth - JOKE_WIDTH;
                const leftEdge = 0;

                if (progress < 0.3) {
                    // 滑向右边
                    const t = progress / 0.3;
                    jokeX = startX + (rightEdge - startX) * easeOutCubic(t);
                } else if (progress < 0.4) {
                    // 右边弹回
                    const t = (progress - 0.3) / 0.1;
                    const bounce = elasticBounce(t, 50);
                    jokeX = rightEdge - bounce;
                } else if (progress < 0.7) {
                    // 滑向左边
                    const t = (progress - 0.4) / 0.3;
                    jokeX = rightEdge + (leftEdge - rightEdge) * easeInOutCubic(t);
                } else if (progress < 0.8) {
                    // 左边弹回
                    const t = (progress - 0.7) / 0.1;
                    const bounce = elasticBounce(t, 50);
                    jokeX = leftEdge + bounce;
                } else {
                    // 回到原位
                    const t = (progress - 0.8) / 0.2;
                    jokeX = leftEdge + (startX - leftEdge) * easeOutCubic(t);
                }
            } else {
                // 垂直碰撞动画 - 更丝滑
                const bottomEdge = screenHeight - JOKE_HEIGHT;
                const topEdge = 0;

                if (ballEdge === 'top') {
                    // 从上往下落，再弹回
                    if (progress < 0.35) {
                        const t = progress / 0.35;
                        jokeY = startY + (bottomEdge - startY) * easeInCubic(t);
                    } else if (progress < 0.5) {
                        const t = (progress - 0.35) / 0.15;
                        const bounce = elasticBounce(t, 60);
                        jokeY = bottomEdge - bounce;
                    } else {
                        const t = (progress - 0.5) / 0.5;
                        jokeY = bottomEdge + (startY - bottomEdge) * easeOutCubic(t);
                    }
                } else {
                    // 从下往上扔，再落回
                    if (progress < 0.35) {
                        const t = progress / 0.35;
                        jokeY = startY + (topEdge - startY) * easeOutCubic(t);
                    } else if (progress < 0.5) {
                        const t = (progress - 0.35) / 0.15;
                        const bounce = elasticBounce(t, 60);
                        jokeY = topEdge + bounce;
                    } else {
                        const t = (progress - 0.5) / 0.5;
                        jokeY = topEdge + (startY - topEdge) * easeInCubic(t);
                    }
                }
            }

            if (jokeWindow) {
                jokeWindow.setPosition(Math.round(jokeX), Math.round(jokeY));
            }

            if (progress < 1) {
                // 使用 setTimeout 模拟 requestAnimationFrame，约120fps
                setTimeout(animate, 8);
            } else if (jokeWindow) {
                jokeWindow.setPosition(startX, startY);
            }
        };

        animate();
    });

    // 疯狂乱弹效果（5分钟空闲自动触发 或 手动触发）
    ipcMain.on('bounce-around', () => {
        triggerCrazyBounce();
    });

    // 疯狂乱弹核心函数 - 赋值给全局变量
    triggerCrazyBounce = function() {
        if (!ballWindow) return;

        // 防止连续触发多个动画
        if (isBouncing) return;
        isBouncing = true;

        // 重置空闲计时器
        resetIdleTimer();

        // 关闭笑话窗口
        if (jokeWindow && !jokeWindow.isDestroyed()) {
            jokeWindow.close();
            jokeWindow = null;
        }

        const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

        // 获取小球起始位置
        const ballBounds = ballWindow.getBounds();
        const ballStartX = ballBounds.x;
        const ballStartY = ballBounds.y;

        // 预览窗口起始位置
        let previewStartX = screenWidth / 2 - PREVIEW_WIDTH / 2;
        let previewStartY = screenHeight / 2 - PREVIEW_HEIGHT / 2;
        createPreviewWindow(previewStartX, previewStartY);

        // 边界
        const ballMaxX = screenWidth - BALL_SIZE;
        const ballMaxY = screenHeight - BALL_SIZE;
        const previewMaxX = screenWidth - PREVIEW_WIDTH;
        const previewMaxY = screenHeight - PREVIEW_HEIGHT;

        // ===== 疯狂乱弹 =====
        let ballX = ballStartX;
        let ballY = ballStartY;
        // 随机角度发射 - 2倍速！
        const angle = Math.random() * Math.PI * 2;
        let ballVelX = Math.cos(angle) * 70;
        let ballVelY = Math.sin(angle) * 70;

        // 预览窗口状态
        let previewX = previewStartX;
        let previewY = previewStartY;
        const previewAngle = Math.random() * Math.PI * 2;
        let previewVelX = Math.cos(previewAngle) * 60;
        let previewVelY = Math.sin(previewAngle) * 60;

        const duration = 5000;  // 5秒
        const pauseDuration = 300;
        const returnDuration = 400;
        const startTime = Date.now();

        let bounceEndBallX = ballStartX;
        let bounceEndBallY = ballStartY;

        const animate = () => {
            const elapsed = Date.now() - startTime;

            if (elapsed < duration) {
                // 更新位置
                ballX += ballVelX;
                ballY += ballVelY;
                previewX += previewVelX;
                previewY += previewVelY;

                // 小球碰撞 + 随机偏转
                if (ballX <= 0 || ballX >= ballMaxX) {
                    ballVelX = -ballVelX;
                    ballX = Math.max(0, Math.min(ballX, ballMaxX));
                    ballVelY += (Math.random() - 0.5) * 18;  // 随机偏转
                }
                if (ballY <= 0 || ballY >= ballMaxY) {
                    ballVelY = -ballVelY;
                    ballY = Math.max(0, Math.min(ballY, ballMaxY));
                    ballVelX += (Math.random() - 0.5) * 18;  // 随机偏转
                }

                // 预览窗口碰撞
                if (previewX <= 0 || previewX >= previewMaxX) {
                    previewVelX = -previewVelX;
                    previewX = Math.max(0, Math.min(previewX, previewMaxX));
                    previewVelY += (Math.random() - 0.5) * 15;
                }
                if (previewY <= 0 || previewY >= previewMaxY) {
                    previewVelY = -previewVelY;
                    previewY = Math.max(0, Math.min(previewY, previewMaxY));
                    previewVelX += (Math.random() - 0.5) * 15;
                }

                // 更新窗口位置
                if (ballWindow && !ballWindow.isDestroyed()) {
                    ballWindow.setPosition(Math.round(ballX), Math.round(ballY));
                }
                if (previewWindow && !previewWindow.isDestroyed()) {
                    previewWindow.setPosition(Math.round(previewX), Math.round(previewY));
                }

                bounceEndBallX = ballX;
                bounceEndBallY = ballY;

            } else if (elapsed < duration + pauseDuration) {
                // 停顿

            } else if (elapsed < duration + pauseDuration + returnDuration) {
                // 返回原位
                const returnProgress = (elapsed - duration - pauseDuration) / returnDuration;
                const ease = 1 - Math.pow(1 - returnProgress, 3);

                const currentBallX = bounceEndBallX + (ballStartX - bounceEndBallX) * ease;
                const currentBallY = bounceEndBallY + (ballStartY - bounceEndBallY) * ease;

                if (ballWindow && !ballWindow.isDestroyed()) {
                    ballWindow.setPosition(Math.round(currentBallX), Math.round(currentBallY));
                }
                if (previewWindow && !previewWindow.isDestroyed()) {
                    previewWindow.hide();
                }

            } else {
                // 动画结束
                if (ballWindow && !ballWindow.isDestroyed()) {
                    ballWindow.setPosition(Math.round(ballStartX), Math.round(ballStartY));
                }
                isHalfHidden = false;
                hideHalfBall();
                isBouncing = false;
                return;
            }

            setTimeout(animate, 6);
        };

        animate();
    }

    ipcMain.handle('get-ball-position', () => {
        if (ballWindow) {
            return ballWindow.getBounds();
        }
        return null;
    });

    // ============ 散弹枪风暴功能（提取为函数，便于快捷键调用）============
    function triggerShotgunFire() {
        if (!ballWindow) return;

        // 防止连续触发
        if (isBouncing) return;
        isBouncing = true;

        // 关闭笑话窗口和预览窗口
        if (jokeWindow && !jokeWindow.isDestroyed()) {
            jokeWindow.close();
            jokeWindow = null;
        }
        if (previewWindow && !previewWindow.isDestroyed()) {
            previewWindow.close();
            previewWindow = null;
        }

        const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

        // 创建全屏特效叠加层
        overlayWindow = new BrowserWindow({
            width: screenWidth,
            height: screenHeight,
            x: 0,
            y: 0,
            frame: false,
            transparent: true,
            alwaysOnTop: true,
            resizable: false,
            skipTaskbar: true,
            focusable: false,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        });

        overlayWindow.loadFile(path.join(__dirname, 'overlay.html'));
        overlayWindow.setIgnoreMouseEvents(true);

        // 获取小球位置
        const ballBounds = ballWindow.getBounds();
        const ballCenterX = ballBounds.x + BALL_SIZE / 2;
        const ballCenterY = ballBounds.y + BALL_SIZE / 2;

        // 隐藏小球
        ballWindow.hide();

        // overlay 加载完成后发送散弹枪事件
        overlayWindow.webContents.once('did-finish-load', () => {
            if (overlayWindow && !overlayWindow.isDestroyed()) {
                overlayWindow.webContents.send('start-shotgun', {
                    ballX: ballCenterX,
                    ballY: ballCenterY,
                    screenWidth,
                    screenHeight
                });
            }
        });

        // 特效完成后恢复（约28秒，加上终结枪的时间）
        setTimeout(() => {
            // 关闭叠加层
            if (overlayWindow && !overlayWindow.isDestroyed()) {
                overlayWindow.close();
                overlayWindow = null;
            }

            // 恢复小球
            if (ballWindow && !ballWindow.isDestroyed()) {
                ballWindow.show();
            }

            isBouncing = false;
        }, 28000);
    }

    // ============ 双击 - 散弹枪风暴！ ============
    ipcMain.on('shotgun-fire', triggerShotgunFire);

    // ============ 全局快捷键 Ctrl+Alt+1 触发散弹枪！ ============
    globalShortcut.register('CommandOrControl+Alt+1', triggerShotgunFire);

    // ============ 终极毁灭功能（提取为函数，便于快捷键调用）============
    function triggerUltimateDestroy() {
        if (!ballWindow) return;

        // 防止连续触发
        if (isBouncing) return;
        isBouncing = true;

        // 关闭笑话窗口和预览窗口
        if (jokeWindow && !jokeWindow.isDestroyed()) {
            jokeWindow.close();
            jokeWindow = null;
        }
        if (previewWindow && !previewWindow.isDestroyed()) {
            previewWindow.close();
            previewWindow = null;
        }

        const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

        // 创建全屏特效叠加层
        overlayWindow = new BrowserWindow({
            width: screenWidth,
            height: screenHeight,
            x: 0,
            y: 0,
            frame: false,
            transparent: true,
            alwaysOnTop: true,
            resizable: false,
            skipTaskbar: true,
            focusable: false,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        });

        overlayWindow.loadFile(path.join(__dirname, 'overlay.html'));
        overlayWindow.setIgnoreMouseEvents(true);

        // 获取小球起始位置
        const ballBounds = ballWindow.getBounds();
        const ballStartX = ballBounds.x;
        const ballStartY = ballBounds.y;

        // 小球移动到屏幕中心
        const centerX = screenWidth / 2 - BALL_SIZE / 2;
        const centerY = screenHeight / 2 - BALL_SIZE / 2;

        // 蓄力动画 - 小球飞到中心
        let moveProgress = 0;
        const moveToCenter = () => {
            moveProgress += 0.08;
            if (moveProgress >= 1) moveProgress = 1;

            const ease = 1 - Math.pow(1 - moveProgress, 3);
            const currentX = ballStartX + (centerX - ballStartX) * ease;
            const currentY = ballStartY + (centerY - ballStartY) * ease;

            if (ballWindow && !ballWindow.isDestroyed()) {
                ballWindow.setPosition(Math.round(currentX), Math.round(currentY));
            }

            if (moveProgress < 1) {
                setTimeout(moveToCenter, 16);
            } else {
                // 通知叠加层开始特效
                if (overlayWindow && !overlayWindow.isDestroyed()) {
                    overlayWindow.webContents.send('start-destruction', {
                        ballX: centerX + BALL_SIZE / 2,
                        ballY: centerY + BALL_SIZE / 2,
                        screenWidth,
                        screenHeight
                    });
                }

                // 隐藏小球
                if (ballWindow && !ballWindow.isDestroyed()) {
                    ballWindow.hide();
                }

                // 特效完成后恢复
                setTimeout(() => {
                    // 关闭叠加层
                    if (overlayWindow && !overlayWindow.isDestroyed()) {
                        overlayWindow.close();
                        overlayWindow = null;
                    }

                    // 恢复小球
                    if (ballWindow && !ballWindow.isDestroyed()) {
                        ballWindow.setPosition(Math.round(ballStartX), Math.round(ballStartY));
                        ballWindow.show();
                    }

                    isHalfHidden = false;
                    hideHalfBall();
                    isBouncing = false;
                }, 60000);  // 60秒后恢复（核弹翻5倍，需要更多时间）
            }
        };

        setTimeout(moveToCenter, 100);
    }

    // ============ 三连击 - 终极毁灭！ ============
    ipcMain.on('ultimate-destroy', triggerUltimateDestroy);

    // ============ 全局快捷键 Ctrl+Alt+2 触发核弹！ ============
    globalShortcut.register('CommandOrControl+Alt+2', triggerUltimateDestroy);

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createBallWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// 退出时注销所有快捷键
app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});
