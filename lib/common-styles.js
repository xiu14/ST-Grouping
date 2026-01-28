// ST-Grouping - 主题样式工具
// 原始来源: prompt-entry-grouping/lib/common-styles.js

import { getParentWindow, getDeviceInfo } from './utils.js';

/**
 * 获取 CSS 变量值
 * @param {string} name - 变量名
 * @param {string} fallback - 回退值
 * @returns {string} - 变量值
 */
function getCssVar(name, fallback = '') {
    try {
        const parentWindow = getParentWindow();
        const root = parentWindow.document?.documentElement || document.documentElement;
        const value = getComputedStyle(root).getPropertyValue(name).trim();
        return value || fallback;
    } catch {
        return fallback;
    }
}

/**
 * 解析颜色为 RGB
 * @param {string} color - 颜色字符串
 * @returns {Object|null} - RGB 对象
 */
function parseColorToRgb(color) {
    if (!color) return null;

    // 处理 rgba/rgb 格式
    const rgbaMatch = color.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (rgbaMatch) {
        return {
            r: parseInt(rgbaMatch[1], 10),
            g: parseInt(rgbaMatch[2], 10),
            b: parseInt(rgbaMatch[3], 10),
        };
    }

    // 处理 hex 格式
    const hexMatch = color.match(/^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
    if (hexMatch) {
        return {
            r: parseInt(hexMatch[1], 16),
            g: parseInt(hexMatch[2], 16),
            b: parseInt(hexMatch[3], 16),
        };
    }

    return null;
}

/**
 * RGB 转 RGBA
 * @param {Object} rgb - RGB 对象
 * @param {number} alpha - 透明度
 * @returns {string} - RGBA 字符串
 */
function rgbToRgba(rgb, alpha) {
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

/**
 * 计算亮度
 * @param {Object} rgb - RGB 对象
 * @returns {number} - 亮度值
 */
function luminance(rgb) {
    return 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
}

/**
 * 通用样式工具
 */
export const CommonStyles = {
    getVars() {
        const deviceInfo = typeof getDeviceInfo === 'function' ? getDeviceInfo() : { isMobile: false, isSmallScreen: false };
        const { isMobile, isSmallScreen } = deviceInfo;

        // 字体大小
        let baseFontSize = 16;
        try {
            const parentWindow = getParentWindow();
            const bodyStyles = parentWindow.getComputedStyle(parentWindow.document.body);
            const bodyFontSize = bodyStyles.fontSize;
            const parsed = parseInt(bodyFontSize, 10);
            if (!Number.isNaN(parsed) && parsed > 8 && parsed < 40) {
                baseFontSize = parsed;
            }
        } catch { }
        const fontSize = String(baseFontSize);

        // 背景色
        let rawBg = getCssVar('--SmartThemeBlurTintColor', '');
        if (!rawBg || rawBg === 'transparent' || rawBg === 'rgba(0, 0, 0, 0)') {
            try {
                const parentWindow = getParentWindow();
                const bodyStyles = parentWindow.getComputedStyle(parentWindow.document.body);
                rawBg = bodyStyles.backgroundColor || '#111827';
            } catch {
                rawBg = '#111827';
            }
        }

        const bgRgb = parseColorToRgb(rawBg) || { r: 17, g: 24, b: 39 };
        const bgLum = luminance(bgRgb);
        const isDarkBase = bgLum < 140;

        // 文字颜色
        let rawText = getCssVar('--SmartThemeBodyColor', isDarkBase ? '#f9fafb' : '#111827');
        let textRgb = parseColorToRgb(rawText);
        if (textRgb) {
            const textLum = luminance(textRgb);
            if (Math.abs(textLum - bgLum) < 60) {
                rawText = isDarkBase ? '#f9fafb' : '#111827';
                textRgb = parseColorToRgb(rawText);
            }
        } else {
            rawText = isDarkBase ? '#f9fafb' : '#111827';
            textRgb = parseColorToRgb(rawText);
        }

        const textColor = rawText;

        // 派生颜色
        const panelAlpha = isDarkBase ? 0.82 : 0.9;
        const sectionAlpha = isDarkBase ? 0.76 : 0.85;
        const subAlpha = isDarkBase ? 0.62 : 0.75;

        const bgColor = rgbToRgba(bgRgb, panelAlpha);
        const sectionBg = rgbToRgba(bgRgb, sectionAlpha);
        const subBg = rgbToRgba(bgRgb, subAlpha);

        const borderAlpha = isDarkBase ? 0.55 : 0.25;
        const borderColor = rgbToRgba(bgRgb, borderAlpha);

        const tipBase = textRgb || bgRgb;
        const tipAlpha = isDarkBase ? 0.65 : 0.55;
        const tipColor = rgbToRgba(tipBase, tipAlpha);

        const accentAlpha = isDarkBase ? 0.5 : 0.35;
        const accentColor = rgbToRgba(bgRgb, accentAlpha);
        const dangerColor = accentColor;

        return {
            bgColor,
            textColor,
            borderColor,
            inputBg: subBg,
            inputBorder: borderColor,
            sectionBg,
            subBg,
            tipColor,
            accentColor,
            dangerColor,
            fontSize: `${fontSize}px`,
            isMobile,
            isSmallScreen,
        };
    },
};
