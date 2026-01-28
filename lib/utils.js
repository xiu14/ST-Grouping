// ST-Grouping - 工具函数
// 原始来源: prompt-entry-grouping/lib/utils.js

/**
 * 防抖函数
 * @param {Function} func - 要执行的函数
 * @param {number} wait - 等待时间（毫秒）
 * @returns {Function} - 防抖后的函数
 */
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * 获取 SillyTavern 上下文
 * @returns {Object} - SillyTavern 上下文对象
 */
export function getSillyTavernContext() {
    const st = window.parent?.SillyTavern ?? window.SillyTavern;
    if (st) return st.getContext();
    throw new Error('无法获取SillyTavern上下文');
}

/**
 * 获取父窗口
 * @returns {Window} - 父窗口对象
 */
export function getParentWindow() {
    return window.parent && window.parent !== window ? window.parent : window;
}

/**
 * 获取 jQuery
 * @returns {jQuery} - jQuery 对象
 */
export function getJQuery() {
    return getParentWindow().$ ?? window.$;
}

/**
 * 获取当前 API 信息
 * @returns {Object|null} - API 信息对象
 */
export function getCurrentApiInfo() {
    try {
        const context = getSillyTavernContext();
        const mainApi = context.mainApi;
        const presetManager = context.getPresetManager(mainApi === 'koboldhorde' ? 'kobold' : mainApi);
        const { preset_names } = presetManager.getPresetList();
        const presetNames = Array.isArray(preset_names) ? preset_names : Object.keys(preset_names || {});
        return {
            apiType: mainApi,
            presetManager: presetManager,
            presetNames: presetNames,
            context: context,
        };
    } catch (error) {
        console.error('[ST-Grouping] 获取API信息失败:', error);
        return null;
    }
}

/**
 * 获取设备信息
 * @returns {Object} - 设备信息
 */
export function getDeviceInfo() {
    const parentWindow = getParentWindow();
    const isMobile = parentWindow.innerWidth <= 768;
    const isSmallScreen = parentWindow.innerWidth <= 480;
    const isPortrait = parentWindow.innerHeight > parentWindow.innerWidth;
    return { isMobile, isSmallScreen, isPortrait };
}

/**
 * 确保视口 CSS 变量已设置
 */
export function ensureViewportCssVars() {
    const parentWindow = getParentWindow();
    const root = parentWindow.document?.documentElement || document.documentElement;

    if (parentWindow.__stGroupingViewportCssVarsBound) {
        parentWindow.__stGroupingViewportCssVarsHandler?.();
        return;
    }

    const handler = () => {
        const vh = parentWindow.innerHeight * 0.01;
        root.style.setProperty('--peg-vh', `${vh}px`);
        root.style.setProperty('--peg-viewport-height', `${parentWindow.innerHeight}px`);
    };

    parentWindow.__stGroupingViewportCssVarsBound = true;
    parentWindow.__stGroupingViewportCssVarsHandler = handler;

    handler();
    parentWindow.addEventListener('resize', handler, { passive: true });
    parentWindow.addEventListener('orientationchange', handler, { passive: true });
}

/**
 * HTML 转义
 * @param {string} text - 要转义的文本
 * @returns {string} - 转义后的文本
 */
export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * 生成 UUID
 * @returns {string} - UUID 字符串
 */
export function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0,
            v = c == 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}
