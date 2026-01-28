// ST-Grouping - 提示词分组核心逻辑
// 原始来源: prompt-entry-grouping/lib/entry-grouping.js
// 分组数据存储在预设的 extensions.entryGrouping 字段中

import { getCurrentApiInfo, generateUUID } from './utils.js';

const DEFAULT_GROUP_NAME = '分组';
const DEFAULT_MODE = 'inclusive';

/**
 * 创建分组 ID
 * @returns {string} - 唯一ID
 */
function createGroupId() {
    try {
        if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    } catch { }
    return `peg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 转换为数组
 * @param {*} value - 值
 * @returns {Array} - 数组
 */
function asArray(value) {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
}

/**
 * 检查是否为普通对象
 * @param {*} value - 值
 * @returns {boolean}
 */
function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 读取分组名称
 * @param {Object} entry - 分组条目
 * @returns {string} - 分组名称
 */
function readGroupName(entry) {
    return entry?.name || entry?.groupName || DEFAULT_GROUP_NAME;
}

/**
 * 检查是否为旧版索引分组
 * @param {Object} entry - 条目
 * @returns {boolean}
 */
function isLegacyIndexGrouping(entry) {
    return typeof entry?.startIndex === 'number' && typeof entry?.endIndex === 'number';
}

/**
 * 检查是否为标识符锚点分组
 * @param {Object} entry - 条目
 * @returns {boolean}
 */
function isIdentifierAnchorGrouping(entry) {
    return typeof entry?.startIdentifier === 'string' || typeof entry?.endIdentifier === 'string';
}

/**
 * 规范化分组条目（用于读取）
 * @param {Object} entry - 原始条目
 * @param {Array} orderedIdentifiers - 有序标识符列表
 * @returns {Object|null} - 规范化后的条目
 */
function normalizeForRead(entry, orderedIdentifiers) {
    if (!isPlainObject(entry)) return null;

    if (isLegacyIndexGrouping(entry)) {
        const startIdentifier = Array.isArray(orderedIdentifiers) ? orderedIdentifiers[entry.startIndex] : null;
        const endIdentifier = Array.isArray(orderedIdentifiers) ? orderedIdentifiers[entry.endIndex] : null;
        if (typeof startIdentifier === 'string' && typeof endIdentifier === 'string') {
            return {
                id: typeof entry.id === 'string' ? entry.id : createGroupId(),
                name: readGroupName(entry),
                startIdentifier,
                endIdentifier,
                mode: entry.mode || DEFAULT_MODE,
            };
        }

        return {
            id: typeof entry.id === 'string' ? entry.id : createGroupId(),
            name: readGroupName(entry),
            mode: entry.mode || DEFAULT_MODE,
            unresolved: true,
            legacyStartIndex: entry.startIndex,
            legacyEndIndex: entry.endIndex,
        };
    }

    if (isIdentifierAnchorGrouping(entry)) {
        const startIdentifier = typeof entry.startIdentifier === 'string' ? entry.startIdentifier : null;
        const endIdentifier = typeof entry.endIdentifier === 'string' ? entry.endIdentifier : null;
        if (startIdentifier && endIdentifier) {
            return {
                id: typeof entry.id === 'string' ? entry.id : createGroupId(),
                name: readGroupName(entry),
                startIdentifier,
                endIdentifier,
                mode: entry.mode || DEFAULT_MODE,
            };
        }

        return {
            id: typeof entry.id === 'string' ? entry.id : createGroupId(),
            name: readGroupName(entry),
            mode: entry.mode || DEFAULT_MODE,
            unresolved: true,
            legacyStartIndex: entry.legacyStartIndex,
            legacyEndIndex: entry.legacyEndIndex,
        };
    }

    return null;
}

/**
 * 规范化分组条目（用于写入）
 * @param {Object} entry - 原始条目
 * @param {Array} orderedIdentifiers - 有序标识符列表
 * @returns {Object|null} - 规范化后的条目
 */
function normalizeForWrite(entry, orderedIdentifiers) {
    if (!isPlainObject(entry)) return null;

    if (isIdentifierAnchorGrouping(entry)) {
        const normalized = {
            id: typeof entry.id === 'string' ? entry.id : createGroupId(),
            name: readGroupName(entry),
            mode: entry.mode || DEFAULT_MODE,
        };

        if (typeof entry.startIdentifier === 'string') normalized.startIdentifier = entry.startIdentifier;
        if (typeof entry.endIdentifier === 'string') normalized.endIdentifier = entry.endIdentifier;

        if (entry.unresolved) normalized.unresolved = true;
        if (typeof entry.legacyStartIndex === 'number') normalized.legacyStartIndex = entry.legacyStartIndex;
        if (typeof entry.legacyEndIndex === 'number') normalized.legacyEndIndex = entry.legacyEndIndex;

        return normalized;
    }

    if (isLegacyIndexGrouping(entry)) {
        const startIdentifier = Array.isArray(orderedIdentifiers) ? orderedIdentifiers[entry.startIndex] : null;
        const endIdentifier = Array.isArray(orderedIdentifiers) ? orderedIdentifiers[entry.endIndex] : null;

        if (typeof startIdentifier === 'string' && typeof endIdentifier === 'string') {
            return {
                id: typeof entry.id === 'string' ? entry.id : createGroupId(),
                name: readGroupName(entry),
                startIdentifier,
                endIdentifier,
                mode: entry.mode || DEFAULT_MODE,
            };
        }

        return {
            id: typeof entry.id === 'string' ? entry.id : createGroupId(),
            name: readGroupName(entry),
            mode: entry.mode || DEFAULT_MODE,
            unresolved: true,
            legacyStartIndex: entry.startIndex,
            legacyEndIndex: entry.endIndex,
        };
    }

    return null;
}

/**
 * 获取可写入的分组列表
 * @param {Array} rawGroupings - 原始分组
 * @param {Array} orderedIdentifiers - 有序标识符
 * @returns {Array} - 规范化后的分组列表
 */
function getWritableGroupings(rawGroupings, orderedIdentifiers) {
    return asArray(rawGroupings)
        .map((entry) => normalizeForWrite(entry, orderedIdentifiers))
        .filter(Boolean);
}

/**
 * 同步分组到当前活动设置
 * @param {Object} apiInfo - API 信息
 * @param {string} presetName - 预设名称
 * @param {Array} groupings - 分组列表
 */
function syncEntryGroupingToActiveSettings(apiInfo, presetName, groupings) {
    try {
        const presetManager = apiInfo?.presetManager;
        if (!presetManager) return;

        const selectedPresetName = presetManager.getSelectedPresetName?.();
        if (!selectedPresetName || selectedPresetName !== presetName) return;

        const settings = presetManager.getPresetList?.()?.settings;
        if (!isPlainObject(settings)) return;

        if (!isPlainObject(settings.extensions)) settings.extensions = {};
        settings.extensions.entryGrouping = groupings;
    } catch (error) {
        console.warn('[ST-Grouping] 同步当前预设分组扩展数据失败:', error);
    }
}

/**
 * 获取当前加载的预设名称
 * @returns {string|null} - 预设名称
 */
export function getLoadedPresetName() {
    try {
        const apiInfo = getCurrentApiInfo();
        if (!apiInfo?.presetManager) return null;
        return apiInfo.presetManager.getSelectedPresetName?.() || null;
    } catch {
        return null;
    }
}

/**
 * 获取预设对象
 * @param {string} presetName - 预设名称
 * @returns {Object|null} - 预设对象
 */
export function getPreset(presetName) {
    try {
        const apiInfo = getCurrentApiInfo();
        if (!apiInfo?.presetManager) return null;
        return apiInfo.presetManager.getCompletionPresetByName(presetName) || null;
    } catch {
        return null;
    }
}

/**
 * 获取预设的所有分组配置
 * @param {string} presetName - 预设名称
 * @param {Array} orderedIdentifiers - 有序标识符列表
 * @returns {Array} - 分组配置列表
 */
export function getAllPresetGroupings(presetName, orderedIdentifiers) {
    try {
        const preset = getPreset(presetName);
        if (!preset || !preset.extensions) return [];

        const grouping = preset.extensions.entryGrouping;
        if (!grouping) return [];

        return asArray(grouping)
            .map((entry) => normalizeForRead(entry, orderedIdentifiers))
            .filter(Boolean);
    } catch (error) {
        console.warn(`[ST-Grouping] 获取预设 "${presetName}" 的分组配置失败`, error);
        return [];
    }
}

/**
 * 添加新分组
 * @param {string} presetName - 预设名称
 * @param {string} startIdentifier - 开始条目标识符
 * @param {string} endIdentifier - 结束条目标识符
 * @param {string} groupName - 分组名称
 * @param {Array} orderedIdentifiers - 有序标识符列表
 * @returns {Promise<boolean>} - 是否成功
 */
export async function addPresetGrouping(presetName, startIdentifier, endIdentifier, groupName, orderedIdentifiers) {
    try {
        if (typeof startIdentifier !== 'string' || typeof endIdentifier !== 'string') {
            throw new Error('Invalid identifier anchors');
        }

        const apiInfo = getCurrentApiInfo();
        if (apiInfo && apiInfo.presetManager) {
            const presetObj = apiInfo.presetManager.getCompletionPresetByName(presetName);
            if (!presetObj) throw new Error(`Preset "${presetName}" not found`);

            if (!presetObj.extensions) presetObj.extensions = {};

            const groupings = getWritableGroupings(presetObj.extensions.entryGrouping, orderedIdentifiers);
            groupings.push({
                id: createGroupId(),
                name: groupName || DEFAULT_GROUP_NAME,
                startIdentifier,
                endIdentifier,
                mode: DEFAULT_MODE,
            });
            presetObj.extensions.entryGrouping = groupings;

            syncEntryGroupingToActiveSettings(apiInfo, presetName, groupings);

            await apiInfo.presetManager.savePreset(presetName, presetObj, { skipUpdate: true });
            return true;
        }

        return false;
    } catch (error) {
        console.error('[ST-Grouping] 添加分组配置失败:', error);
        return false;
    }
}

/**
 * 更新指定分组
 * @param {string} presetName - 预设名称
 * @param {number} groupIndex - 分组索引
 * @param {string} startIdentifier - 开始标识符
 * @param {string} endIdentifier - 结束标识符
 * @param {string} groupName - 分组名称
 * @param {Array} orderedIdentifiers - 有序标识符列表
 * @returns {Promise<boolean>} - 是否成功
 */
export async function updatePresetGrouping(presetName, groupIndex, startIdentifier, endIdentifier, groupName, orderedIdentifiers) {
    try {
        const apiInfo = getCurrentApiInfo();
        if (apiInfo && apiInfo.presetManager) {
            const presetObj = apiInfo.presetManager.getCompletionPresetByName(presetName);
            if (!presetObj) throw new Error(`Preset "${presetName}" not found`);
            if (!presetObj.extensions) presetObj.extensions = {};

            const groupings = getWritableGroupings(presetObj.extensions.entryGrouping, orderedIdentifiers);
            if (groupIndex < 0 || groupIndex >= groupings.length) {
                throw new Error(`Invalid group index: ${groupIndex}`);
            }

            const existing = groupings[groupIndex] || {};
            groupings[groupIndex] = {
                id: existing.id || createGroupId(),
                name: groupName || existing.name || DEFAULT_GROUP_NAME,
                startIdentifier: typeof startIdentifier === 'string' ? startIdentifier : existing.startIdentifier,
                endIdentifier: typeof endIdentifier === 'string' ? endIdentifier : existing.endIdentifier,
                mode: existing.mode || DEFAULT_MODE,
            };

            presetObj.extensions.entryGrouping = groupings;
            syncEntryGroupingToActiveSettings(apiInfo, presetName, groupings);

            await apiInfo.presetManager.savePreset(presetName, presetObj, { skipUpdate: true });
            return true;
        }

        return false;
    } catch (error) {
        console.error('[ST-Grouping] 更新分组配置失败:', error);
        return false;
    }
}

/**
 * 删除指定分组
 * @param {string} presetName - 预设名称
 * @param {number} groupIndex - 分组索引
 * @param {Array} orderedIdentifiers - 有序标识符列表
 * @returns {Promise<boolean>} - 是否成功
 */
export async function removePresetGrouping(presetName, groupIndex, orderedIdentifiers) {
    try {
        const apiInfo = getCurrentApiInfo();
        if (apiInfo && apiInfo.presetManager) {
            const presetObj = apiInfo.presetManager.getCompletionPresetByName(presetName);
            if (!presetObj) throw new Error(`Preset "${presetName}" not found`);
            if (!presetObj.extensions) presetObj.extensions = {};

            const groupings = getWritableGroupings(presetObj.extensions.entryGrouping, orderedIdentifiers);
            if (groupIndex < 0 || groupIndex >= groupings.length) {
                throw new Error(`Invalid group index: ${groupIndex}`);
            }

            groupings.splice(groupIndex, 1);
            presetObj.extensions.entryGrouping = groupings;

            syncEntryGroupingToActiveSettings(apiInfo, presetName, groupings);

            await apiInfo.presetManager.savePreset(presetName, presetObj, { skipUpdate: true });
            return true;
        }

        return false;
    } catch (error) {
        console.error('[ST-Grouping] 删除分组配置失败:', error);
        return false;
    }
}
