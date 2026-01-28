// ST-Grouping - 一键开关功能
// 原始来源: prompt-entry-grouping/lib/toggle-button.js

import { getJQuery } from './utils.js';

/**
 * 为分组头部添加一键开关按钮
 * @param {jQuery} $groupHeader - 分组头部元素
 * @param {Array} groupItems - 分组内的条目元素数组
 * @param {Function} onToggle - 切换回调函数 (enabled: boolean, items: Array) => Promise<void>
 * @returns {jQuery|undefined} - 按钮元素
 */
export function addToggleAllButtonToGroupHeader($groupHeader, groupItems, onToggle) {
    const $ = getJQuery();

    // 检查是否已经添加过按钮
    if ($groupHeader.find('.peg-toggle-all-btn').length) {
        return;
    }

    // 创建一键开关按钮
    const $toggleBtn = $(`
    <button type="button" class="peg-toggle-all-btn"
            title="一键开关分组内所有条目"
            aria-label="一键开关分组内所有条目"
            style="margin-left: 4px;">
      <i class="fa-fw fa-solid fa-toggle-on"></i>
    </button>
  `);

    // 更新按钮状态
    const updateButtonState = () => {
        if (!groupItems || groupItems.length === 0) return;

        let enabledCount = 0;
        let totalCount = 0;

        groupItems.forEach(item => {
            const $item = $(item);
            const $toggle = $item.find('.prompt-manager-toggle-action');
            if ($toggle.length) {
                totalCount++;
                const isEnabled = !$toggle.hasClass('disabled') && !$toggle.hasClass('fa-toggle-off');
                if (isEnabled) enabledCount++;
            }
        });

        const $icon = $toggleBtn.find('i');
        $toggleBtn.removeClass('is-mixed');
        if (enabledCount === 0) {
            $icon.removeClass('fa-toggle-on').addClass('fa-toggle-off');
            $toggleBtn.attr('title', '一键启用分组内所有条目');
            $toggleBtn.attr('data-state', 'off');
        } else if (enabledCount === totalCount) {
            $icon.removeClass('fa-toggle-off').addClass('fa-toggle-on');
            $toggleBtn.attr('title', '一键禁用分组内所有条目');
            $toggleBtn.attr('data-state', 'on');
        } else {
            $icon.removeClass('fa-toggle-off').addClass('fa-toggle-on');
            $toggleBtn.attr('title', '一键开关分组内所有条目（当前部分启用）');
            $toggleBtn.attr('data-state', 'mixed');
            $toggleBtn.addClass('is-mixed');
        }
    };

    // 点击事件
    $toggleBtn.on('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();

        if (!groupItems || groupItems.length === 0) return;

        const currentState = $toggleBtn.attr('data-state');
        const shouldEnable = currentState === 'off' || currentState === 'mixed';

        try {
            $toggleBtn.prop('disabled', true);

            if (typeof onToggle === 'function') {
                await onToggle(shouldEnable, groupItems);
            }

            updateButtonState();
        } catch (error) {
            console.error('[ST-Grouping] 切换失败:', error);
            if (window.toastr) {
                toastr.error('切换失败: ' + error.message);
            }
        } finally {
            $toggleBtn.prop('disabled', false);
        }
    });

    // 将按钮插入到编辑按钮之前
    const $editBtn = $groupHeader.find('.peg-group-edit-btn');
    if ($editBtn.length) {
        $editBtn.before($toggleBtn);
    } else {
        $groupHeader.append($toggleBtn);
    }

    // 初始化按钮状态
    updateButtonState();

    return $toggleBtn;
}

/**
 * 切换分组内所有条目的启用状态
 * @param {boolean} enabled - 是否启用
 * @param {Array} groupItems - 分组内的条目元素数组
 */
export async function toggleAllEntriesInGroup(enabled, groupItems) {
    const $ = getJQuery();

    if (!groupItems || groupItems.length === 0) return;

    const identifiers = [];
    for (const item of groupItems) {
        const $item = $(item);
        const $toggle = $item.find('.prompt-manager-toggle-action');
        if (!$toggle.length) continue;

        const identifier = String($item.attr('data-pm-identifier') ?? '').trim();
        if (identifier) identifiers.push(identifier);
    }

    if (identifiers.length > 0) {
        const handled = await tryBulkToggleWithPromptManager(enabled, identifiers);
        if (handled) return;
    }

    // 兜底：逐个触发
    for (const item of groupItems) {
        const $item = $(item);
        const $toggle = $item.find('.prompt-manager-toggle-action');

        if (!$toggle.length) continue;

        const isCurrentlyEnabled = !$toggle.hasClass('disabled') && !$toggle.hasClass('fa-toggle-off');

        if (isCurrentlyEnabled !== enabled) {
            $toggle.trigger('click');
        }
    }
}

/**
 * 尝试使用 PromptManager 批量切换
 * @param {boolean} enabled - 是否启用
 * @param {Array} identifiers - 条目标识符列表
 * @returns {Promise<boolean>} - 是否成功处理
 */
async function tryBulkToggleWithPromptManager(enabled, identifiers) {
    if (!Array.isArray(identifiers) || identifiers.length === 0) return false;

    try {
        const mod = await import('/scripts/openai.js');
        const promptManager = mod?.promptManager;
        if (!promptManager || typeof promptManager.getPromptOrderEntry !== 'function') return false;

        const activeCharacter = promptManager.activeCharacter;
        if (!activeCharacter) return false;

        const counts = promptManager.tokenHandler?.getCounts?.();
        let changed = false;

        for (const identifier of identifiers) {
            const entry = promptManager.getPromptOrderEntry(activeCharacter, identifier);
            if (!entry || entry.enabled === enabled) continue;
            entry.enabled = enabled;
            if (counts) counts[identifier] = null;
            changed = true;
        }

        if (changed) {
            promptManager.render?.(false);
            promptManager.saveServiceSettings?.();
        }

        return true;
    } catch (error) {
        console.warn('[ST-Grouping] Failed to bulk toggle via PromptManager:', error);
        return false;
    }
}
